import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_ASPECT_RATIO, DEFAULT_IMAGE_QUALITY } from "@/lib/config/defaults";
import { shots, characters, episodeCharacters, projects, scenes } from "@/lib/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import {
  type ModelConfig,
  ratioToImageOpts,
  getVersionedUploadDir,
  resolveGenerationMode,
  extractErrorMessage,
  getEpisodeCharacters,
  collectStoryboardEditReferences,
} from "@/lib/generate-utils";
import { resolveImageProvider, resolveAIProvider } from "@/lib/ai/provider-factory";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { updateTaskProgress, completeTask } from "@/lib/task-utils";
import { registerTask } from "@/lib/task-registry";
import { checkContinuity } from "@/lib/pipeline/continuity-check";
import { findCharacterBySemanticMatch, findCharacterByNameFuzzy, findCharacterByDescriptionMatch } from "@/lib/vector-search";
import { id as genId } from "@/lib/id";
import { buildPanelInputs } from "@/lib/panel-layout-templates";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import { SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT } from "@/lib/ai/prompts/registry-frame";
import { buildSceneFramePrompt } from "@/lib/ai/prompts/scene-frame-generate";
import {
  loadShotLegacyViewsBatch,
  loadShotLegacyView,
  getActiveAsset,
  insertAssetVersion,
  patchAsset,
  type ShotAssetType,
  type ShotLegacyView,
} from "@/lib/shot-asset-utils";
import { buildPipelineDiagnostic, diagnosticError } from "@/lib/pipeline/diagnostics";

async function appendFrameToCharacterHistory(
  charRows: Array<{ id: string; name?: string; referenceImageHistory: string | null }>,
  filePath: string,
  matchContext?: string,
) {
  if (charRows.length === 0) return;
  const MAX_HISTORY = 20;
  for (const char of charRows) {
    if (matchContext && char.name && !matchContext.includes(char.name)) {
      continue;
    }
    let history: string[] = [];
    try { history = JSON.parse(char.referenceImageHistory || "[]"); } catch {}
    if (!history.includes(filePath)) {
      history.push(filePath);
      if (history.length > MAX_HISTORY) {
        history = history.slice(history.length - MAX_HISTORY);
      }
      await db
        .update(characters)
        .set({ referenceImageHistory: JSON.stringify(history) })
        .where(eq(characters.id, char.id));
    }
  }
}

function getPanelFrames(view: ShotLegacyView): string[] {
  return view.panels.filter((p): p is string => !!p);
}

function getKeyframeReferenceInputs(referenceImages: string[], referenceLabels: string[]) {
  // Keyframe generation never passes multi-character reference images to the
  // image model. Even models that support multi-reference (e.g. HiDream-O1)
  // reproduce contact-sheet / character-duplication artifacts when given 2+
  // character reference images simultaneously, and treat the 4-view character
  // sheets as a layout to replicate. Text descriptions are more reliable for
  // multi-character scenes; image refs are only kept for 1-character shots.
  if (referenceImages.length <= 1) {
    return { referenceImages, referenceLabels };
  }
  return { referenceImages: undefined, referenceLabels: undefined };
}

function buildPanelPrompt(params: {
  panelLabel: string;
  sceneDescription: string;
  panelDescription: string;
  characterDescriptions: string;
}) {
  return [
    "电影级动画场景渲染，丰富细节，电影布光，完整环境背景。不要格子边框，不要分格线，不要出现任何文字标签。",
    "",
    params.sceneDescription,
    "",
    params.panelDescription,
    "",
    params.characterDescriptions,
    "",
    "保持角色、服装、光线、画风连续性。",
  ].join("\n");
}

async function upsertGeneratedAsset(params: {
  shotId: string;
  type: ShotAssetType;
  prompt: string;
  fileUrl: string;
  characters?: string[];
  generationId?: string;
}) {
  const existing = await getActiveAsset(params.shotId, params.type, 0);
  if (existing) {
    await patchAsset(existing.id, { prompt: params.prompt, fileUrl: params.fileUrl, status: "completed", generationId: params.generationId ?? null });
  } else {
    await insertAssetVersion({
      shotId: params.shotId,
      type: params.type,
      sequenceInType: 0,
      prompt: params.prompt,
      fileUrl: params.fileUrl,
      status: "completed",
      characters: params.characters,
      generationId: params.generationId,
    });
  }
}

