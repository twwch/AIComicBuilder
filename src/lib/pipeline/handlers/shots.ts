import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects, episodes, characters, shots, dialogues, storyboardVersions, characterRelations, episodeCharacters } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  type ModelConfig,
  findBoundAgent,
  callAndValidateAgent,
  getEpisodeCharacters,
  resolveGenerationMode,
  extractErrorMessage,
  logDetailedError,
  summarizeProviderConfig,
  shouldUseStrictJsonMode,
} from "@/lib/generate-utils";
import { buildShotSplitPrompt, SHOT_SPLIT_SYSTEM } from "@/lib/ai/prompts/shot-split";
import { recommendTransitions } from "@/lib/transition-recommender";
import { id as genId } from "@/lib/id";
import { registerTask } from "@/lib/task-registry";
import { updateTaskProgress, completeTask, failTask } from "@/lib/task-utils";
import {
  loadShotLegacyView,
  getActiveAsset,
  insertAssetVersion,
  patchAsset,
  type ShotAssetType,
} from "@/lib/shot-asset-utils";

async function upsertPromptAsset(shotId: string, type: ShotAssetType, prompt: string) {
  const existing = await getActiveAsset(shotId, type, 0);
  if (existing) {
    await patchAsset(existing.id, { prompt });
  } else {
    await insertAssetVersion({ shotId, type, sequenceInType: 0, prompt, status: "pending", generationId: genId() });
  }
}

type ParsedShot = {
  sequence: number;
  sceneDescription: string;
  startFrame: string;
  endFrame: string;
  motionScript: string;
  videoScript?: string;
  duration: number;
  dialogues: Array<{ character: string; text: string }>;
  cameraDirection?: string;
  transitionIn?: string;
  transitionOut?: string;
  sceneId?: string;
  compositionGuide?: string;
  focalPoint?: string;
  depthOfField?: string;
  soundDesign?: string;
  musicCue?: string;
  characters?: string[];
  referenceImagePrompts?: string[];
};

/** Split screenplay text into chunks by SCENE markers, ~maxScenes per chunk.
 *  Preserves the header (VISUAL STYLE + CHARACTERS) and prepends it to every chunk. */
function splitScriptByScenes(script: string, maxScenes: number): string[] {
  // Match SCENE markers with optional markdown bold (**), whitespace, or other decorators
  const scenePattern = /^[\s*#]*(?:SCENE|场景)\s*\d+/i;
  const lines = script.split("\n");

  // Find scene boundary line indices
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (scenePattern.test(lines[i].trim())) {
      boundaries.push(i);
    }
  }

  // If no scene markers found or few scenes, return as single chunk
  if (boundaries.length <= maxScenes) {
    return [script];
  }

  // Everything before the first SCENE marker is the header (VISUAL STYLE + CHARACTERS)
  const header = lines.slice(0, boundaries[0]).join("\n").trim();

  // Group scenes into chunks, prepend header to each
  const chunks: string[] = [];
  for (let i = 0; i < boundaries.length; i += maxScenes) {
    const start = boundaries[i];
    const end = i + maxScenes < boundaries.length
      ? boundaries[i + maxScenes]
      : lines.length;
    const scenesText = lines.slice(start, end).join("\n");
    chunks.push(header ? `${header}\n\n${scenesText}` : scenesText);
  }

  return chunks;
}

