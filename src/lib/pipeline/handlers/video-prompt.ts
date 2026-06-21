import { NextResponse } from "next/server";
import fs from "fs";
import { db } from "@/lib/db";
import { DEFAULT_SHOT_DURATION, DEFAULT_CAMERA_DIRECTION } from "@/lib/config/defaults";
import { shots, characters, dialogues, projects, episodes } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import {
  type ModelConfig,
  extractErrorMessage,
  isCharacterOnScreen,
  getEpisodeCharacters,
  findBoundAgent,
  callAndValidateAgent,
  resolveGenerationMode,
} from "@/lib/generate-utils";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { extractJSON } from "@/lib/ai/ai-sdk";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { buildRefVideoPromptRequest } from "@/lib/ai/prompts/ref-video-prompt-generate";
import { inferVideoPromptFamily } from "@/lib/ai/video-model-strategy";
import { loadShotLegacyView, loadShotLegacyViewsBatch, type ShotLegacyView } from "@/lib/shot-asset-utils";
import type { AgentCategory } from "@/lib/ai/agent-caller";
import { diagnosticError } from "@/lib/pipeline/diagnostics";
import { extractPrimaryVisualStyleReference } from "@/lib/visual-style";
import { registerTask } from "@/lib/task-registry";
import { updateTaskProgress, completeTask } from "@/lib/task-utils";

function getPanelFrames(view: ShotLegacyView): string[] {
  return view.panels.filter((p): p is string => !!p);
}

function getPanelFrameInfos(frameCount: number, characterCount: number) {
  const labels = ["PANEL 1（开场）", "PANEL 2（发展）", "PANEL 3（转折）", "PANEL 4（收束）"];
  return Array.from({ length: frameCount }, (_, i) => ({
    label: labels[i] ?? `PANEL ${i + 1}`,
    index: characterCount + i + 1,
  }));
}

const TEXT_VISION_MAX_IMAGES = 6;
const TEXT_VISION_MAX_TOTAL_BYTES = 2_500_000;

function selectTextVisionFrames(frames: string[]): string[] {
  const selected: string[] = [];
  let totalBytes = 0;

  for (const frame of frames.slice(0, TEXT_VISION_MAX_IMAGES)) {
    let size = 0;
    try {
      size = fs.statSync(frame).size;
    } catch {
      // Keep unreadable/non-local inputs so provider-level handling can decide.
      selected.push(frame);
      continue;
    }

    if (selected.length > 0 && totalBytes + size > TEXT_VISION_MAX_TOTAL_BYTES) {
      continue;
    }

    selected.push(frame);
    totalBytes += size;
  }

  return selected.length > 0 ? selected : frames.slice(0, 1);
}

function buildFallbackVideoPrompt(params: {
  motionContext: string;
  cameraDirection: string;
  duration: number;
  sceneFrames: ReturnType<typeof getPanelFrameInfos>;
  dialogues?: Array<{ characterName: string; text: string }>;
}): string {
  const sceneFlow = params.sceneFrames
    .map((f) => `@图片${f.index}（${f.label}）`)
    .join(" → ");
  const dialogueText = params.dialogues?.length
    ? ` ${params.dialogues.map((d) => `${d.characterName}台词：${d.text}`).join("；")}`
    : "";
  return `${sceneFlow} 按顺序展开成一个连续镜头：${params.motionContext || "延续画面中的动作与情绪"}。镜头运动：${params.cameraDirection}，节奏控制在 ${Math.min(params.duration, 10)} 秒内，动作连贯自然，主体稳定，避免跳切。${dialogueText}`.trim();
}