export async function handleBatchFrameGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
) {
  if (!modelConfig?.image) {
    return NextResponse.json(
      diagnosticError("PIPE_002", "No image model configured", "Configure modelConfig.image before generating frames."),
      { status: 400 }
    );
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const imageOpts = ratioToImageOpts(payload?.ratio as string | undefined);
  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0) {
    return NextResponse.json({
      results: [],
      message: "No shots found",
      diagnostic: buildPipelineDiagnostic("PIPE_007", "No shots found", "Create or import shots before running batch frame generation.", "warning"),
    });
  }
  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));
  const generationMode = await resolveGenerationMode(projectId, episodeId);
  const is4Grid = generationMode === "4grid";
  const chainContinuity = payload?.chainContinuity === true && !is4Grid;

  const force = payload?.force === true;
  if (!force) {
    const blocked = allShots.filter((s) => {
      const v = allShotsLegacy.get(s.id);
      const missing: string[] = [];
      if (!s.prompt?.trim()) missing.push("shot_prompt");
      if (!is4Grid) {
        if (!v?.startFrameDesc) missing.push("first_frame_prompt");
        if (!v?.endFrameDesc) missing.push("last_frame_prompt");
      }
      if (missing.length > 0) {
        diagnosticError("PIPE_011", `Shot #${s.sequence} has missing prerequisites`, missing.join(", "));
      }
      return missing.length > 0;
    });
    if (blocked.length > 0) {
      const shotList = blocked.map((s) => `#${s.sequence}`).join(", ");
      return NextResponse.json(
        diagnosticError("PIPE_011", `${blocked.length} shot(s) blocked`, `Missing prerequisites for: ${shotList}. Use "force":true to override.`),
        { status: 400 }
      );
    }
  }

  const generationId = payload?.generationId as string ?? genId();

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  // Fetch only characters linked to this episode
  let frameCharacters: typeof characters.$inferSelect[];
  if (episodeId) {
    const linkedIds = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    frameCharacters = linkedIds.length > 0
      ? await db.select().from(characters).where(inArray(characters.id, linkedIds.map((r) => r.characterId)))
      : [];
  } else {
    frameCharacters = await db.select().from(characters).where(eq(characters.projectId, projectId));
  }

  const charsWithImages = frameCharacters.filter((c) => c.referenceImage);

  const ai = resolveImageProvider(modelConfig, versionedUploadDir);

  // ── Task cancellation support ──
  let taskSignal: AbortSignal | undefined;
  if (taskId) {
    taskSignal = registerTask(taskId).signal;
  }

  // ── Load scene context for consistency ──
  const episodeScenes = episodeId
    ? await db.select().from(scenes).where(and(eq(scenes.episodeId, episodeId), eq(scenes.projectId, projectId))).orderBy(asc(scenes.sequence))
    : [];

  const results: Array<{
    shotId: string;
    sequence: number;
    status: string;
    firstFrame?: string;
    lastFrame?: string;
    panels?: string[];
    error?: string;
    diagnostic?: ReturnType<typeof buildPipelineDiagnostic>;
  }> = [];

  const overwrite = payload?.overwrite === true;

  let firstKeyframeShotNeedsFirstFrame = false;
  const needProcess = allShots.filter((s) => {
    const v = allShotsLegacy.get(s.id);
    if (is4Grid) return overwrite || !v || getPanelFrames(v).length < 4;
    if (chainContinuity) {
      const needsLastFrame = overwrite || !v?.lastFrame;
      const needsFirstFrame = !firstKeyframeShotNeedsFirstFrame && (overwrite || !v?.firstFrame);
      if (needsFirstFrame) firstKeyframeShotNeedsFirstFrame = true;
      return needsFirstFrame || needsLastFrame;
    }
    return overwrite || !v?.firstFrame || !v?.lastFrame;
  });
  const skipCount = allShots.length - needProcess.length;

  console.log(`[BatchFrameGenerate] Total: ${allShots.length} shots, need: ${needProcess.length}, skip: ${skipCount}, characters: ${frameCharacters.length}`);

  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  // ── Serial per-shot generation ──
  // Process shots one at a time to avoid overwhelming local image generators.
  const total = allShots.length;
  let doneCount = 0;
  let generatedFirstFrameForChain = false;
  console.log(`[BatchFrameGenerate] Starting serial generation: 0/${total}`);

  // ── Shot memory buffer (temporal continuity) ──
  // Tracks the previous shot's last frame and matched characters so subsequent
  // shots can reference them for visual consistency across cuts.
  let prevLastFramePath: string | undefined;

  for (const shot of allShots) {
    const shotLegacy = allShotsLegacy.get(shot.id);
    const isChainFirstFrameSlot = chainContinuity && !generatedFirstFrameForChain;
    const shouldGenerateFirstFrame = !chainContinuity || (isChainFirstFrameSlot && (overwrite || !shotLegacy?.firstFrame));
    const hasRequiredFirstFrame = !chainContinuity || !isChainFirstFrameSlot || !!shotLegacy?.firstFrame;
    const shotComplete = is4Grid
      ? shotLegacy && getPanelFrames(shotLegacy).length === 4
      : chainContinuity
        ? hasRequiredFirstFrame && !!shotLegacy?.lastFrame
        : !!shotLegacy?.firstFrame && !!shotLegacy?.lastFrame;

    if (!overwrite && shotComplete) {
      if (isChainFirstFrameSlot && shotLegacy?.firstFrame) {
        generatedFirstFrameForChain = true;
      }
      doneCount++;
      console.log(`[BatchFrameGenerate] ⊙ shot ${shot.sequence} skipped (${doneCount}/${total})`);
      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "skipped",
      });
      continue;
    }

    const startTime = Date.now();
    try {
      if (taskSignal?.aborted) {
        const skipped = allShots.filter((s) => s.sequence > shot.sequence);
        for (const s of skipped) {
          results.push({ shotId: s.id, sequence: s.sequence, status: "cancelled" });
        }
        break;
      }

      await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id));

      // Per-shot character filter: read the first_frame / last_frame asset
      // characters metadata (set by handleGenerateKeyframePrompts). Only
      // inject those characters' ref images into the image model, so shots
      // only see their relevant characters.
      const ffAssetExisting = await getActiveAsset(shot.id, "first_frame", 0);
      const lfAssetExisting = await getActiveAsset(shot.id, "last_frame", 0);
      const shotCharNameSet = new Set<string>([
        ...(ffAssetExisting?.characters ?? []),
        ...(lfAssetExisting?.characters ?? []),
      ]);
      let filteredChars: typeof charsWithImages = [];
      if (shotCharNameSet.size > 0) {
        filteredChars = charsWithImages.filter((c) => shotCharNameSet.has(c.name));
        if (filteredChars.length === 0 && shot.prompt) {
          const semanticMatch = await findCharacterBySemanticMatch(shot.prompt, projectId);
          if (semanticMatch) {
            const found = charsWithImages.find((c) => c.id === semanticMatch.contentId && c.referenceImage);
            if (found) filteredChars = [found];
          } else {
            const fuzzyMatch = findCharacterByNameFuzzy(
              [...shotCharNameSet],
              charsWithImages.map((c) => ({ id: c.id, name: c.name })),
            );
            if (fuzzyMatch) {
              const found = charsWithImages.find((c) => c.id === fuzzyMatch.id && c.referenceImage);
              if (found) filteredChars = [found];
            } else {
              const descMatch = findCharacterByDescriptionMatch(shot.prompt, charsWithImages);
              if (descMatch) {
                const found = charsWithImages.find((c) => c.id === descMatch.id && c.referenceImage);
                if (found) filteredChars = [found];
              }
            }
          }
        }
      } else if (charsWithImages.length > 0 && shot.prompt) {
        const semanticMatch = await findCharacterBySemanticMatch(shot.prompt, projectId);
        if (semanticMatch) {
          const found = charsWithImages.find((c) => c.id === semanticMatch.contentId && c.referenceImage);
          if (found) filteredChars = [found];
        }
        if (filteredChars.length === 0) {
          const descMatch = findCharacterByDescriptionMatch(shot.prompt, charsWithImages);
          if (descMatch) {
            const found = charsWithImages.find((c) => c.id === descMatch.id && c.referenceImage);
            if (found) filteredChars = [found];
          }
        }
      }
      if (filteredChars.length === 0 && charsWithImages.length > 0) {
        filteredChars = charsWithImages.slice(0, 1);
      }
      filteredChars = filteredChars.slice(0, 3);
      // Prefer the single-portrait ref (auto-cropped from multi-view sheets)
      // for HiDream-O1 keyframe generation. The full multi-view sheet is kept
      // on disk and shown in the UI, but it triggers contact-sheet layout
      // mimicry when fed to a model that interprets it as a layout template.
      const shotCharRefImages = filteredChars.map((c) =>
        c.referenceImageSingle || c.referenceImage!,
      );
      const shotCharRefLabels = filteredChars.map((c) => c.name);
      const keyframeReferenceInputs = getKeyframeReferenceInputs(
        shotCharRefImages,
        shotCharRefLabels,
      );
      const hasKeyframeImageReferences = (keyframeReferenceInputs.referenceImages?.length ?? 0) > 0;
      const shotCharsForPersist = filteredChars.length > 0 ? filteredChars.map((c) => c.name) : undefined;
      const shotCharDescriptions = filteredChars.length > 0
        ? filteredChars.map((c) => `${c.name}: ${c.description}`).join("\n")
        : "";

      // ── Scene context injection ──
      const matchingScene = shot.sceneId ? episodeScenes.find((s) => s.id === shot.sceneId) : null;
      const sceneContext = matchingScene
        ? `场景：${matchingScene.title || ""}\n描述：${matchingScene.description || ""}\n光照：${matchingScene.lighting || ""}\n色调：${matchingScene.colorPalette || ""}`
        : "";
      const costumeContext = shot.costumeOverrides ? `服装说明：${shot.costumeOverrides}` : "";

      const enrichedSceneDesc = sceneContext
        ? `${shot.prompt || ""}\n${sceneContext}`
        : (shot.prompt || "");
      const enrichedCharDesc = costumeContext
        ? `${shotCharDescriptions}\n${costumeContext}`
        : shotCharDescriptions;

      if (is4Grid) {
        const panelInputs = buildPanelInputs(shot, shotLegacy ?? null, matchingScene ?? null, enrichedCharDesc);
        const generatedPanels: string[] = [];
        for (const panel of panelInputs) {
          const panelPrompt = buildPanelPrompt({
            panelLabel: panel.label,
            sceneDescription: enrichedSceneDesc,
            panelDescription: panel.description,
            characterDescriptions: enrichedCharDesc,
          });
          const panelPath = await ai.generateImage(panelPrompt, {
            ...imageOpts,
            quality: DEFAULT_IMAGE_QUALITY,
            referenceImages: shotCharRefImages,
            referenceLabels: shotCharRefLabels,
            editBaseImage: generatedPanels.length > 0 ? generatedPanels[generatedPanels.length - 1] : undefined,
          });
          await upsertGeneratedAsset({
            shotId: shot.id,
            type: panel.type,
            prompt: panel.description,
            fileUrl: panelPath,
            characters: shotCharsForPersist,
            generationId,
          });
          generatedPanels.push(panelPath);
        }

        const matchText = `${shot.prompt || ""} ${panelInputs[0].description}`;
        await appendFrameToCharacterHistory(filteredChars, generatedPanels[0], matchText);
        await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shot.id));
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        doneCount++;
        console.log(`[BatchFrameGenerate] ✓ 4grid shot ${shot.sequence} (${doneCount}/${total}) ${elapsed}s`);
        if (taskId) updateTaskProgress(taskId, { total, completed: doneCount, failed: results.filter(r => r.status === "error").map(r => r.shotId!).filter(Boolean) });
        results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", panels: generatedPanels });
        continue;
      }

      // In chain continuity mode, only the first shot owns an independent
      // first frame; later first frames come from the previous video's tail.
      let firstFramePath = shotLegacy?.firstFrame ?? "";
      if (isChainFirstFrameSlot && firstFramePath && !shouldGenerateFirstFrame) {
        generatedFirstFrameForChain = true;
      }
      if (shouldGenerateFirstFrame) {
        const firstPrompt = buildFirstFramePrompt({
          sceneDescription: enrichedSceneDesc,
          startFrameDesc: shotLegacy?.startFrameDesc || shot.prompt || "",
          characterDescriptions: enrichedCharDesc,
          previousLastFrame: prevLastFramePath,
          hasCharacterImageReferences: hasKeyframeImageReferences,
          slotContents: frameFirstSlots,
        });
        firstFramePath = await ai.generateImage(firstPrompt, {
          ...imageOpts,
          quality: DEFAULT_IMAGE_QUALITY,
          negativePrompt: SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT,
          ...keyframeReferenceInputs,
        });
        if (chainContinuity) generatedFirstFrameForChain = true;
      }

      // ── Continuity check (best-effort, non-blocking) ──
      if (prevLastFramePath && firstFramePath && firstFramePath !== prevLastFramePath) {
        const continuityResult = await checkContinuity(
          resolveAIProvider(modelConfig),
          prevLastFramePath,
          firstFramePath,
        ).catch(() => null);
        if (continuityResult && !continuityResult.pass) {
          console.warn(`[BatchFrameGenerate] Continuity issues in shot ${shot.sequence}:`, continuityResult.issues);
        }
      }

      const lastPrompt = buildLastFramePrompt({
        sceneDescription: enrichedSceneDesc,
        endFrameDesc: shotLegacy?.endFrameDesc || shot.prompt || "",
        characterDescriptions: enrichedCharDesc,
        firstFramePath,
        hasCharacterImageReferences: hasKeyframeImageReferences,
        slotContents: frameLastSlots,
      });
      const lastFramePath = await ai.generateImage(lastPrompt, {
        ...imageOpts,
        quality: DEFAULT_IMAGE_QUALITY,
        negativePrompt: SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT,
        ...keyframeReferenceInputs,
        editBaseImage: firstFramePath || undefined,
      });

      if (shouldGenerateFirstFrame) {
        const firstMatchText = `${shot.prompt || ""} ${shotLegacy?.startFrameDesc || ""}`;
        await appendFrameToCharacterHistory(filteredChars, firstFramePath, firstMatchText);
      }

      await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shot.id));

      if (shouldGenerateFirstFrame) {
        if (ffAssetExisting) await patchAsset(ffAssetExisting.id, { fileUrl: firstFramePath, status: "completed", generationId });
        else
          await insertAssetVersion({
            shotId: shot.id,
            type: "first_frame",
            sequenceInType: 0,
            prompt: shotLegacy?.startFrameDesc ?? "",
            fileUrl: firstFramePath,
            status: "completed",
            characters: shotCharsForPersist,
            generationId,
          });
      }
      if (lfAssetExisting) await patchAsset(lfAssetExisting.id, { fileUrl: lastFramePath, status: "completed", generationId });
      else
        await insertAssetVersion({
          shotId: shot.id,
          type: "last_frame",
          sequenceInType: 0,
          prompt: shotLegacy?.endFrameDesc ?? "",
          fileUrl: lastFramePath,
          status: "completed",
          characters: shotCharsForPersist,
          generationId,
        });

      prevLastFramePath = lastFramePath;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      doneCount++;
      console.log(`[BatchFrameGenerate] ✓ shot ${shot.sequence} (${doneCount}/${total}) ${elapsed}s`);
      if (taskId) updateTaskProgress(taskId, { total, completed: doneCount, failed: results.filter(r => r.status === "error").map(r => r.shotId!).filter(Boolean) });

      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "ok",
        firstFrame: firstFramePath,
        lastFrame: lastFramePath,
      });
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      doneCount++;
      console.error(`[BatchFrameGenerate] ✗ shot ${shot.sequence} (${doneCount}/${total}) ${elapsed}s:`, err);
      await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
      if (taskId) updateTaskProgress(taskId, { total, completed: doneCount, failed: [...results.filter(r => r.status === "error").map(r => r.shotId!).filter(Boolean), shot.id] });
      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "error",
        error: extractErrorMessage(err),
        diagnostic: buildPipelineDiagnostic(
          "PIPE_006",
          extractErrorMessage(err),
          "Inspect the image provider logs and retry this shot after the upstream issue is resolved.",
        ),
      });
    }
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;
  const cancelledCount = results.filter((r) => r.status === "cancelled").length;
  console.log(`[BatchFrameGenerate] Done: ${okCount} ok, ${errCount} errors, ${cancelledCount} cancelled, ${skipCount} skipped`);

  if (taskId && cancelledCount === 0) {
    if (errCount > 0) completeTask(taskId, { total, completed: okCount, failed: results.filter(r => r.status === "error").map(r => r.shotId!).filter(Boolean) });
    else completeTask(taskId, { total, completed: okCount, failed: [] });
  }

  return NextResponse.json({ results });
}