export async function handleShotSplitStream(
  projectId: string,
  userId: string,
  _payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
) {
  const taskSignal = taskId ? registerTask(taskId).signal : undefined;
  if (taskId) updateTaskProgress(taskId, { total: 0, completed: 0, failed: [] });
  let script: string | null = null;
  if (episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!episode) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }
    script = episode.script ?? null;
  } else {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    script = project.script ?? null;
  }

  // === 智能体路由 ===
  console.log(`[ShotSplit] projectId=${projectId}, episodeId=${episodeId}, script length=${script?.length ?? 0}`);
  console.log("[ShotSplit] text model", summarizeProviderConfig(modelConfig?.text));

  if (!script?.trim()) {
    return NextResponse.json(
      { error: episodeId ? "当前分集还没有剧本内容，请先生成或填写剧本" : "当前项目还没有剧本内容，请先生成或填写剧本" },
      { status: 400 }
    );
  }

  {
    const boundAgent = await findBoundAgent(projectId, "shot_split");
    if (boundAgent) {
      if (!script) {
        // Agent 模式下也需要剧本 — 尝试从 episode 或 project 重新获取
        if (episodeId) {
          const [ep] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
          script = ep?.script ?? null;
        }
        if (!script) {
          const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
          script = proj?.script ?? null;
        }
        if (!script) {
          return NextResponse.json({ error: "没有剧本内容，请先编写或生成剧本" }, { status: 400 });
        }
      }
      const agentResult = await callAndValidateAgent(boundAgent, "shot_split", script);
      if (agentResult instanceof NextResponse) return agentResult;

      // Parse agent output and save to DB (same logic as built-in pipeline)
      const agentParsed = JSON.parse(extractJSON(agentResult.text));
      let agentShots: ParsedShot[];
      let agentSceneGroup = 0;
      if (Array.isArray(agentParsed) && agentParsed.length > 0 && agentParsed[0].shots) {
        agentShots = agentParsed.flatMap((scene: { sceneDescription?: string; shots?: ParsedShot[] }) => {
          const shots = (scene.shots || []).map((s) => ({
            ...s,
            sceneDescription: s.sceneDescription || scene.sceneDescription || "",
            sceneId: `sg_${agentSceneGroup}`,
          }));
          if (shots.length > 0) agentSceneGroup++;
          return shots;
        });
      } else if (Array.isArray(agentParsed)) {
        agentShots = agentParsed.map((s) => ({ ...s, sceneId: `sg_${agentSceneGroup++}` }));
      } else {
        agentShots = (agentParsed.shots || []).map((s: ParsedShot) => ({ ...s, sceneId: `sg_${agentSceneGroup}` }));
      }
      agentShots.forEach((s, i) => { s.sequence = i + 1; });

      // ── Fill transition recommendations ──
      const agentRecs = recommendTransitions(agentShots.map((s) => ({
        id: "tmp",
        sequence: s.sequence,
        prompt: s.sceneDescription,
        motionScript: s.motionScript ?? null,
        videoScript: s.videoScript ?? null,
        cameraDirection: s.cameraDirection ?? null,
        duration: s.duration ?? null,
        sceneId: s.sceneId ?? null,
        transitionIn: null,
        transitionOut: null,
      })));
      for (const rec of agentRecs) {
        const shot = agentShots.find((s) => s.sequence === rec.sequence);
        if (shot) {
          shot.transitionIn = rec.recommendedTransitionIn;
          shot.transitionOut = rec.recommendedTransitionOut;
        }
      }

      if (agentShots.length === 0) {
        return NextResponse.json({ error: "智能体未返回有效分镜数据" }, { status: 422 });
      }

      // Fetch characters for dialogue matching
      const agentCharacters = await getEpisodeCharacters(projectId, episodeId);

      // Create version
      const agentVerWhere = episodeId
        ? and(eq(storyboardVersions.projectId, projectId), eq(storyboardVersions.episodeId, episodeId))
        : eq(storyboardVersions.projectId, projectId);
      const [agentMaxVer] = await db.select({ maxNum: storyboardVersions.versionNum })
        .from(storyboardVersions).where(agentVerWhere).orderBy(desc(storyboardVersions.versionNum)).limit(1);
      const agentNextVer = (agentMaxVer?.maxNum ?? 0) + 1;
      const agentDate = new Date();
      const agentDateStr = agentDate.getUTCFullYear().toString() +
        String(agentDate.getUTCMonth() + 1).padStart(2, "0") +
        String(agentDate.getUTCDate()).padStart(2, "0");
      const agentVersionId = genId();
      await db.insert(storyboardVersions).values({
        id: agentVersionId, projectId, label: `${agentDateStr}-V${agentNextVer}`,
        versionNum: agentNextVer, createdAt: agentDate, episodeId: episodeId ?? null,
      });

      // Batch insert shots
      const agentShotRows = agentShots.map((shot) => ({
        id: genId(),
        projectId,
        versionId: agentVersionId,
        sequence: shot.sequence,
        prompt: shot.startFrame || shot.sceneDescription || "",
        motionScript: shot.motionScript || "",
        videoScript: shot.videoScript ?? null,
        cameraDirection: shot.cameraDirection || "static",
        duration: shot.duration || 8,
        transitionIn: shot.transitionIn || "cut",
        transitionOut: shot.transitionOut || "cut",
        sceneId: shot.sceneId ?? null,
        compositionGuide: shot.compositionGuide || "",
        focalPoint: shot.focalPoint || "",
        depthOfField: shot.depthOfField || "medium",
        soundDesign: shot.soundDesign || "",
        musicCue: shot.musicCue || "",
        episodeId: episodeId ?? null,
      }));
      await db.insert(shots).values(agentShotRows);

      // Batch insert dialogues
      const agentDialogueRows = agentShots.flatMap((shot, si) => {
        const shotId = agentShotRows[si].id;
        return (shot.dialogues || []).flatMap((d, i) => {
          const mc = agentCharacters.find((c) => c.name === d.character);
          return mc ? [{ id: genId(), shotId, characterId: mc.id, text: d.text, sequence: i }] : [];
        });
      });
      if (agentDialogueRows.length > 0) {
        await db.insert(dialogues).values(agentDialogueRows);
      }
      console.log(`[ShotSplit Agent] Created ${agentShots.length} shots`);
      return NextResponse.json({ shots: agentShots.length });
    }
  }
  // === 智能体路由结束 ===

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  // Fetch only characters linked to this episode
  let shotCharacters: typeof characters.$inferSelect[];
  if (episodeId) {
    const linkedIds = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    shotCharacters = linkedIds.length > 0
      ? await db.select().from(characters).where(inArray(characters.id, linkedIds.map((r) => r.characterId)))
      : [];
  } else {
    shotCharacters = await db.select().from(characters).where(eq(characters.projectId, projectId));
  }

  const characterDescriptions = shotCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const characterVisualHints = shotCharacters
    .filter((c) => c.visualHint)
    .map((c) => ({ name: c.name, visualHint: c.visualHint! }));

  const characterPerformanceStyles = shotCharacters
    .filter((c) => c.performanceStyle)
    .map((c) => ({ name: c.name, performanceStyle: c.performanceStyle! }));

  // Load character relationships — CRITICAL for shot planning. Without
  // this block the LLM treats enemies as bystanders (e.g. "如来佛祖" gets
  // rendered as a Buddha statue in the background instead of an active
  // combatant against 孙悟空).
  const shotRelations = await db
    .select()
    .from(characterRelations)
    .where(eq(characterRelations.projectId, projectId));
  let relationsText = "";
  if (shotRelations.length > 0) {
    relationsText = "\n\n## 角色关系（必须用于决定站位、眼神、肢体对抗、画面张力）\n";
    for (const rel of shotRelations) {
      const charA = shotCharacters.find((c) => c.id === rel.characterAId);
      const charB = shotCharacters.find((c) => c.id === rel.characterBId);
      if (charA && charB) {
        relationsText += `- ${charA.name} ↔ ${charB.name}：${rel.relationType}${rel.description ? `（${rel.description}）` : ""}\n`;
      }
    }
    relationsText += `
**关系驱动构图规则（最高优先级）**：
- **敌对 / 对立 / 仇人**：两人必须都是**活人角色同屏对峙**——直接对视、肢体对抗、武器对准彼此。禁止把任一方画成背景的雕像/神像/虚影/浮雕。
- **友好 / 盟友**：并肩、相互掩护、眼神交流。
- **爱慕 / 亲密**：靠近、牵手、拥抱、温柔对视。
- **父女 / 师徒**：长辈在前/侧，晚辈在后/侧随从。
- 任何被标记为角色关系的双方，在包含他们的镜头中都必须作为**真实的活人**出现，而不是背景装饰。
`;
  }

  // Fetch world setting and target duration from project
  const [projData] = await db.select({ worldSetting: projects.worldSetting, targetDuration: projects.targetDuration }).from(projects).where(eq(projects.id, projectId));
  let targetDuration = projData?.targetDuration || 0;
  if (episodeId) {
    const [epDur] = await db.select({ targetDuration: episodes.targetDuration }).from(episodes).where(eq(episodes.id, episodeId));
    if (epDur?.targetDuration && epDur.targetDuration > 0) targetDuration = epDur.targetDuration;
  }

  const model = createLanguageModel(modelConfig.text);
  const systemPrompt = SHOT_SPLIT_SYSTEM;
  const useStrictJsonMode = shouldUseStrictJsonMode(modelConfig.text);
  const jsonMode = useStrictJsonMode
    ? { openai: { response_format: { type: "json_object" } } }
    : undefined;
  console.log("[ShotSplit] output mode", {
    strictJsonMode: useStrictJsonMode,
    model: summarizeProviderConfig(modelConfig?.text),
  });

  // Split screenplay into smaller chunks to reduce upstream timeout risk.
  const fullScript = script || "";
  const visualStyleReference = fullScript
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith("视觉风格参考："))
    ?.split("：").slice(1).join("：").trim();
  const sceneChunks = splitScriptByScenes(fullScript, 2);
  // Log scene detection details
  const sceneRe = /^[\s*#]*(?:SCENE|场景)\s*\d+/i;
  const sceneMatches = fullScript.split("\n").filter((l) => sceneRe.test(l.trim()));
  console.log(`[ShotSplit] Detected ${sceneMatches.length} scenes, split into ${sceneChunks.length} chunk(s) of ~8 scenes each`);
  sceneChunks.forEach((c, i) => {
    const sceneCount = c.split("\n").filter((l) => sceneRe.test(l.trim())).length;
    console.log(`[ShotSplit] Chunk ${i + 1}: ${sceneCount} scenes, ${c.length} chars`);
  });

  async function generateShotSplitChunk(
    chunk: string,
    label: string
  ): Promise<{ shots: ParsedShot[]; error: string | null }> {
    let prompt = buildShotSplitPrompt(
      chunk,
      characterDescriptions,
      characterVisualHints,
      undefined,
      characterPerformanceStyles.length > 0 ? characterPerformanceStyles : undefined,
      visualStyleReference,
    );

    if (relationsText) prompt += relationsText;

    if (projData?.worldSetting) {
      prompt = `【世界观设定】\n${projData.worldSetting}\n\n所有镜头必须与此世界观设定保持一致。\n\n` + prompt;
    }

    if (targetDuration && targetDuration > 0) {
      prompt += `\n\n目标总时长：${targetDuration}秒（${Math.floor(targetDuration / 60)}分${targetDuration % 60}秒）。请确保所有镜头的时长之和接近此目标。\n`;
    }

    try {
      const result = await generateText({
        model,
        system: systemPrompt,
        prompt,
        temperature: useStrictJsonMode ? undefined : 0.2,
        providerOptions: jsonMode,
      });
      const parsed = JSON.parse(extractJSON(result.text));
      let shotList: ParsedShot[];
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].shots) {
        shotList = parsed.flatMap((scene: { sceneDescription?: string; shots?: ParsedShot[] }) =>
          (scene.shots || []).map((s) => ({
            ...s,
            sceneDescription: s.sceneDescription || scene.sceneDescription || "",
          }))
        );
      } else if (Array.isArray(parsed)) {
        shotList = parsed;
      } else {
        shotList = parsed.shots || [];
      }
      console.log(`[ShotSplit] ${label}: ${shotList.length} shots, keys: ${shotList[0] ? Object.keys(shotList[0]).join(",") : "empty"}`);
      return { shots: shotList, error: null };
    } catch (err) {
      const message = extractErrorMessage(err);
      logDetailedError(`[ShotSplit] ${label} failed`, err);
      return { shots: [], error: `${label}: ${message}` };
    }
  }

  function splitChunkIntoSingleScenes(chunk: string): string[] {
    return splitScriptByScenes(chunk, 1);
  }

  // Process chunks (up to 3 in parallel) to reduce total wall-clock time.
  const chunkResults: Array<{ shots: ParsedShot[]; error: string | null }> = [];
  const CONCURRENCY = 3;
  if (taskId) updateTaskProgress(taskId, { total: sceneChunks.length, completed: 0, failed: [] });
  for (let start = 0; start < sceneChunks.length; start += CONCURRENCY) {
    if (taskSignal?.aborted) { completeTask(taskId!, { total: sceneChunks.length, completed: chunkResults.reduce((s, r) => s + r.shots.length, 0), failed: ["Cancelled"] }); return NextResponse.json({ error: "Cancelled" }, { status: 499 }); }
    const batch = sceneChunks.slice(start, start + CONCURRENCY);
    console.log(`[ShotSplit] Processing batch ${Math.floor(start / CONCURRENCY) + 1}/${Math.ceil(sceneChunks.length / CONCURRENCY)} (${batch.length} chunk(s))`);
    const batchResults = await Promise.allSettled(
      batch.map((chunk, i) => {
        const idx = start + i;
        return generateShotSplitChunk(chunk, `Chunk ${idx + 1}/${sceneChunks.length}`);
      })
    );
    for (let i = 0; i < batchResults.length; i++) {
      const idx = start + i;
      const settled = batchResults[i];
      const primaryResult = settled.status === "fulfilled" ? settled.value : { shots: [], error: `Chunk ${idx + 1}: ${settled.reason instanceof Error ? settled.reason.message : String(settled.reason)}` };

      if (!primaryResult.error) {
        chunkResults.push(primaryResult);
        continue;
      }

      const singleSceneChunks = splitChunkIntoSingleScenes(batch[i]);
      if (singleSceneChunks.length <= 1) {
        chunkResults.push(primaryResult);
        continue;
      }

      console.log(`[ShotSplit] Chunk ${idx + 1}: retrying as ${singleSceneChunks.length} single-scene chunk(s)`);
      const fallbackShots: ParsedShot[] = [];
      let fallbackError: string | null = null;
      for (let subIdx = 0; subIdx < singleSceneChunks.length; subIdx++) {
        if (taskSignal?.aborted) { completeTask(taskId!, { total: sceneChunks.length, completed: chunkResults.reduce((s, r) => s + r.shots.length, 0), failed: ["Cancelled"] }); return NextResponse.json({ error: "Cancelled" }, { status: 499 }); }
        const subResult = await generateShotSplitChunk(
          singleSceneChunks[subIdx],
          `Chunk ${idx + 1}.${subIdx + 1}/${singleSceneChunks.length}`
        );
        if (subResult.error) {
          fallbackError = subResult.error;
          break;
        }
        fallbackShots.push(...subResult.shots);
      }

      if (fallbackError) {
        chunkResults.push({ shots: [], error: fallbackError });
      } else {
        chunkResults.push({ shots: fallbackShots, error: null });
      }
    }
    if (taskId) updateTaskProgress(taskId, { total: sceneChunks.length, completed: Math.min(start + CONCURRENCY, sceneChunks.length), failed: chunkResults.filter(r => r.error).map(r => r.error!).filter(Boolean) });
  }

  // Merge and re-sequence, assigning scene group IDs by chunk origin
  const allShots: ParsedShot[] = [];
  let sceneGroup = 0;
  for (const result of chunkResults) {
    for (const shot of result.shots) {
      shot.sceneId = `sg_${sceneGroup}`;
      allShots.push(shot);
    }
    if (result.shots.length > 0) sceneGroup++;
  }
  allShots.forEach((s, i) => { s.sequence = i + 1; });

  // ── Fill transition recommendations ──
  const recs = recommendTransitions(allShots.map((s) => ({
    id: "tmp",
    sequence: s.sequence,
    prompt: s.sceneDescription,
    motionScript: s.motionScript ?? null,
    videoScript: s.videoScript ?? null,
    cameraDirection: s.cameraDirection ?? null,
    duration: s.duration ?? null,
    sceneId: s.sceneId ?? null,
    transitionIn: null,
    transitionOut: null,
  })));
  for (const rec of recs) {
    const shot = allShots.find((s) => s.sequence === rec.sequence);
    if (shot) {
      shot.transitionIn = rec.recommendedTransitionIn;
      shot.transitionOut = rec.recommendedTransitionOut;
    }
  }

  if (allShots.length === 0) {
    const errors = chunkResults
      .map((result) => result.error)
      .filter((error): error is string => Boolean(error));
    const errorMsg = errors[0] || "Failed to generate shots";
    if (taskId) failTask(taskId, errorMsg);
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }

  // Create version record
  const versionWhereClause = episodeId
    ? and(eq(storyboardVersions.projectId, projectId), eq(storyboardVersions.episodeId, episodeId))
    : eq(storyboardVersions.projectId, projectId);
  const [maxVersionRow] = await db
    .select({ maxNum: storyboardVersions.versionNum })
    .from(storyboardVersions)
    .where(versionWhereClause)
    .orderBy(desc(storyboardVersions.versionNum))
    .limit(1);
  const nextVersionNum = (maxVersionRow?.maxNum ?? 0) + 1;
  const today = new Date();
  const dateStr = today.getUTCFullYear().toString() +
    String(today.getUTCMonth() + 1).padStart(2, "0") +
    String(today.getUTCDate()).padStart(2, "0");
  const versionLabel = `${dateStr}-V${nextVersionNum}`;
  const versionId = genId();
  await db.insert(storyboardVersions).values({
    id: versionId,
    projectId,
    label: versionLabel,
    versionNum: nextVersionNum,
    createdAt: new Date(),
    episodeId: episodeId ?? null,
  });
  console.log(`[ShotSplit] Created storyboard version ${versionLabel} (${versionId}) for project ${projectId}${episodeId ? ` episode ${episodeId}` : ""}`);

  // Batch insert shots
  const shotRows = allShots.map((shot) => ({
    id: genId(),
    projectId,
    versionId,
    sequence: shot.sequence,
    prompt: shot.sceneDescription,
    motionScript: shot.motionScript,
    videoScript: shot.videoScript ?? null,
    cameraDirection: shot.cameraDirection || "static",
    duration: shot.duration,
    transitionIn: shot.transitionIn || "cut",
    transitionOut: shot.transitionOut || "cut",
    sceneId: shot.sceneId ?? null,
    compositionGuide: shot.compositionGuide || "",
    focalPoint: shot.focalPoint || "",
    depthOfField: shot.depthOfField || "medium",
    soundDesign: shot.soundDesign || "",
    musicCue: shot.musicCue || "",
    episodeId: episodeId ?? null,
  }));
  await db.insert(shots).values(shotRows);

  // Batch insert dialogues
  const dialogueRows = allShots.flatMap((shot, si) => {
    const shotId = shotRows[si].id;
    return (shot.dialogues || []).flatMap((d, i) => {
      const matchedChar = shotCharacters.find(
        (c: typeof characters.$inferSelect) => c.name === d.character
      );
      return matchedChar
        ? [{ id: genId(), shotId, characterId: matchedChar.id, text: d.text, sequence: i }]
        : [];
    });
  });
  if (dialogueRows.length > 0) {
    await db.insert(dialogues).values(dialogueRows);
  }

  console.log(`[ShotSplit] Created ${allShots.length} shots from ${sceneChunks.length} chunks into version ${versionLabel} (${versionId})`);
  if (taskId) completeTask(taskId, { total: sceneChunks.length, completed: sceneChunks.length, failed: chunkResults.filter(r => r.error).map(r => r.error!) });
  return NextResponse.json({ shots: allShots.length });
}

