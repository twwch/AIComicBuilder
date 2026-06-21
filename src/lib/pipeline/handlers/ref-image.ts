import { NextResponse } from "next/server";
import { eq, and, asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots, projects, episodes, characters as charactersTable } from "@/lib/db/schema";
import { resolveImageProvider, resolveAIProvider } from "@/lib/ai/provider-factory";
import {
  type ModelConfig,
  ratioToImageOpts,
  summarizeProviderConfig,
  findBoundAgent,
  callAndValidateAgent,
  getEpisodeCharacters,
} from "@/lib/generate-utils";
import { extractJSON } from "@/lib/ai/ai-sdk";
import { DEFAULT_ASPECT_RATIO, DEFAULT_IMAGE_QUALITY, TEMPERATURE_STRUCTURED } from "@/lib/config/defaults";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { buildRefImagePromptsRequest } from "@/lib/ai/prompts/ref-image-prompts";
import { buildVisualStyleContext } from "@/lib/visual-style";
import {
  loadShotLegacyView,
  loadShotLegacyViewsBatch,
  insertAssetVersion,
} from "@/lib/shot-asset-utils";
import { id as genId } from "@/lib/id";
import { updateTaskProgress, completeTask } from "@/lib/task-utils";
import { registerTask } from "@/lib/task-registry";

