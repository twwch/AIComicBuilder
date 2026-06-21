import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, characters, dialogues, projects, episodes } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import {
  type ModelConfig,
  getVersionedUploadDir,
  extractErrorMessage,
  isCharacterOnScreen,
  getEpisodeCharacters,
  isComfyUIVideoModel,
  clampComfyUIDuration,
} from "@/lib/generate-utils";
import { DEFAULT_ASPECT_RATIO, DEFAULT_SHOT_DURATION, DEFAULT_CAMERA_DIRECTION, TEMPERATURE_GENERAL } from "@/lib/config/defaults";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { resolveVideoProvider, resolveAIProvider } from "@/lib/ai/provider-factory";
import { resolvePrompt, resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { buildReferenceVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { buildRefVideoPromptRequest } from "@/lib/ai/prompts/ref-video-prompt-generate";
import { enhanceVideoPrompt } from "@/lib/ai/prompts/video-enhance";
import { inferVideoPromptFamily } from "@/lib/ai/video-model-strategy";
import { extractPrimaryVisualStyleReference } from "@/lib/visual-style";

import {
  loadShotLegacyView,
  loadShotLegacyViewsBatch,
  insertAssetVersion,
} from "@/lib/shot-asset-utils";
import { updateTaskProgress, completeTask } from "@/lib/task-utils";
import { registerTask } from "@/lib/task-registry";
import { id as genId } from "@/lib/id";

const POSITIVE_SAFETY_SUFFIX =
  "人物穿着完整日常服饰，衣摆严谨不暴露，领口规整无大面积露肤。只拍中近景、上半身镜头，不拍贴身暧昧姿态，肢体动作端庄自然。人物举止大方得体，无刻意魅惑、弯腰低身走光类动作。画面风格正经写实，偏向生活叙事、古风剧情、日常氛围，拒绝暧昧私密氛围。";

export async function handleSingleReferenceVideo(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string
) {
  const shotId = payload?.shotId as string | undefined;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  const shotView = await loadShotLegacyView(shot.id);
  const promptFamily = inferVideoPromptFamily(modelConfig);
  const scriptSource = shot.episodeId
    ? await db.select({ script: episodes.script, idea: episodes.idea }).from(episodes).where(eq(episodes.id, shot.episodeId))
    : await db.select({ script: projects.script, idea: projects.idea }).from(projects).where(eq(projects.id, projectId));
  const script = scriptSource[0]?.script || "";
  const idea = scriptSource[0]?.idea || "";
  const visualStyleReference = extractPrimaryVisualStyleReference(script, idea);

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));

  const shotCharNameSet = new Set<string>();
  for (const r of shotView.referenceImages) {
    for (const n of r.characters ?? []) shotCharNameSet.add(n);
  }

  const motionContext = shot.motionScript || shot.videoScript || shot.prompt || "";
  const charRefs = projectCharacters
    .filter((c) => {
      if (!c.referenceImage) return false;
      if (shotCharNameSet.size > 0) return shotCharNameSet.has(c.name);
      return motionContext.includes(c.name);
    })
    .slice(0, 6)
    .map((c) => ({ name: c.name, imagePath: c.referenceImage as string }));

  const shotDialogues = await db
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));
  const videoContextForDialogue = shot.motionScript || shot.videoScript || shot.prompt || "";

  const dialogueList = shotDialogues.map((d) => {
    const char = projectCharacters.find((c) => c.id === d.characterId);
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

  const ratio = (payload?.ratio as string) || DEFAULT_ASPECT_RATIO;
  const refVideoSlots = await resolveSlotContents("ref_video_generate", { userId, projectId });

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const sceneFramePaths: string[] = shotView.referenceImages
      .filter((r) => r.fileUrl)
      .sort((a, b) => a.sequenceInType - b.sequenceInType)
      .map((r) => r.fileUrl as string);

    if (sceneFramePaths.length === 0) {
      return NextResponse.json(
        { error: "No scene reference images. Please generate scene reference images first." },
        { status: 400 }
      );
    }

    console.log(`[SingleReferenceVideo] Shot ${shot.sequence}: ${sceneFramePaths.length} scene frame(s), ${charRefs.length} character ref(s)`);

    const orderedRefImages: string[] = [
      ...charRefs.map((c) => c.imagePath),
      ...sceneFramePaths,
    ];

    const characterRefInfos = charRefs.map((c, i) => ({
      name: c.name,
      index: i + 1,
      visualHint: projectCharacters.find((pc) => pc.name === c.name)?.visualHint,
    }));
    const sceneAssetList = shotView.referenceImages
      .filter((r) => r.fileUrl)
      .sort((a, b) => a.sequenceInType - b.sequenceInType);
    const sceneFrameInfos = sceneFramePaths.map((_, i) => {
      const metaObj = sceneAssetList[i]?.meta as { sceneName?: string } | null;
      const name = metaObj?.sceneName || (sceneFramePaths.length > 1 ? `场景-${i + 1}` : `场景`);
      return { label: name, index: charRefs.length + i + 1 };
    });
    const fullMapping = [
      ...characterRefInfos.map((c) => `@图片${c.index}是${c.name}`),
      ...sceneFrameInfos.map((s) => `@图片${s.index}是${s.label}`),
    ].join("，") + "。";

    const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);

    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const effectiveDuration = Math.min(shot.duration ?? DEFAULT_SHOT_DURATION, videoMaxDuration);

    let videoPrompt: string;
    if (shot.videoPrompt) {
      videoPrompt = shot.videoPrompt.includes("图像映射")
        ? shot.videoPrompt
        : `图像映射：${fullMapping}。\n\n${shot.videoPrompt}`;
    } else {
      const textProvider = resolveAIProvider(modelConfig);
      const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
      try {
        const motionContext = shot.motionScript || shot.videoScript || shot.prompt || "";
        const promptRequest = buildRefVideoPromptRequest({
          motionScript: motionContext,
          cameraDirection: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
          duration: isComfyUIVideoModel(modelConfig?.video)
            ? clampComfyUIDuration(effectiveDuration, modelConfig?.video?.modelId)
            : effectiveDuration,
          characters: characterRefInfos,
          sceneFrames: sceneFrameInfos,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          visualStyle: visualStyleReference || undefined,
          family: promptFamily,
          mode: isComfyUIVideoModel(modelConfig?.video) ? "comfyui" : "default",
        });
        console.log(`[SingleReferenceVideo] Shot ${shot.sequence} promptRequest:\n${promptRequest}`);
        const rawPrompt = await textProvider.generateText(promptRequest, {
          systemPrompt: refVideoSystem,
          images: sceneFramePaths.slice(0, 6),
          temperature: TEMPERATURE_GENERAL,
        });
        const enhancedRaw = await enhanceVideoPrompt(rawPrompt.trim(), modelConfig);
        videoPrompt = `Duration: ${isComfyUIVideoModel(modelConfig?.video) ? clampComfyUIDuration(effectiveDuration, modelConfig?.video?.modelId) : effectiveDuration}s.\n\n${enhancedRaw}\n\n${POSITIVE_SAFETY_SUFFIX}`;
      } catch (err) {
        console.warn("[SingleReferenceVideo] Vision prompt generation failed, falling back:", err);
        const fallback = buildReferenceVideoPrompt({
          videoScript: shot.videoScript || shot.motionScript || shot.prompt || "",
          cameraDirection: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
          duration: isComfyUIVideoModel(modelConfig?.video)
            ? clampComfyUIDuration(effectiveDuration, modelConfig?.video?.modelId)
            : effectiveDuration,
          characters: projectCharacters,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          visualStyle: visualStyleReference || undefined,
          slotContents: refVideoSlots,
        });
        const enhancedFallback = await enhanceVideoPrompt(fallback, modelConfig);
        videoPrompt = `图像映射：${fullMapping}。\n\n${enhancedFallback}\n\n${POSITIVE_SAFETY_SUFFIX}`;
      }
    }

    console.log(`[SingleReferenceVideo] Shot ${shot.sequence}: generating video with ${orderedRefImages.length} reference images`);

    const result = await videoProvider.generateVideo({
      initialImage: sceneFramePaths[0],
      prompt: videoPrompt,
      duration: isComfyUIVideoModel(modelConfig?.video)
        ? clampComfyUIDuration(effectiveDuration, modelConfig?.video?.modelId)
        : effectiveDuration,
      ratio,
      referenceImages: orderedRefImages,
    });

    await insertAssetVersion({
      shotId, type: "reference_video", sequenceInType: 0,
      prompt: videoPrompt, fileUrl: result.filePath, status: "completed", generationId: genId(),
      meta: result.lastFrameUrl ? { lastFrameUrl: result.lastFrameUrl } : null,
    });
    await db
      .update(shots)
      .set({ status: "completed" })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, referenceVideoUrl: result.filePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleReferenceVideo] Error for shot ${shot.sequence}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}