export async function handleSingleFrameGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json(
      diagnosticError("PIPE_001", "No shotId provided", "Pass payload.shotId when calling single frame generation."),
      { status: 400 },
    );
  }
  if (!modelConfig?.image) {
    return NextResponse.json(
      diagnosticError("PIPE_002", "No image model configured", "Configure modelConfig.image before generating frames."),
      { status: 400 },
    );
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json(
      diagnosticError("PIPE_003", "Shot not found", "Verify the shotId belongs to the current project/version."),
      { status: 404 },
    );
  }
  const generationMode = await resolveGenerationMode(projectId, episodeId || shot.episodeId);
  const is4Grid = generationMode === "4grid";
  const shotLegacy = await loadShotLegacyView(shotId);

  // Read prompts from shot_assets — they were generated by the dedicated
  // "生成首尾帧提示词" step. Each shot is independent: no continuity chain.
  const ffAsset = await getActiveAsset(shotId, "first_frame", 0);
  const lfAsset = await getActiveAsset(shotId, "last_frame", 0);
  const startFramePromptText = ffAsset?.prompt || shot.prompt || "";
  const endFramePromptText = lfAsset?.prompt || shot.prompt || "";

  const generationId = genId();
  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);
  const shotEpisodeId = episodeId || shot.episodeId;
  const projectCharacters = await getEpisodeCharacters(projectId, shotEpisodeId);

  // Per-shot character filter: only inject refs for characters declared
  // on the first_frame / last_frame asset metadata for this shot.
  const shotCharNameSet = new Set<string>([
    ...(ffAsset?.characters ?? []),
    ...(lfAsset?.characters ?? []),
  ]);
  const charsWithRefs = projectCharacters.filter((c) => c.referenceImage);
  let filteredChars: typeof charsWithRefs = [];
  if (shotCharNameSet.size > 0) {
    filteredChars = charsWithRefs.filter((c) => shotCharNameSet.has(c.name));
    if (filteredChars.length === 0 && (shot.prompt || startFramePromptText)) {
      const searchText = shot.prompt || startFramePromptText;
      const semanticMatch = await findCharacterBySemanticMatch(searchText, projectId);
      if (semanticMatch) {
        const found = charsWithRefs.find((c) => c.id === semanticMatch.contentId);
        if (found) filteredChars = [found];
      } else {
        const fuzzyMatch = findCharacterByNameFuzzy(
          [...shotCharNameSet],
          charsWithRefs.map((c) => ({ id: c.id, name: c.name })),
        );
        if (fuzzyMatch) {
          const found = charsWithRefs.find((c) => c.id === fuzzyMatch.id);
          if (found) filteredChars = [found];
        } else {
          const descMatch = findCharacterByDescriptionMatch(searchText, charsWithRefs);
          if (descMatch) {
            const found = charsWithRefs.find((c) => c.id === descMatch.id);
            if (found) filteredChars = [found];
          }
        }
      }
    }
  } else if (charsWithRefs.length > 0 && (shot.prompt || startFramePromptText)) {
    const searchText = shot.prompt || startFramePromptText;
    const semanticMatch = await findCharacterBySemanticMatch(searchText, projectId);
    if (semanticMatch) {
      const found = charsWithRefs.find((c) => c.id === semanticMatch.contentId);
      if (found) filteredChars = [found];
    }
    if (filteredChars.length === 0) {
      const descMatch = findCharacterByDescriptionMatch(searchText, charsWithRefs);
      if (descMatch) {
        const found = charsWithRefs.find((c) => c.id === descMatch.id);
        if (found) filteredChars = [found];
      }
    }
  }
  if (filteredChars.length === 0 && charsWithRefs.length > 0) {
    filteredChars = charsWithRefs.slice(0, 1);
  }
  filteredChars = filteredChars.slice(0, 3);
  // Prefer the auto-cropped single portrait over the full multi-view sheet
  // when available — HiDream-O1 multi-reference treats the layout as a
  // template to replicate rather than as identity information.
  const shotCharRefImages = filteredChars.map(
    (c) => (c.referenceImageSingle ?? c.referenceImage) as string,
  );
  const shotCharRefLabels = filteredChars.map((c) => c.name);
  const keyframeReferenceInputs = getKeyframeReferenceInputs(
    shotCharRefImages,
    shotCharRefLabels,
  );
  const hasKeyframeImageReferences = (keyframeReferenceInputs.referenceImages?.length ?? 0) > 0;
  const shotCharDescriptions = filteredChars.length > 0
    ? filteredChars.map((c) => `${c.name}: ${c.description}`).join("\n")
    : "";

  // ── Scene + costume context ──
  const epId = shot.episodeId ?? episodeId;
  const episodeScenes = epId
    ? await db.select().from(scenes).where(and(eq(scenes.episodeId, epId), eq(scenes.projectId, projectId)))
    : [];
  const matchingScene = shot.sceneId ? episodeScenes.find((s) => s.id === shot.sceneId) : null;
  const sceneContext = matchingScene
    ? `场景：${matchingScene.title || ""}\n描述：${matchingScene.description || ""}\n光照：${matchingScene.lighting || ""}\n色调：${matchingScene.colorPalette || ""}`
    : "";
  const enrichedSceneDesc = sceneContext
    ? `${shot.prompt || ""}\n${sceneContext}`
    : (shot.prompt || "");
  const enrichedCharDesc = shot.costumeOverrides
    ? `${shotCharDescriptions}\n服装说明：${shot.costumeOverrides}`
    : shotCharDescriptions;

  const ai = resolveImageProvider(modelConfig, versionedUploadDir);
  const imageOpts = ratioToImageOpts(payload?.ratio as string | undefined);

  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    if (is4Grid) {
      const panelInputs = buildPanelInputs(shot, shotLegacy, matchingScene ?? null, enrichedCharDesc);
      const generatedPanels: string[] = [];
      for (const panel of panelInputs) {
        const panelPrompt = buildPanelPrompt({
          panelLabel: panel.label,
          sceneDescription: enrichedSceneDesc,
          panelDescription: panel.description,
          characterDescriptions: enrichedCharDesc,
        });
        const panelPath = await ai.generateImage(panelPrompt, {
          ...imageOpts,
          quality: DEFAULT_IMAGE_QUALITY,
          referenceImages: shotCharRefImages,
          referenceLabels: shotCharRefLabels,
          editBaseImage: generatedPanels.length > 0 ? generatedPanels[generatedPanels.length - 1] : undefined,
        });
        await upsertGeneratedAsset({
          shotId,
          type: panel.type,
          prompt: panel.description,
          fileUrl: panelPath,
          generationId,
        });
        generatedPanels.push(panelPath);
      }

      const matchText = `${shot.prompt || ""} ${panelInputs[0].description}`;
      await appendFrameToCharacterHistory(filteredChars, generatedPanels[0], matchText);
      await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shotId));
      return NextResponse.json({ shotId, panels: generatedPanels, status: "ok" });
    }

    const firstPrompt = buildFirstFramePrompt({
      sceneDescription: shot.prompt || "",
      startFrameDesc: startFramePromptText,
      characterDescriptions: shotCharDescriptions,
      hasCharacterImageReferences: hasKeyframeImageReferences,
      slotContents: frameFirstSlots,
    });
    const firstFramePath = await ai.generateImage(firstPrompt, {
      ...imageOpts,
      quality: DEFAULT_IMAGE_QUALITY,
      negativePrompt: SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT,
      ...keyframeReferenceInputs,
    });

    const lastPrompt = buildLastFramePrompt({
      sceneDescription: shot.prompt || "",
      endFrameDesc: endFramePromptText,
      characterDescriptions: shotCharDescriptions,
      firstFramePath,
      hasCharacterImageReferences: hasKeyframeImageReferences,
      slotContents: frameLastSlots,
    });
    const lastFramePath = await ai.generateImage(lastPrompt, {
      ...imageOpts,
      quality: DEFAULT_IMAGE_QUALITY,
      negativePrompt: SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT,
      ...keyframeReferenceInputs,
      editBaseImage: firstFramePath,
    });

    const firstMatchText = `${shot.prompt || ""} ${startFramePromptText}`;
    await appendFrameToCharacterHistory(filteredChars, firstFramePath, firstMatchText);

    await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shotId));

    if (ffAsset) await patchAsset(ffAsset.id, { fileUrl: firstFramePath, status: "completed", generationId });
    else
      await insertAssetVersion({
        shotId,
        type: "first_frame",
        sequenceInType: 0,
        prompt: startFramePromptText,
        fileUrl: firstFramePath,
        status: "completed",
        generationId,
      });
    if (lfAsset) await patchAsset(lfAsset.id, { fileUrl: lastFramePath, status: "completed", generationId });
    else
      await insertAssetVersion({
        shotId,
        type: "last_frame",
        sequenceInType: 0,
        prompt: endFramePromptText,
        fileUrl: lastFramePath,
        status: "completed",
        generationId,
      });

    return NextResponse.json({ shotId, firstFrame: firstFramePath, lastFrame: lastFramePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleFrameGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      {
        shotId,
        status: "error",
        ...diagnosticError(
          "PIPE_006",
          extractErrorMessage(err),
          "Inspect the image provider logs and retry the shot after the upstream issue is resolved.",
        ),
      },
      { status: 500 },
    );
  }
}