export async function handleSingleRefImageGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string
) {
  const shotId = payload?.shotId as string;
  const refImageId = payload?.refImageId as string;

  if (!shotId || !refImageId) {
    return NextResponse.json({ error: "Missing shotId or refImageId" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const shotView = await loadShotLegacyView(shot.id);
  const refImages = shotView.referenceImages;
  const entry = refImages.find((r) => r.id === refImageId);
  if (!entry) {
    return NextResponse.json({ error: "Reference image not found" }, { status: 404 });
  }
  if (!entry.prompt.trim()) {
    return NextResponse.json({ error: "No prompt provided" }, { status: 400 });
  }

  console.log(`[SingleRefImage] Shot ${shot.sequence}: generating scene-only ref image "${refImageId}"`);

  const ratio = (payload?.ratio as string) || DEFAULT_ASPECT_RATIO;
  const imgOpts = ratioToImageOpts(ratio);
  const imageProvider = resolveImageProvider(modelConfig);

  // Collect character reference images for subject consistency
  const subjectRefs: string[] = [];
  if (entry.characters && entry.characters.length > 0) {
    const chars = await db
      .select({ name: charactersTable.name, referenceImage: charactersTable.referenceImage })
      .from(charactersTable)
      .where(inArray(charactersTable.name, entry.characters));
    for (const c of chars) {
      if (c.referenceImage) subjectRefs.push(c.referenceImage);
    }
  }

  try {
    const imagePath = await imageProvider.generateImage(entry.prompt, {
      quality: DEFAULT_IMAGE_QUALITY,
      ...imgOpts,
      ...(subjectRefs.length > 0 && { referenceImages: subjectRefs }),
      ...(subjectRefs.length > 0 && entry.characters && { referenceLabels: entry.characters }),
    });

    await insertAssetVersion({
      shotId, type: "reference", sequenceInType: entry.sequenceInType,
      prompt: entry.prompt, fileUrl: imagePath, status: "completed",
      characters: entry.characters ?? undefined,
      generationId: genId(),
    });

    return NextResponse.json({ ok: true, imagePath });
  } catch (err) {
    console.error("[SingleRefImage] Generation failed", {
      shotId,
      refImageId,
      sequence: shot.sequence,
      promptLength: entry.prompt.length,
      imageModel: summarizeProviderConfig(modelConfig?.image),
      error: err instanceof Error ? {
        name: err.name,
        message: err.message,
        stack: err.stack,
      } : String(err),
    });
    return NextResponse.json({ error: `Generation failed: ${err}` }, { status: 500 });
  }
}

export async function handleGenerateRefPrompts(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
) {
  // === 智能体路由 ===
  const rpBoundAgent = await findBoundAgent(projectId, "ref_image_prompts");
  if (rpBoundAgent) {
    const batchVersionId = payload?.versionId as string | undefined;
    const rpWhereConds = [eq(shots.projectId, projectId)];
    if (batchVersionId) rpWhereConds.push(eq(shots.versionId, batchVersionId));
    if (episodeId) rpWhereConds.push(eq(shots.episodeId, episodeId));
    const rpAgentShots = await db.select().from(shots).where(and(...rpWhereConds)).orderBy(asc(shots.sequence));
    if (rpAgentShots.length === 0) {
      return NextResponse.json({ error: "没有分镜数据，请先生成分镜" }, { status: 400 });
    }
    const rpAgentChars = await getEpisodeCharacters(projectId, episodeId);
    const rpPrompt = JSON.stringify({
      shots: rpAgentShots.map((s) => ({
        sequence: s.sequence,
        sceneDescription: s.prompt,
        motionScript: s.motionScript,
        cameraDirection: s.cameraDirection,
        duration: s.duration,
      })),
      characters: rpAgentChars.map((c) => ({ name: c.name, description: c.description })),
    }, null, 2);

    const agentResult = await callAndValidateAgent(rpBoundAgent, "ref_image_prompts", rpPrompt);
    if (agentResult instanceof NextResponse) return agentResult;

    try {
      const rpParsed = JSON.parse(extractJSON(agentResult.text)) as Array<Record<string, unknown>>;
      if (!Array.isArray(rpParsed)) {
        return NextResponse.json({ error: "智能体必须返回 JSON 数组格式的参考图提示词" }, { status: 422 });
      }

      let savedCount = 0;
      for (const entry of rpParsed) {
        const seq = (entry.sequence as number) ?? (entry.shotSequence as number) ?? 0;
        const shot = rpAgentShots.find((s) => s.sequence === seq);
        if (!shot) continue;

        const scenes = entry.scenes as Array<{ name?: string; prompt?: string }> | undefined;
        const chars = Array.isArray(entry.characters) ? entry.characters as string[] : [];

        const agentRefGenId = genId();
        if (Array.isArray(scenes)) {
          for (let i = 0; i < scenes.length; i++) {
            const scenePrompt = scenes[i].prompt || "";
            if (scenePrompt) {
              await insertAssetVersion({
                shotId: shot.id,
                type: "reference",
                sequenceInType: i,
                prompt: scenePrompt,
                status: "pending",
                characters: chars,
                generationId: agentRefGenId,
              });
              savedCount++;
            }
          }
        }
      }
      console.log(`[RefPrompts Agent] Saved ${savedCount} assets from ${rpParsed.length} shots`);
      return NextResponse.json({ updatedCount: rpParsed.length, totalShots: rpAgentShots.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `智能体参考图提示词解析失败: ${msg}` }, { status: 422 });
    }
  }
  // === 智能体路由结束 ===

  if (!modelConfig?.text) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const buildWhere = (includeVersion: boolean) => {
    const conds = [eq(shots.projectId, projectId)];
    if (includeVersion && batchVersionId) conds.push(eq(shots.versionId, batchVersionId));
    if (episodeId) conds.push(eq(shots.episodeId, episodeId));
    return and(...conds);
  };

  let allShots = await db
    .select()
    .from(shots)
    .where(buildWhere(true))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0 && batchVersionId) {
    console.warn(`[GenerateRefPrompts] strict filter empty (versionId=${batchVersionId}), falling back to no-version filter`);
    allShots = await db
      .select()
      .from(shots)
      .where(buildWhere(false))
      .orderBy(asc(shots.sequence));
  }

  if (allShots.length === 0) {
    return NextResponse.json({ error: "No shots found" }, { status: 400 });
  }

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);

  // Pull visual style meta from script
  const scriptSource = episodeId
    ? await db.select({ script: episodes.script, idea: episodes.idea }).from(episodes).where(eq(episodes.id, episodeId))
    : await db.select({ script: projects.script, idea: projects.idea }).from(projects).where(eq(projects.id, projectId));
  const script = scriptSource[0]?.script || "";
  const idea = scriptSource[0]?.idea || "";
  const visualStyle = buildVisualStyleContext(script, idea);

  const textProvider = resolveAIProvider(modelConfig);
  const refImageSystemPrompt = await resolvePrompt("ref_image_prompts", {
    userId,
    projectId,
  });

  const total = allShots.length;
  let doneCount = 0;
  let updatedCount = 0;
  const taskSignal = taskId ? registerTask(taskId).signal : undefined;
  if (taskId) updateTaskProgress(taskId, { total, completed: 0, failed: [] });
  console.log(`[GenerateRefPrompts] Starting serial generation: 0/${total}`);

  for (const shot of allShots) {
    if (taskSignal?.aborted) { console.log(`[GenerateRefPrompts] Aborted at shot ${shot.sequence}`); break; }
    try {
      const promptRequest = buildRefImagePromptsRequest(
        [{
          sequence: shot.sequence,
          prompt: shot.prompt || "",
          motionScript: shot.motionScript,
          cameraDirection: shot.cameraDirection,
        }],
        projectCharacters.map((c) => ({
          name: c.name,
          description: c.description,
        })),
        visualStyle
      );

      const result = await textProvider.generateText(promptRequest, {
        systemPrompt: refImageSystemPrompt,
        temperature: TEMPERATURE_STRUCTURED,
      });

      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error(`Shot ${shot.sequence}: invalid JSON response`);
      }
      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        shotSequence: number;
        characters?: string[];
        scenes: Array<{ name: string; prompt: string }>;
      }>;
      const entry = parsed.find((e) => e.shotSequence === shot.sequence) || parsed[0];
      if (!entry || !Array.isArray(entry.scenes) || entry.scenes.length === 0) {
        throw new Error(`Shot ${shot.sequence}: expected at least 1 scene`);
      }

      const charsForShot = Array.isArray(entry.characters) ? entry.characters : [];
      const promptGenId = genId();
      let sceneIdx = 0;
      for (const scene of entry.scenes) {
        if (scene.prompt) {
          await insertAssetVersion({
            shotId: shot.id,
            type: "reference",
            sequenceInType: sceneIdx,
            prompt: scene.prompt,
            status: "pending",
            characters: charsForShot,
            generationId: promptGenId,
          });
          sceneIdx++;
        }
      }
      doneCount++;
      updatedCount++;
      console.log(`[GenerateRefPrompts] ✓ shot ${shot.sequence} (${doneCount}/${total})`);
    } catch (err) {
      doneCount++;
      console.warn(`[GenerateRefPrompts] ✗ shot ${shot.sequence} (${doneCount}/${total}): ${String(err)}`);
    }
  }
  console.log(`[GenerateRefPrompts] Updated ${updatedCount}/${allShots.length} shots (serial)`);
  if (taskId) completeTask(taskId, { total, completed: doneCount, failed: allShots.filter((_, i) => i >= doneCount - (total - doneCount)).slice(0, total - doneCount).map((s) => s.id) });

  return NextResponse.json({ updatedCount, totalShots: allShots.length });
}