export async function handleBatchReferenceVideo(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
) {
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShotsRaw = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));
  const promptFamily = inferVideoPromptFamily(modelConfig);
  const scriptSource = episodeId
    ? await db.select({ script: episodes.script, idea: episodes.idea }).from(episodes).where(eq(episodes.id, episodeId))
    : await db.select({ script: projects.script, idea: projects.idea }).from(projects).where(eq(projects.id, projectId));
  const script = scriptSource[0]?.script || "";
  const idea = scriptSource[0]?.idea || "";
  const visualStyleReference = extractPrimaryVisualStyleReference(script, idea);

  // Deduplicate by sequence: keep the first entry per sequence
  const seenSeq = new Set<number>();
  const allShots = allShotsRaw.filter(s => {
    if (seenSeq.has(s.sequence)) return false;
    seenSeq.add(s.sequence);
    return true;
  });
  if (allShotsRaw.length !== allShots.length) {
    console.warn(`[BatchReferenceVideo] Deduplicated shots: ${allShotsRaw.length} → ${allShots.length}`);
  }

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  const overwrite = payload?.overwrite === true;
  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));

  // ── Readiness guard ──
  const readiness: Array<{ shotId: string; sequence: number; reason: string }> = [];
  const eligible = allShots.filter((s) => {
    const v = allShotsLegacy.get(s.id);
    if (s.status === "generating") {
      readiness.push({ shotId: s.id, sequence: s.sequence, reason: "shot is currently generating" });
      return false;
    }
    if (v?.referenceVideoUrl && !overwrite) {
      readiness.push({ shotId: s.id, sequence: s.sequence, reason: "already has reference video (use overwrite to regenerate)" });
      return false;
    }
    const refImages = v?.referenceImages?.filter((r) => r.fileUrl) ?? [];
    if (refImages.length === 0 && !v?.sceneRefFrame) {
      readiness.push({ shotId: s.id, sequence: s.sequence, reason: "missing scene reference images" });
      return false;
    }
    return true;
  });
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots", readiness });
  }

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);

  const charsWithRefsAll = projectCharacters.filter((c) => !!c.referenceImage).slice(0, 6);
  if (charsWithRefsAll.length === 0) {
    return NextResponse.json(
      { error: "No character reference images available." },
      { status: 400 }
    );
  }

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const textProvider = resolveAIProvider(modelConfig);
  const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
  const ratio = (payload?.ratio as string) || DEFAULT_ASPECT_RATIO;
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
  const refVideoSlots = await resolveSlotContents("ref_video_generate", { userId, projectId });

  await Promise.all(
    eligible.map((shot) =>
      db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id))
    )
  );

  // ── Task cancellation support ──
  let taskSignal: AbortSignal | undefined;
  if (taskId) {
    taskSignal = registerTask(taskId).signal;
  }

  const generationId = genId();

  const results: Array<{ shotId: string; sequence: number; status: "ok" | "error" | "cancelled"; referenceVideoUrl?: string; error?: string }> = [];
  let doneCount = 0;
  const total = eligible.length;
  for (const shot of eligible) {
    try {
      if (taskSignal?.aborted) {
        const skipped = eligible.filter((s) => s.sequence >= shot.sequence);
        for (const s of skipped) {
          results.push({ shotId: s.id, sequence: s.sequence, status: "cancelled" });
        }
        break;
      }
      const shotLegacy = allShotsLegacy.get(shot.id)!;
      const effectiveDuration = Math.min(shot.duration ?? DEFAULT_SHOT_DURATION, videoMaxDuration);
      const shotDialogues = await db
        .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
        .from(dialogues)
        .where(eq(dialogues.shotId, shot.id))
        .orderBy(asc(dialogues.sequence));
      const videoContextForDialogue = shot.motionScript || shot.videoScript || shot.prompt || "";

      const dialogueList = shotDialogues.map((d) => {
        const char = projectCharacters.find((c) => c.id === d.characterId);
        const characterName = char?.name ?? "Unknown";
        const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shotLegacy.startFrameDesc);
        const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
        return {
          characterName,
          text: d.text,
          offscreen: !onScreen,
          visualHint,
        };
      });

      const sceneFramePaths: string[] = shotLegacy.referenceImages
        .filter((r) => r.fileUrl)
        .sort((a, b) => a.sequenceInType - b.sequenceInType)
        .map((r) => r.fileUrl as string);

      if (sceneFramePaths.length === 0) {
        throw new Error("No scene reference images. Generate scene reference images first.");
      }

      const shotCharNameSet = new Set<string>();
      for (const r of shotLegacy.referenceImages) {
        for (const n of r.characters ?? []) shotCharNameSet.add(n);
      }
      const charRefs = charsWithRefsAll
        .filter((c) => shotCharNameSet.size === 0 || shotCharNameSet.has(c.name))
        .map((c) => ({ name: c.name, imagePath: c.referenceImage as string }));

      const orderedRefImages: string[] = [
        ...charRefs.map((c) => c.imagePath),
        ...sceneFramePaths,
      ];
      const characterRefInfos = charRefs.map((c, i) => ({
        name: c.name,
        index: i + 1,
        visualHint: projectCharacters.find((pc) => pc.name === c.name)?.visualHint,
      }));
      const sceneAssetList = shotLegacy.referenceImages
        .filter((r) => r.fileUrl)
        .sort((a, b) => a.sequenceInType - b.sequenceInType);
      const sceneFrameInfos = sceneFramePaths.map((_, i) => {
        const metaObj = sceneAssetList[i]?.meta as { sceneName?: string } | null;
        const name = metaObj?.sceneName || (sceneFramePaths.length > 1 ? `场景-${i + 1}` : `场景`);
        return { label: name, index: charRefs.length + i + 1 };
      });
      const fullMapping = [
        ...characterRefInfos.map((c) => `@图片${c.index}是${c.name}`),
        ...sceneFrameInfos.map((s) => `@图片${s.index}是${s.label}`),
      ].join("，") + "。";

      let videoPrompt: string;
      if (shot.videoPrompt) {
        videoPrompt = shot.videoPrompt.includes("图像映射")
          ? shot.videoPrompt
          : `图像映射：${fullMapping}。\n\n${shot.videoPrompt}`;
      } else {
        try {
          const motionContext = shot.motionScript || shot.videoScript || shot.prompt || "";
          const promptRequest = buildRefVideoPromptRequest({
            motionScript: motionContext,
            cameraDirection: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
            duration: isComfyUIVideoModel(modelConfig?.video)
              ? clampComfyUIDuration(effectiveDuration, modelConfig?.video?.modelId)
              : effectiveDuration,
            characters: characterRefInfos,
            sceneFrames: sceneFrameInfos,
            dialogues: dialogueList.length > 0 ? dialogueList : undefined,
            visualStyle: visualStyleReference || undefined,
            family: promptFamily,
            mode: isComfyUIVideoModel(modelConfig?.video) ? "comfyui" : "default",
          });
          const rawPrompt = await textProvider.generateText(promptRequest, {
            systemPrompt: refVideoSystem,
            images: sceneFramePaths.slice(0, 6),
            temperature: TEMPERATURE_GENERAL,
          });
          const enhancedRaw = await enhanceVideoPrompt(rawPrompt.trim(), modelConfig);
          videoPrompt = `Duration: ${isComfyUIVideoModel(modelConfig?.video) ? clampComfyUIDuration(effectiveDuration, modelConfig?.video?.modelId) : effectiveDuration}s.\n\n${enhancedRaw}\n\n${POSITIVE_SAFETY_SUFFIX}`;
        } catch (err) {
          console.warn("[BatchReferenceVideo] Vision prompt generation failed, falling back:", err);
          const fallback = buildReferenceVideoPrompt({
            videoScript: shot.videoScript || shot.motionScript || shot.prompt || "",
            cameraDirection: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
            duration: isComfyUIVideoModel(modelConfig?.video)
              ? clampComfyUIDuration(effectiveDuration, modelConfig?.video?.modelId)
              : effectiveDuration,
            characters: projectCharacters,
            dialogues: dialogueList.length > 0 ? dialogueList : undefined,
            visualStyle: visualStyleReference || undefined,
            family: promptFamily,
            slotContents: refVideoSlots,
          });
          const enhancedFallback = await enhanceVideoPrompt(fallback, modelConfig);
          videoPrompt = `图像映射：${fullMapping}。\n\n${enhancedFallback}\n\n${POSITIVE_SAFETY_SUFFIX}`;
        }
      }

      console.log(`[BatchReferenceVideo] Shot ${shot.sequence}: ${sceneFramePaths.length} scenes + ${charRefs.length} chars → video`);
      console.log(`[BatchReferenceVideo] Shot ${shot.sequence} prompt:\n${videoPrompt}\n---`);

      const result = await videoProvider.generateVideo({
        initialImage: sceneFramePaths[0],
        prompt: videoPrompt,
        duration: isComfyUIVideoModel(modelConfig?.video)
          ? clampComfyUIDuration(effectiveDuration, modelConfig?.video?.modelId)
          : effectiveDuration,
        ratio,
        referenceImages: orderedRefImages,
      });

      await insertAssetVersion({
        shotId: shot.id, type: "reference_video", sequenceInType: 0,
        prompt: videoPrompt, fileUrl: result.filePath, status: "completed", generationId,
        meta: result.lastFrameUrl ? { lastFrameUrl: result.lastFrameUrl } : null,
      });
      await db
        .update(shots)
        .set({ status: "completed" })
        .where(eq(shots.id, shot.id));

      doneCount++;
      console.log(`[BatchReferenceVideo] Shot ${shot.sequence} completed`);
      if (taskId) updateTaskProgress(taskId, { total, completed: doneCount, failed: results.filter(r => r.status === "error").map(r => r.shotId!).filter(Boolean) });
      results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", referenceVideoUrl: result.filePath });
    } catch (err) {
      doneCount++;
      console.error(`[BatchReferenceVideo] Error for shot ${shot.sequence}:`, err);
      await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
      if (taskId) updateTaskProgress(taskId, { total, completed: doneCount, failed: [...results.filter(r => r.status === "error").map(r => r.shotId!).filter(Boolean), shot.id] });
      results.push({ shotId: shot.id, sequence: shot.sequence, status: "error", error: extractErrorMessage(err) });
    }
  }

  if (taskId) completeTask(taskId, { total, completed: doneCount, failed: results.filter(r => r.status === "error").map(r => r.shotId!).filter(Boolean) });
  return NextResponse.json({ results });
}