export async function handleSingleVideoPrompt(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string
) {
  const shotId = payload?.shotId as string;
  console.log(`[SingleVideoPrompt] called, shotId=${shotId}`);
  if (!shotId) {
    return NextResponse.json(
      diagnosticError("PIPE_001", "shotId required", "Pass payload.shotId when calling single video prompt generation."),
      { status: 400 },
    );
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId)).limit(1);
  if (!shot) {
    return NextResponse.json(
      diagnosticError("PIPE_003", "Shot not found", "Verify the shotId belongs to the current project/version."),
      { status: 404 },
    );
  }
  const shotView = await loadShotLegacyView(shot.id);
  const promptFamily = inferVideoPromptFamily(modelConfig);
  const scriptSource = shot.episodeId
    ? await db.select({ script: episodes.script, idea: episodes.idea }).from(episodes).where(eq(episodes.id, shot.episodeId))
    : await db.select({ script: projects.script, idea: projects.idea }).from(projects).where(eq(projects.id, projectId));
  const script = scriptSource[0]?.script || "";
  const idea = scriptSource[0]?.idea || "";
  const visualStyleReference = extractPrimaryVisualStyleReference(script, idea);

  const genMode = await resolveGenerationMode(projectId, shot.episodeId);

  // Keyframe mode: pass first + last frames for transition description
  // Reference mode: pass ALL scene reference frames (ordered) so multi-
  // scene shots (ground → sky etc.) get the full spatial context.
  const visionFrames: string[] = [];
  const sceneMetaList: Array<{ sceneName?: string } | null> = [];
  if (genMode === "4grid") {
    visionFrames.push(...getPanelFrames(shotView));
    sceneMetaList.push(...visionFrames.map(() => null));
  } else if (genMode === "reference") {
    const sceneAssets = shotView.referenceImages
      .filter((r) => r.fileUrl)
      .sort((a, b) => a.sequenceInType - b.sequenceInType);
    for (const r of sceneAssets) {
      visionFrames.push(r.fileUrl as string);
      sceneMetaList.push((r.meta as { sceneName?: string } | null) ?? null);
    }
    if (visionFrames.length === 0 && shotView.sceneRefFrame) {
      visionFrames.push(shotView.sceneRefFrame);
      sceneMetaList.push(null);
    }
  } else {
    if (shotView.firstFrame) visionFrames.push(shotView.firstFrame);
    if (shotView.lastFrame) visionFrames.push(shotView.lastFrame);
    if (visionFrames.length === 0 && shotView.sceneRefFrame) visionFrames.push(shotView.sceneRefFrame);
  }
  console.log(`[SingleVideoPrompt] shot.sequence=${shot.sequence}, mode=${genMode}, frames=${visionFrames.length}`);
  if (visionFrames.length === 0) {
    return NextResponse.json(
      diagnosticError("PIPE_004", "No frame available. Generate frames first.", "Generate the required frame assets for the current generation mode before video prompt generation."),
      { status: 400 },
    );
  }

  const shotCharacters = await db.select().from(characters).where(eq(characters.projectId, shot.projectId));
  const shotDialogues = await db
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));
  const videoContextForDialogue = shot.videoScript || shot.motionScript || shot.prompt || "";

  const dialogueList = shotDialogues.map((d) => {
    const char = shotCharacters.find((c) => c.id === d.characterId);
    const characterName = char?.name ?? "Unknown";
    const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shotView.startFrameDesc);
    const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
    return {
      characterName,
      text: d.text,
      offscreen: !onScreen,
      visualHint,
    };
  });

  try {
    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const effectiveDuration = Math.min(shot.duration ?? DEFAULT_SHOT_DURATION, videoMaxDuration);
    const textProvider = resolveAIProvider(modelConfig);
    const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
    const motionContext = shot.motionScript || shot.videoScript || shot.prompt || "";
    // Filter to characters declared on this shot's reference assets
    const shotCharNameSetVP = new Set<string>();
    for (const r of shotView.referenceImages) {
      for (const n of r.characters ?? []) shotCharNameSetVP.add(n);
    }
    const charsWithRefsHere = shotCharacters.filter((c) => {
      if (!c.referenceImage) return false;
      if (shotCharNameSetVP.size > 0) return shotCharNameSetVP.has(c.name);
      // Fall back to matching character name in motion script text
      return motionContext.includes(c.name);
    }).slice(0, 6);
    const characterRefInfos = charsWithRefsHere.map((c, i) => ({
      name: c.name,
      index: i + 1,
      visualHint: c.visualHint,
    }));
    const sceneFrameInfos = genMode === "4grid"
      ? getPanelFrameInfos(visionFrames.length, charsWithRefsHere.length)
      : visionFrames.map((_, i) => {
          const name = sceneMetaList[i]?.sceneName || (visionFrames.length > 1 ? `场景-${i + 1}` : `场景`);
          return { label: name, index: charsWithRefsHere.length + i + 1 };
        });
    const promptRequest = buildRefVideoPromptRequest({
      motionScript: motionContext,
      cameraDirection: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
      duration: effectiveDuration,
      characters: characterRefInfos,
      sceneFrames: sceneFrameInfos,
      dialogues: dialogueList.length > 0 ? dialogueList : undefined,
      visualStyle: visualStyleReference || undefined,
      family: promptFamily,
    });
    console.log(`[SingleVideoPrompt] Shot ${shot.sequence} promptRequest:\n${promptRequest}`);
    const textVisionFrames = selectTextVisionFrames(visionFrames);
    console.log(`[SingleVideoPrompt] Shot ${shot.sequence}: sending ${textVisionFrames.length}/${visionFrames.length} frame(s) to text model`);
    const rawPrompt = await textProvider.generateText(promptRequest, {
      systemPrompt: refVideoSystem,
      images: textVisionFrames,
    });
    const promptBody = rawPrompt.trim() || buildFallbackVideoPrompt({
      motionContext,
      cameraDirection: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
      duration: effectiveDuration,
      sceneFrames: sceneFrameInfos,
      dialogues: dialogueList,
    });
    if (!rawPrompt.trim()) {
      console.warn(`[SingleVideoPrompt] Shot ${shot.sequence}: text provider returned empty output, using fallback prompt`);
    }
    const videoPrompt = `Duration: ${effectiveDuration}s.\n\n${promptBody}`;
    console.log(`[SingleVideoPrompt] Shot ${shot.sequence} videoPrompt:\n${videoPrompt}`);
    await db.update(shots).set({ videoPrompt }).where(eq(shots.id, shotId));
    return NextResponse.json({ shotId, videoPrompt, status: "ok" });
  } catch (err) {
    console.error("[SingleVideoPrompt] Error:", err);
    return NextResponse.json(
      {
        status: "error",
        ...diagnosticError(
          "PIPE_006",
          extractErrorMessage(err),
          "Inspect the text provider response and retry after fixing the upstream prompt or model issue.",
        ),
      },
      { status: 500 },
    );
  }
}