export async function handleBatchRefImageGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
) {
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const overwrite = payload?.overwrite === true;
  const ratio = (payload?.ratio as string) || DEFAULT_ASPECT_RATIO;
  const imageOpts = ratioToImageOpts(ratio);
  const batchVersionId = payload?.versionId as string | undefined;

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db.select().from(shots).where(and(...shotWhereConditions)).orderBy(asc(shots.sequence));

  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));

  const imageProvider = resolveImageProvider(modelConfig);

  // Pre-fetch character reference images for subject consistency
  const allChars = await db
    .select({ name: charactersTable.name, referenceImage: charactersTable.referenceImage })
    .from(charactersTable)
    .where(eq(charactersTable.projectId, projectId));
  const charRefMap = new Map<string, string>();
  for (const c of allChars) {
    if (c.referenceImage) charRefMap.set(c.name, c.referenceImage);
  }

  const results: Array<{ shotId: string; sequence: number; status: string; generated: number; failed: number }> = [];
  const taskSignal = taskId ? registerTask(taskId).signal : undefined;
  if (taskId) updateTaskProgress(taskId, { total: allShots.length, completed: 0, failed: [] });

  for (const shot of allShots) {
    if (taskSignal?.aborted) { console.log(`[BatchRefImageGenerate] Aborted at shot ${shot.sequence}`); break; }
    const refImages = allShotsLegacy.get(shot.id)?.referenceImages ?? [];
    const targets = overwrite
      ? refImages.filter((r) => r.prompt.trim())
      : refImages.filter((r) => r.status === "pending" && r.prompt.trim());

    if (targets.length === 0) {
      results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", generated: 0, failed: 0 });
      continue;
    }

    console.log(`[BatchRefImageGenerate] Shot ${shot.sequence}: ${targets.length} ref images`);

    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id));

    let generated = 0;
    let failed = 0;
    for (const entry of targets) {
      try {
        // Collect character reference images for this entry
        const entryRefs: string[] = [];
        if (entry.characters) {
          for (const name of entry.characters) {
            const ref = charRefMap.get(name);
            if (ref) entryRefs.push(ref);
          }
        }
        // Limit to 6 character refs to avoid hitting API limits
        entryRefs.splice(6);

        const imagePath = await imageProvider.generateImage(entry.prompt, {
          quality: DEFAULT_IMAGE_QUALITY,
          ...imageOpts,
          ...(entryRefs.length > 0 && { referenceImages: entryRefs }),
          ...(entryRefs.length > 0 && entry.characters && { referenceLabels: entry.characters }),
        });
        await insertAssetVersion({
          shotId: shot.id, type: "reference", sequenceInType: entry.sequenceInType,
          prompt: entry.prompt, fileUrl: imagePath, status: "completed",
          characters: entry.characters ?? undefined,
          generationId: genId(),
        });
        generated++;
        console.log(`[BatchRefImageGenerate] Shot ${shot.sequence}: ref done`);
      } catch (err) {
        failed++;
        console.warn(`[BatchRefImageGenerate] Shot ${shot.sequence} ref failed:`, err);
      }
    }

    await db.update(shots).set({ status: "pending" }).where(eq(shots.id, shot.id));

    results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", generated, failed });
    if (taskId) updateTaskProgress(taskId, { total: allShots.length, completed: results.length, failed: results.filter(r => r.generated === 0 && r.failed > 0).map(r => r.shotId) });
  }

  if (taskId) completeTask(taskId, { total: allShots.length, completed: results.length, failed: results.filter(r => r.generated === 0 && r.failed > 0).map(r => r.shotId) });
  return NextResponse.json({ results });
}