// --- reset_stuck_shots: Reset shots stuck at "generating" back to "pending" ---

export async function handleResetStuckShots(
  projectId: string,
  _userId: string,
  payload?: Record<string, unknown>,
  _modelConfig?: ModelConfig,
  episodeId?: string
) {
  const conditions = [eq(shots.projectId, projectId), eq(shots.status, "generating")];
  if (episodeId) conditions.push(eq(shots.episodeId, episodeId));
  if (payload?.versionId) conditions.push(eq(shots.versionId, payload.versionId as string));

  const stuckShots = await db.select({ id: shots.id, sequence: shots.sequence }).from(shots).where(and(...conditions));

  if (stuckShots.length === 0) {
    return NextResponse.json({ results: [], message: "No stuck shots found" });
  }

  await db.update(shots).set({ status: "pending" }).where(and(...conditions));

  console.log(`[ResetStuckShots] Reset ${stuckShots.length} shot(s)`);
  return NextResponse.json({ results: stuckShots, count: stuckShots.length });
}

// --- single_shot_rewrite: regenerate text fields for one shot ---

export async function handleSingleShotRewrite(
  projectId: string,
  _userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.text) {
    return NextResponse.json({ error: "No text model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  const shotView = await loadShotLegacyView(shot.id);

  const shotEpisodeId = episodeId || shot.episodeId;
  const generationMode = await resolveGenerationMode(projectId, shotEpisodeId);
  const projectCharacters = await getEpisodeCharacters(projectId, shotEpisodeId);
  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");
  const characterVisualHints = projectCharacters
    .filter((c) => c.visualHint)
    .map((c) => `${c.name}：${c.visualHint}`)
    .join("\n");

  const model = createLanguageModel(modelConfig.text);

  const prompt = `You are a storyboard director. Rewrite the text fields for a single shot so the descriptions are vivid, safe for AI image generation, and free of any potentially sensitive content.

Current shot (sequence ${shot.sequence}):
- Scene description: ${shot.prompt || ""}
- Start frame: ${shotView.startFrameDesc || ""}
- End frame: ${shotView.endFrameDesc || ""}
- Motion script: ${shot.motionScript || ""}
- Video script: ${shot.videoScript || ""}
- Camera direction: ${shot.cameraDirection || "static"}
- Duration: ${shot.duration}s

Character references:
${characterDescriptions || "none"}
${characterVisualHints ? `\nCHARACTER VISUAL IDs (MANDATORY — whenever a character appears in any field, write their name followed by exactly this identifier in parentheses, e.g. 天枢真君（银发金瞳）. Never invent alternatives):\n${characterVisualHints}` : ""}

Return ONLY a JSON object (no markdown fences) with these fields:
{
  "prompt": "rewritten scene description",
  "startFrameDesc": "rewritten start frame description",
  "endFrameDesc": "rewritten end frame description",
  "motionScript": "rewritten motion script in time-segmented format (0-Xs: ... Xs-Ys: ...)",
  "videoScript": "rewritten concise video model prompt: 1-2 sentences, no timestamps, just core motion and camera arc",
  "cameraDirection": "camera direction (keep original or adjust)"
}

IMPORTANT: Keep the same scene, characters, and narrative intent. Only rephrase to avoid safety filter triggers. Match the language of the original text.`;

  console.log(`[SingleShotRewrite] Shot ${shot.sequence} prompt:\n${prompt}`);

  try {
    const { text } = await import("ai").then(({ generateText }) =>
      generateText({ model, prompt, temperature: 0.7 })
    );

    const parsed = JSON.parse(extractJSON(text)) as {
      prompt: string;
      startFrameDesc: string;
      endFrameDesc: string;
      motionScript: string;
      videoScript?: string;
      cameraDirection: string;
    };

    await db
      .update(shots)
      .set({
        prompt: parsed.prompt,
        motionScript: parsed.motionScript,
        videoScript: parsed.videoScript ?? null,
        cameraDirection: parsed.cameraDirection,
      })
      .where(eq(shots.id, shotId));
    const startType = generationMode === "4grid" ? "panel_1" : "first_frame";
    const endType = generationMode === "4grid" ? "panel_4" : "last_frame";
    await upsertPromptAsset(shotId, startType, parsed.startFrameDesc);
    await upsertPromptAsset(shotId, endType, parsed.endFrameDesc);

    return NextResponse.json({ shotId, status: "ok", ...parsed });
  } catch (err) {
    console.error(`[SingleShotRewrite] Error for shot ${shotId}:`, err);
    return NextResponse.json({ shotId, status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}