export async function handleBatchVideoPrompt(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
) {
  // === 智能体路由 ===
  // Check generation mode to decide which agent category to use
  const vpGenMode = await resolveGenerationMode(projectId, episodeId);
  const vpCategory: AgentCategory = vpGenMode === "reference" ? "ref_video_prompts" : "video_prompts";
  const vpBoundAgent = await findBoundAgent(projectId, vpCategory);
  if (vpBoundAgent) {
    // Build prompt from shots data (same info as built-in pipeline)
    const vpVersionId = payload?.versionId as string | undefined;
    const vpWhereConds = [eq(shots.projectId, projectId)];
    if (vpVersionId) vpWhereConds.push(eq(shots.versionId, vpVersionId));
    if (episodeId) vpWhereConds.push(eq(shots.episodeId, episodeId));
    const vpAgentShots = await db.select().from(shots).where(and(...vpWhereConds)).orderBy(asc(shots.sequence));
    if (vpAgentShots.length === 0) {
      return NextResponse.json(
        diagnosticError("PIPE_007", "没有分镜数据，请先生成分镜", "先生成或导入 shots，再批量生成视频提示词。"),
        { status: 400 },
      );
    }
    const vpAgentChars = await getEpisodeCharacters(projectId, episodeId);
    const vpScriptSource = episodeId
      ? await db.select({ script: episodes.script, idea: episodes.idea }).from(episodes).where(eq(episodes.id, episodeId))
      : await db.select({ script: projects.script, idea: projects.idea }).from(projects).where(eq(projects.id, projectId));
    const vpVisualStyleReference = extractPrimaryVisualStyleReference(vpScriptSource[0]?.script || "", vpScriptSource[0]?.idea || "");
    const vpPrompt = JSON.stringify({
      shots: vpAgentShots.map((s) => ({
        sequence: s.sequence,
        sceneDescription: s.prompt,
        motionScript: s.motionScript,
        videoScript: s.videoScript,
        cameraDirection: s.cameraDirection,
        duration: s.duration,
      })),
      characters: vpAgentChars.map((c) => ({ name: c.name, visualHint: c.visualHint })),
      visualStyleReference: vpVisualStyleReference,
    }, null, 2);

    const agentResult = await callAndValidateAgent(vpBoundAgent, "video_prompts", vpPrompt);
    if (agentResult instanceof NextResponse) return agentResult;

    // Parse agent output and save videoPrompt to each shot
    try {
      const vpParsed = JSON.parse(extractJSON(agentResult.text)) as Array<Record<string, unknown>>;

      let updatedCount = 0;
      for (const entry of vpParsed) {
        const seq = (entry.sequence as number) ?? (entry.shotSequence as number);
        const shot = vpAgentShots.find((s) => s.sequence === seq);
        if (!shot) continue;
        const videoPrompt = (entry.videoPrompt || entry.prompt || "") as string;
        if (videoPrompt) {
          await db.update(shots).set({ videoPrompt: `Duration: ${shot.duration || 8}s.\n\n${videoPrompt.trim()}` }).where(eq(shots.id, shot.id));
          updatedCount++;
        }
      }
      console.log(`[VideoPrompts Agent] Updated ${updatedCount} shots`);
      return NextResponse.json({ results: vpParsed.map((e) => ({ shotId: e.sequence, status: "ok" })), status: "ok" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        diagnosticError("PIPE_010", `智能体视频提示词解析失败: ${msg}`, "检查智能体输出是否为合法 JSON 数组，并重试该批任务。"),
        { status: 422 },
      );
    }
  }
  // === 智能体路由结束 ===

  const taskSignal = taskId ? registerTask(taskId).signal : undefined;
  const batchVersionId = payload?.versionId as string | undefined;

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const batchShots = await db.select().from(shots).where(and(...shotWhereConditions)).orderBy(asc(shots.sequence));
  const batchShotsLegacy = await loadShotLegacyViewsBatch(batchShots.map((s) => s.id));
  const promptFamily = inferVideoPromptFamily(modelConfig);
  const scriptSource = episodeId
    ? await db.select({ script: episodes.script, idea: episodes.idea }).from(episodes).where(eq(episodes.id, episodeId))
    : await db.select({ script: projects.script, idea: projects.idea }).from(projects).where(eq(projects.id, projectId));
  const script = scriptSource[0]?.script || "";
  const idea = scriptSource[0]?.idea || "";
  const visualStyleReference = extractPrimaryVisualStyleReference(script, idea);

  const batchCharacters = await getEpisodeCharacters(projectId, episodeId);

  // Determine generation mode for frame selection
  const batchGenMode = await resolveGenerationMode(projectId, episodeId);

  // Only process shots that have the frame assets required by the active mode.
  const eligible = batchShots.filter((s) => {
    const v = batchShotsLegacy.get(s.id);
    if (!v) return false;
    if (batchGenMode === "4grid") return getPanelFrames(v).length > 0;
    if (batchGenMode === "reference") return v.referenceImages.some((r) => r.fileUrl) || !!v.sceneRefFrame;
    return !!(v.firstFrame || v.lastFrame || v.sceneRefFrame);
  });

  const textProvider = resolveAIProvider(modelConfig);
  const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);

  console.log(`[BatchVideoPrompt] Processing ${eligible.length} shots (${batchShots.length} total, ${batchCharacters.length} chars, mode=${batchGenMode})`);
  const bvpStartTime = Date.now();
  let bvpDoneCount = 0;
  if (taskId) updateTaskProgress(taskId, { total: eligible.length, completed: 0, failed: [] });

  const results = await Promise.all(
    eligible.map(async (shot) => {
      if (taskSignal?.aborted) return { shotId: shot.id, status: "error", error: "Cancelled" };
      try {
        const shotLegacy = batchShotsLegacy.get(shot.id);
        const shotStart = Date.now();
        const effectiveDuration = Math.min(shot.duration ?? DEFAULT_SHOT_DURATION, videoMaxDuration);
        // Keyframe: first + last frames. Reference: ALL scene reference frames (ordered).
  const visionFrames: string[] = [];
  let sceneMetaList: Array<{ sceneName?: string } | null> = [];
        if (batchGenMode === "4grid") {
          visionFrames.push(...getPanelFrames(shotLegacy!));
          sceneMetaList = visionFrames.map(() => null);
        } else if (batchGenMode === "reference") {
          const sceneAssets = (shotLegacy?.referenceImages ?? [])
            .filter((r) => r.fileUrl)
            .sort((a, b) => a.sequenceInType - b.sequenceInType);
          for (const r of sceneAssets) {
            visionFrames.push(r.fileUrl as string);
            sceneMetaList.push((r.meta as { sceneName?: string } | null) ?? null);
          }
          if (visionFrames.length === 0 && shotLegacy?.sceneRefFrame) {
            visionFrames.push(shotLegacy.sceneRefFrame);
            sceneMetaList.push(null);
          }
        } else {
          if (shotLegacy?.firstFrame) visionFrames.push(shotLegacy.firstFrame);
          if (shotLegacy?.lastFrame) visionFrames.push(shotLegacy.lastFrame);
          if (visionFrames.length === 0 && shotLegacy?.sceneRefFrame) visionFrames.push(shotLegacy.sceneRefFrame);
          sceneMetaList = visionFrames.map(() => null);
        }
        const shotDialogues = await db
          .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
          .from(dialogues)
          .where(eq(dialogues.shotId, shot.id))
          .orderBy(asc(dialogues.sequence));
        const videoContextForDialogue = shot.videoScript || shot.motionScript || shot.prompt || "";

        const dialogueList = shotDialogues.map((d) => {
          const char = batchCharacters.find((c) => c.id === d.characterId);
          const characterName = char?.name ?? "Unknown";
          const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shotLegacy?.startFrameDesc ?? null);
          const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
          return {
            characterName,
            text: d.text,
            offscreen: !onScreen,
            visualHint,
          };
        });

        const motionContext = shot.videoScript || shot.motionScript || shot.prompt || "";
        // Filter characters to those declared on this shot's reference assets
        const shotCharNameSetBVP = new Set<string>();
        for (const r of shotLegacy?.referenceImages ?? []) {
          for (const n of r.characters ?? []) shotCharNameSetBVP.add(n);
        }
        const batchCharsWithRefs = batchCharacters.filter((c) => {
          if (!c.referenceImage) return false;
          if (shotCharNameSetBVP.size > 0) return shotCharNameSetBVP.has(c.name);
          return motionContext.includes(c.name);
        }).slice(0, 6);
        const characterRefInfos = batchCharsWithRefs.map((c, i) => ({
          name: c.name,
          index: i + 1,
          visualHint: c.visualHint,
        }));
        const sceneFrameInfos = batchGenMode === "4grid"
          ? getPanelFrameInfos(visionFrames.length, batchCharsWithRefs.length)
          : visionFrames.map((_, i) => {
              const name = sceneMetaList[i]?.sceneName || (visionFrames.length > 1 ? `场景-${i + 1}` : `场景`);
              return { label: name, index: batchCharsWithRefs.length + i + 1 };
            });
        const promptRequest = buildRefVideoPromptRequest({
          motionScript: motionContext,
          cameraDirection: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
          duration: effectiveDuration,
          characters: characterRefInfos,
          sceneFrames: sceneFrameInfos,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          visualStyle: visualStyleReference || undefined,
          family: promptFamily,
        });
        const textVisionFrames = selectTextVisionFrames(visionFrames);
        console.log(`[BatchVideoPrompt] Shot ${shot.sequence}: sending ${textVisionFrames.length}/${visionFrames.length} frame(s) to text model`);
        const rawPrompt = await textProvider.generateText(promptRequest, {
          systemPrompt: refVideoSystem,
          images: textVisionFrames,
        });
        const promptBody = rawPrompt.trim() || buildFallbackVideoPrompt({
          motionContext,
          cameraDirection: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
          duration: effectiveDuration,
          sceneFrames: sceneFrameInfos,
          dialogues: dialogueList,
        });
        if (!rawPrompt.trim()) {
          console.warn(`[BatchVideoPrompt] Shot ${shot.sequence}: text provider returned empty output, using fallback prompt`);
        }
        const videoPrompt = `Duration: ${effectiveDuration}s.\n\n${promptBody}`;
        await db.update(shots).set({ videoPrompt }).where(eq(shots.id, shot.id));
        bvpDoneCount++;
        if (taskId) updateTaskProgress(taskId, { total: eligible.length, completed: bvpDoneCount, failed: [] });
        console.log(`[BatchVideoPrompt] Shot ${shot.sequence} done (${((Date.now() - shotStart) / 1000).toFixed(1)}s, ${visionFrames.length} frames)`);
        return { shotId: shot.id, status: "ok" };
      } catch (err) {
        bvpDoneCount++;
        if (taskId) updateTaskProgress(taskId, { total: eligible.length, completed: bvpDoneCount, failed: [shot.id] });
        console.error(`[BatchVideoPrompt] Shot ${shot.sequence} failed:`, err);
        return {
          shotId: shot.id,
          status: "error",
          error: extractErrorMessage(err),
          diagnostic: {
            code: "PIPE_006",
            severity: "error" as const,
            message: extractErrorMessage(err),
            fix: "Inspect the text provider response and retry the failed shot after the upstream issue is resolved.",
          },
        };
      }
    })
  );

  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;
  const failedShots = results.filter((r) => r.status === "error").map((r) => r.shotId);
  if (taskId) completeTask(taskId, { total: eligible.length, completed: okCount, failed: failedShots });
  console.log(`[BatchVideoPrompt] Done: ${okCount} ok, ${errCount} errors, total ${((Date.now() - bvpStartTime) / 1000).toFixed(1)}s`);
  return NextResponse.json({ results, status: "ok" });
}