export async function handleSingleShotRefImageGenerateAll(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const shotView = await loadShotLegacyView(shot.id);
  const refImages = shotView.referenceImages;
  const targets = refImages.filter((r) => r.status === "pending" && r.prompt.trim());

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, message: "No pending reference images" });
  }

  console.log(`[SingleShotRefImageAll] Shot ${shot.sequence}: generating ${targets.length} ref images`);

  const ratio = (payload?.ratio as string) || DEFAULT_ASPECT_RATIO;
  const imgOpts = ratioToImageOpts(ratio);
  const imageProvider = resolveImageProvider(modelConfig);

  // Collect character reference images for subject consistency
  const charRefMap = new Map<string, string>();
  if (projectId) {
    const chars = await db
      .select({ name: charactersTable.name, referenceImage: charactersTable.referenceImage })
      .from(charactersTable)
      .where(eq(charactersTable.projectId, projectId));
    for (const c of chars) {
      if (c.referenceImage) charRefMap.set(c.name, c.referenceImage);
    }
  }

  let generated = 0;
  let failed = 0;
  for (const entry of targets) {
    try {
      const entryRefs: string[] = [];
      if (entry.characters) {
        for (const name of entry.characters) {
          const ref = charRefMap.get(name);
          if (ref) entryRefs.push(ref);
        }
      }
      entryRefs.splice(6);

      const imagePath = await imageProvider.generateImage(entry.prompt, {
        quality: DEFAULT_IMAGE_QUALITY,
        ...imgOpts,
        ...(entryRefs.length > 0 && { referenceImages: entryRefs }),
        ...(entryRefs.length > 0 && entry.characters && { referenceLabels: entry.characters }),
      });
      await insertAssetVersion({
        shotId: shot.id, type: "reference", sequenceInType: entry.sequenceInType,
        prompt: entry.prompt, fileUrl: imagePath, status: "completed",
        characters: entry.characters ?? undefined,
        generationId: genId(),
      });
      generated++;
      console.log(`[SingleShotRefImageAll] Shot ${shot.sequence}: ref "${entry.id}" done`);
    } catch (err) {
      failed++;
      console.error(`[SingleShotRefImageAll] Shot ${shot.sequence} ref "${entry.id}" failed`, err);
    }
  }

  return NextResponse.json({ shotId, generated, failed });
}