export async function handleSingleStoryboardEdit(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string,
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json(
      diagnosticError("PIPE_001", "No shotId provided", "Pass payload.shotId when calling storyboard edit generation."),
      { status: 400 },
    );
  }
  if (!modelConfig?.image) {
    return NextResponse.json(
      diagnosticError("PIPE_002", "No image model configured", "Configure modelConfig.image before running storyboard edits."),
      { status: 400 },
    );
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json(
      diagnosticError("PIPE_003", "Shot not found", "Verify the shotId belongs to the current project/version."),
      { status: 404 },
    );
  }

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);
  const references = collectStoryboardEditReferences(payload);
  const fallbackBaseImage = typeof payload?.baseImage === "string" ? payload.baseImage : references[0]?.path;
  if (!fallbackBaseImage) {
    return NextResponse.json(
      diagnosticError("PIPE_008", "No base image/reference images provided", "Pass baseImage or at least one reference image before running storyboard edits."),
      { status: 400 },
    );
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const prompt = buildFirstFramePrompt({
    sceneDescription: shot.prompt || "",
    startFrameDesc: String(payload?.editInstruction || payload?.instruction || shot.prompt || ""),
    characterDescriptions: project?.title || "",
    slotContents: frameFirstSlots,
  });

  const imageProvider = resolveImageProvider(
    {
      ...modelConfig,
      image: modelConfig.image
        ? { ...modelConfig.image, modelId: modelConfig.image.modelId || "qwen-edit-dual" }
        : modelConfig.image,
    },
    versionedUploadDir,
  );

  try {
    const imagePath = await imageProvider.generateImage(prompt, {
      aspectRatio: payload?.ratio as string | undefined,
      quality: DEFAULT_IMAGE_QUALITY,
      editBaseImage: fallbackBaseImage,
      referenceImages: references.map((r) => r.path),
      referenceLabels: references.map((r) => r.label || r.role),
      referenceRoles: references.map((r) => r.role),
    });

    return NextResponse.json({ shotId, imagePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleStoryboardEdit] Error for shot ${shotId}:`, err);
    return NextResponse.json(
      {
        shotId,
        status: "error",
        ...diagnosticError(
          "PIPE_006",
          extractErrorMessage(err),
          "Inspect the image edit provider logs and retry after the upstream issue is resolved.",
        ),
      },
      { status: 500 },
    );
  }
}

export async function handleSingleSceneFrame(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string
) {
  const shotId = payload?.shotId as string | undefined;
  if (!shotId) {
    return NextResponse.json(
      diagnosticError("PIPE_001", "No shotId provided", "Pass payload.shotId when calling scene frame generation."),
      { status: 400 },
    );
  }
  if (!modelConfig?.image) {
    return NextResponse.json(
      diagnosticError("PIPE_002", "No image model configured", "Configure modelConfig.image before generating scene frames."),
      { status: 400 },
    );
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json(
      diagnosticError("PIPE_003", "Shot not found", "Verify the shotId belongs to the current project/version."),
      { status: 404 },
    );
  }

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);
    const slotContents = await resolveSlotContents("scene_frame_generate", { userId, projectId });
    const sceneFrameView = await loadShotLegacyView(shot.id);
    const sceneFramePrompt = buildSceneFramePrompt({
      sceneDescription: shot.prompt || "",
      charRefMapping: "",
      characterDescriptions: "",
      cameraDirection: shot.cameraDirection,
      startFrameDesc: sceneFrameView.startFrameDesc,
      motionScript: shot.motionScript,
      slotContents,
    });

    console.log(`[SingleSceneFrame] Shot ${shot.sequence}: generating scene-only frame (no character refs)`);

    // Scene-only: no character reference images injected.
    const sceneFramePath = await imageProvider.generateImage(sceneFramePrompt, {
      quality: DEFAULT_IMAGE_QUALITY,
    });

    {
      const refEx = await getActiveAsset(shotId, "reference", 0);
      if (refEx) {
        // Preserve pre-existing characters metadata on regeneration.
        await patchAsset(refEx.id, { fileUrl: sceneFramePath, status: "completed" });
      } else {
        // Fresh creation: copy characters from sibling ref assets if any.
        const siblingChars = sceneFrameView.referenceImages[0]?.characters ?? undefined;
        await insertAssetVersion({
          shotId,
          type: "reference",
          sequenceInType: 0,
          prompt: "",
          fileUrl: sceneFramePath,
          status: "completed",
          characters: siblingChars,
          generationId: genId(),
        });
      }
    }
    await db
      .update(shots)
      .set({ status: "pending" })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, sceneRefFrame: sceneFramePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleSceneFrame] Error for shot ${shot.sequence}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      {
        shotId,
        status: "error",
        ...diagnosticError(
          "PIPE_006",
          extractErrorMessage(err),
          "Inspect the image provider logs and retry the scene frame after the upstream issue is resolved.",
        ),
      },
      { status: 500 }
    );
  }
}

export async function handleBatchSceneFrame(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
) {
  const taskSignal = taskId ? registerTask(taskId).signal : undefined;
  if (taskId) updateTaskProgress(taskId, { total: 0, completed: 0, failed: [] });
  if (!modelConfig?.image) {
    if (taskId) completeTask(taskId, { total: 0, completed: 0, failed: ["No image model configured"] });
    return NextResponse.json(
      diagnosticError("PIPE_002", "No image model configured", "Configure modelConfig.image before generating scene frames."),
      { status: 400 },
    );
  }

  const overwrite = payload?.overwrite === true;
  const ratio = (payload?.ratio as string) || DEFAULT_ASPECT_RATIO;
  const imageOpts = ratioToImageOpts(ratio);
  const batchVersionId = payload?.versionId as string | undefined;

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db.select().from(shots).where(and(...shotWhereConditions)).orderBy(asc(shots.sequence));
  if (taskId) updateTaskProgress(taskId, { total: allShots.length, completed: 0, failed: [] });

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);
  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));

  // Mark all eligible shots as generating
  const results: Array<{
    shotId: string;
    sequence: number;
    status: string;
    generated?: number;
    error?: string;
    diagnostic?: ReturnType<typeof buildPipelineDiagnostic>;
  }> = [];

  for (const [shotIdx, shot] of allShots.entries()) {
    if (taskSignal?.aborted) { if (taskId) completeTask(taskId, { total: allShots.length, completed: shotIdx, failed: ["Cancelled"] }); return NextResponse.json({ error: "Cancelled" }, { status: 499 }); }
    const refImages = allShotsLegacy.get(shot.id)?.referenceImages ?? [];
    const targets = overwrite
      ? refImages.filter((r) => r.prompt.trim())
      : refImages.filter((r) => r.status === "pending" && r.prompt.trim());

    if (targets.length === 0) {
      results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", generated: 0 });
      if (taskId) updateTaskProgress(taskId, { total: allShots.length, completed: shotIdx + 1, failed: results.filter(r => r.status === "error").map(r => r.shotId) });
      continue;
    }

    console.log(`[BatchSceneFrame] Shot ${shot.sequence}: ${targets.length} scene-only refs (no character injection)`);

    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id));

    // Generate all ref images for this shot serially.
    let generated = 0;
    for (const entry of targets) {
      if (taskSignal?.aborted) { if (taskId) completeTask(taskId, { total: allShots.length, completed: shotIdx, failed: ["Cancelled"] }); return NextResponse.json({ error: "Cancelled" }, { status: 499 }); }
      try {
        const imagePath = await imageProvider.generateImage(entry.prompt, {
          quality: DEFAULT_IMAGE_QUALITY,
          ...imageOpts,
        });
        await insertAssetVersion({
          shotId: shot.id, type: "reference", sequenceInType: entry.sequenceInType,
          prompt: entry.prompt, fileUrl: imagePath, status: "completed",
          characters: entry.characters ?? undefined,
          generationId: genId(),
        });
        generated++;
        console.log(`[BatchRefImage] Shot ${shot.sequence}: ref "${entry.id}" done`);
      } catch (err) {
        console.warn(`[BatchRefImage] Shot ${shot.sequence} ref ${entry.id} failed:`, err);
        results.push({
          shotId: shot.id,
          sequence: shot.sequence,
          status: "error",
          generated,
          error: extractErrorMessage(err),
          diagnostic: buildPipelineDiagnostic(
            "PIPE_006",
            extractErrorMessage(err),
            "Inspect the image provider logs and retry the failed scene reference generation.",
          ),
        });
      }
    }

    await db
      .update(shots)
      .set({ status: "pending" })
      .where(eq(shots.id, shot.id));

    results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", generated });
    if (taskId) updateTaskProgress(taskId, { total: allShots.length, completed: shotIdx + 1, failed: results.filter(r => r.status === "error").map(r => r.shotId) });
  }

  if (taskId) completeTask(taskId, { total: allShots.length, completed: results.filter(r => r.status === "ok").length, failed: results.filter(r => r.status === "error").map(r => r.error!).filter(Boolean) });
  return NextResponse.json({ results });
}
