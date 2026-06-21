import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects, episodes, characters, episodeCharacters, characterRelations, shots } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  type ModelConfig,
  findBoundAgent,
  callAndValidateAgent,
  extractErrorMessage,
} from "@/lib/generate-utils";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { buildCharacterExtractPrompt } from "@/lib/ai/prompts/character-extract";
import { detectImageModelFamily } from "@/lib/ai/prompts/character-image";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import { DEFAULT_ASPECT_RATIO, DEFAULT_IMAGE_QUALITY, DEFAULT_CHARACTER_IMAGE_SIZE } from "@/lib/config/defaults";
import { id as genId } from "@/lib/id";
import { updateTaskProgress, completeTask } from "@/lib/task-utils";
import { registerTask } from "@/lib/task-registry";
import {
  loadShotLegacyViewsBatch,
  patchAsset,
} from "@/lib/shot-asset-utils";
import type { CharacterReferenceLayout } from "@/lib/ai/prompts/registry-character";
import { extractCharacterReferencePortrait } from "@/lib/character-ref-utils";

function readLayoutFromPayload(
  payload: Record<string, unknown> | undefined,
): CharacterReferenceLayout | undefined {
  const value = payload?.referenceLayout;
  if (value === "single" || value === "three-view" || value === "four-view") {
    return value;
  }
  return undefined;
}

function parseReferenceImageHistory(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function layoutFromCharacter(
  character: { referenceLayout: string | null },
): CharacterReferenceLayout {
  if (
    character.referenceLayout === "single" ||
    character.referenceLayout === "three-view" ||
    character.referenceLayout === "four-view"
  ) {
    return character.referenceLayout;
  }
  return "four-view";
}

export async function handleCharacterExtract(
  projectId: string,
  userId: string,
  _payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  let script: string | null = null;

  if (episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    script = episode?.script ?? null;
  } else {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    script = project?.script ?? null;
  }

  if (!script) {
    return NextResponse.json(
      { error: "Project or script not found" },
      { status: 404 }
    );
  }

  // Fetch all existing project characters for dedup
  const existingChars = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));
  const existingByName = new Map(
    existingChars.map((c) => [c.name.toLowerCase().trim(), c])
  );

  // If extracting for an episode, capture the old episode-linked character ids
  // BEFORE deleting the links, so we can scope relation cleanup to this episode only.
  let oldEpisodeCharIds: string[] = [];
  if (episodeId) {
    const oldLinks = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    oldEpisodeCharIds = oldLinks.map((l) => l.characterId);
    await db.delete(episodeCharacters).where(eq(episodeCharacters.episodeId, episodeId));
  }

  let aiText: string;
  const boundAgent = await findBoundAgent(projectId, "character_extract");
  if (boundAgent) {
    const agentResult = await callAndValidateAgent(boundAgent, "character_extract", buildCharacterExtractPrompt(script));
    if (agentResult instanceof NextResponse) return agentResult;
    aiText = agentResult.text;
  } else {
    if (!modelConfig?.text) {
      return NextResponse.json({ error: "No text model configured" }, { status: 400 });
    }
    const model = createLanguageModel(modelConfig.text);
    const charExtractSystem = await resolvePrompt("character_extract", { userId, projectId });
    console.log("[CharacterExtract] resolved system prompt:\n", charExtractSystem);
    const { text } = await generateText({
      model,
      system: charExtractSystem,
      prompt: buildCharacterExtractPrompt(script),
    });
    aiText = text;
  }

  const parsed = JSON.parse(extractJSON(aiText));

  // Support both formats: new { characters, relationships } and legacy array
  const extracted: Array<{
    name: string;
    description: string;
    visualHint?: string;
    scope?: string;
    heightCm?: number;
    bodyType?: string;
    performanceStyle?: string;
  }> = Array.isArray(parsed) ? parsed : (parsed.characters || []);
  const extractedRelations: Array<{
    characterA: string;
    characterB: string;
    relationType: string;
    description?: string;
  }> = Array.isArray(parsed) ? [] : (parsed.relationships || []);

  let reusedCount = 0;
  let createdCount = 0;
  const linkedCharIds: string[] = [];

  for (const char of extracted) {
    const key = char.name.toLowerCase().trim();
    const existing = existingByName.get(key);

    if (existing) {
      // Reuse existing character — always update description from new extraction
      await db.update(characters)
        .set({
          description: char.description,
          visualHint: char.visualHint ?? existing.visualHint ?? "",
          scope: (char.scope === "guest" ? "guest" : "main") as "main" | "guest",
        })
        .where(eq(characters.id, existing.id));
      console.log(`[CharacterExtract] Updated existing character "${char.name}" (${existing.id}), desc length: ${char.description.length}`);
      linkedCharIds.push(existing.id);
      reusedCount++;
    } else {
      // Create new character
      const charId = genId();
      const scope = char.scope === "guest" ? "guest" : "main";
      await db.insert(characters).values({
        id: charId,
        projectId,
        name: char.name,
        description: char.description,
        visualHint: char.visualHint ?? "",
        heightCm: char.heightCm || 0,
        bodyType: char.bodyType || "average",
        performanceStyle: char.performanceStyle || "",
        scope,
        episodeId: null,
      });
      existingByName.set(key, { id: charId, name: char.name } as typeof existingChars[0]);
      linkedCharIds.push(charId);
      createdCount++;
    }
  }

  // Create episode_characters links
  if (episodeId) {
    for (const charId of linkedCharIds) {
      await db.insert(episodeCharacters).values({
        id: genId(),
        episodeId,
        characterId: charId,
      });
    }
  }

  // Auto-create character relationships from extraction — replace existing on re-run.
  // Scoping rule: a relation belongs to this episode iff BOTH endpoints are in the
  // episode's character list. Project-level extraction clears all project relations.
  if (extractedRelations.length > 0) {
    if (episodeId) {
      // Episode-scoped: only clear relations whose both endpoints were in this episode.
      if (oldEpisodeCharIds.length > 0) {
        await db
          .delete(characterRelations)
          .where(
            and(
              eq(characterRelations.projectId, projectId),
              inArray(characterRelations.characterAId, oldEpisodeCharIds),
              inArray(characterRelations.characterBId, oldEpisodeCharIds)
            )
          );
      }
    } else {
      // Project-level: clear everything for the project.
      await db.delete(characterRelations).where(eq(characterRelations.projectId, projectId));
    }

    const allChars = await db.select().from(characters).where(eq(characters.projectId, projectId));
    const nameToId = new Map(allChars.map((c) => [c.name, c.id]));

    for (const rel of extractedRelations) {
      const aId = nameToId.get(rel.characterA);
      const bId = nameToId.get(rel.characterB);
      if (aId && bId && aId !== bId) {
        try {
          await db.insert(characterRelations).values({
            id: genId(),
            projectId,
            characterAId: aId,
            characterBId: bId,
            relationType: rel.relationType || "neutral",
            description: rel.description || "",
          });
        } catch {
          // Skip duplicates
        }
      }
    }
  }

  console.log(
    `[CharacterExtract] ${extracted.length} characters: ${reusedCount} reused, ${createdCount} new, ${linkedCharIds.length} linked to episode, ${extractedRelations.length} relations`
  );

  return NextResponse.json({ characters: extracted });
}

export async function handleSingleCharacterImage(
  _projectId: string,
  _userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string
) {
  const characterId = payload?.characterId as string;
  if (!characterId) {
    return NextResponse.json({ error: "No characterId provided" }, { status: 400 });
  }

  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId));

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const ai = resolveImageProvider(modelConfig);
  const family = detectImageModelFamily(modelConfig?.image?.protocol, modelConfig?.image?.modelId);

  const referenceLayout = readLayoutFromPayload(payload) ?? layoutFromCharacter(character);

  let description = character.description || character.name;
  if (family === "ideogram4" && /[\u4e00-\u9fff]/.test(description) && modelConfig?.text) {
    const translateModel = createLanguageModel(modelConfig.text);
    const { text } = await generateText({
      model: translateModel,
      system: "Translate Chinese 3D character descriptions to English. Keep all visual details (colors, materials, clothing, proportions, accessories). Output only the English translation.",
      prompt: `Translate this character description:\n${description}`,
    });
    description = text.trim();
  }

  let promptKey: string;
  if (family === "gpt") promptKey = "character_image";
  else if (family === "ideogram4") promptKey = "character_image_ideogram4";
  else if (family === "hidream") promptKey = "character_image_hidream_o1";
  else if (family === "ernie") promptKey = "character_image_hidream_o1";
  else promptKey = "character_image_simple";
  const prompt = await resolvePrompt(promptKey, { userId: _userId, projectId: _projectId }, {
    characterName: character.name,
    description,
    referenceLayout,
  });

  // Pass existing reference images as subject references for consistency.
  // When the character has a single-portrait ref (auto-cropped from a previous
  // multi-view generation), prefer that — it carries character identity without
  // the multi-view layout that confuses downstream image models.
  const refImages: string[] = [];
  if (character.referenceImageSingle) refImages.push(character.referenceImageSingle);
  if (character.referenceImage && !refImages.includes(character.referenceImage)) {
    refImages.push(character.referenceImage);
  }
  for (const img of parseReferenceImageHistory(character.referenceImageHistory)) {
    if (!refImages.includes(img)) refImages.push(img);
  }
  // Limit to 10 to avoid overloading
  const subjectRefs = refImages.slice(0, 10);

  try {
    const imagePath = await ai.generateImage(prompt, {
      size: DEFAULT_CHARACTER_IMAGE_SIZE,
      aspectRatio: DEFAULT_ASPECT_RATIO,
      quality: DEFAULT_IMAGE_QUALITY,
      ...(subjectRefs.length > 0 && { referenceImages: subjectRefs }),
      workflowFamily: family === "ideogram4" ? "ideogram4-comfyui" : family === "hidream" ? "hidream-o1-comfyui" : family === "ernie" ? "ernie-image-comfyui" : undefined,
    });

    // Append to history
    const history = parseReferenceImageHistory(character.referenceImageHistory);
    if (character.referenceImage && !history.includes(character.referenceImage)) {
      history.push(character.referenceImage);
    }
    if (!history.includes(imagePath)) {
      history.push(imagePath);
    }

    // For multi-view layouts, auto-crop the front sub-view into a single-portrait
    // ref that downstream keyframe generation can use without the layout.
    let singlePortraitPath: string | null = null;
    if (referenceLayout !== "single") {
      try {
        singlePortraitPath = await extractCharacterReferencePortrait(
          imagePath,
          referenceLayout,
        );
      } catch (cropErr) {
        console.warn(
          `[SingleCharacterImage] auto-crop failed for ${character.name}:`,
          cropErr instanceof Error ? cropErr.message : cropErr,
        );
      }
    }

    await db
      .update(characters)
      .set({
        referenceImage: imagePath,
        referenceImageHistory: JSON.stringify(history),
        referenceImageSingle: singlePortraitPath ?? character.referenceImageSingle,
        referenceLayout,
      })
      .where(eq(characters.id, characterId));

    // Mark downstream ref images stale: any shot's referenceImages that include this character
    // as a "characters" entry should have its generated items reset to pending so they're
    // regenerated with the new character reference image.
    const allShots = await db.select().from(shots).where(eq(shots.projectId, character.projectId));
    const legacyMap = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));
    let staleCount = 0;
    for (const shot of allShots) {
      const view = legacyMap.get(shot.id);
      if (!view) continue;
      const refItems = view.referenceImages;
      let modified = false;
      for (const item of refItems) {
        if (item.characters?.includes(character.name) && item.status === "completed") {
          await patchAsset(item.id, { status: "pending", fileUrl: null });
          modified = true;
        }
      }
      if (modified) {
        staleCount++;
      }
    }
    console.log(`[SingleCharacterImage] ${character.name} regenerated (layout=${referenceLayout}${singlePortraitPath ? ", cropped" : ""}); marked ${staleCount} shots' ref images as stale`);

    return NextResponse.json({
      characterId,
      imagePath,
      referenceLayout,
      singlePortraitPath,
      status: "ok",
      staleShots: staleCount,
    });
  } catch (err) {
    console.error(`[SingleCharacterImage] Error for ${character.name}:`, err);
    return NextResponse.json({ characterId, status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}

export async function handleBatchCharacterImage(
  projectId: string,
  _userId: string,
  _payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
) {
  if (!modelConfig?.image) {
    return NextResponse.json(
      { error: "No image model configured" },
      { status: 400 }
    );
  }

  let allCharacters: typeof characters.$inferSelect[];
  if (episodeId) {
    const linkedIds = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    allCharacters = linkedIds.length > 0
      ? await db.select().from(characters).where(inArray(characters.id, linkedIds.map((r) => r.characterId)))
      : [];
  } else {
    allCharacters = await db.select().from(characters).where(eq(characters.projectId, projectId));
  }

  const needImages = allCharacters.filter((c) => !c.referenceImage);
  if (needImages.length === 0) {
    return NextResponse.json({ results: [], message: "All characters already have images" });
  }

  const ai = resolveImageProvider(modelConfig);
  const family = detectImageModelFamily(modelConfig?.image?.protocol, modelConfig?.image?.modelId);
  const defaultLayout = readLayoutFromPayload(_payload) ?? "four-view";
  let promptKey: string;
  if (family === "gpt") promptKey = "character_image";
  else if (family === "ideogram4") promptKey = "character_image_ideogram4";
  else if (family === "hidream") promptKey = "character_image_hidream_o1";
  else if (family === "ernie") promptKey = "character_image_hidream_o1";
  else promptKey = "character_image_simple";

  const results: Array<{ characterId: string; name: string; imagePath?: string; referenceLayout?: string; singlePortraitPath?: string | null; status: string; error?: string }> = [];
  const taskSignal = taskId ? registerTask(taskId).signal : undefined;
  if (taskId) updateTaskProgress(taskId, { total: needImages.length, completed: 0, failed: [] });

  for (const character of needImages) {
    if (taskSignal?.aborted) { console.log(`[BatchCharacterImage] Aborted at ${character.name}`); break; }
    try {
      const referenceLayout = layoutFromCharacter(character) || defaultLayout;

      let description = character.description || character.name;
      if (family === "ideogram4" && /[\u4e00-\u9fff]/.test(description) && modelConfig?.text) {
        const translateModel = createLanguageModel(modelConfig.text);
        const { text } = await generateText({
          model: translateModel,
          system: "Translate Chinese 3D character descriptions to English. Keep all visual details (colors, materials, clothing, proportions, accessories). Output only the English translation.",
          prompt: `Translate this character description:\n${description}`,
        });
        description = text.trim();
      }

      const prompt = await resolvePrompt(promptKey, { userId: _userId, projectId }, {
        characterName: character.name,
        description,
        referenceLayout,
      });

      // Pass existing reference images as subject references for consistency.
      // Prefer the single-portrait ref (auto-cropped from a previous generation)
      // so the new ref inherits the character identity without the multi-view
      // layout that confuses downstream image models.
      const refImages: string[] = [];
      if (character.referenceImageSingle) refImages.push(character.referenceImageSingle);
      if (character.referenceImage && !refImages.includes(character.referenceImage)) {
        refImages.push(character.referenceImage);
      }
      for (const img of parseReferenceImageHistory(character.referenceImageHistory)) {
        if (!refImages.includes(img)) refImages.push(img);
      }
      const subjectRefs = refImages.slice(0, 10);

      const imagePath = await ai.generateImage(prompt, {
        size: DEFAULT_CHARACTER_IMAGE_SIZE,
        aspectRatio: "16:9",
        quality: DEFAULT_IMAGE_QUALITY,
        ...(subjectRefs.length > 0 && { referenceImages: subjectRefs }),
        workflowFamily: family === "ideogram4" ? "ideogram4-comfyui" : family === "hidream" ? "hidream-o1-comfyui" : family === "ernie" ? "ernie-image-comfyui" : undefined,
      });

      // Append to history
      const history = parseReferenceImageHistory(character.referenceImageHistory);
      if (character.referenceImage && !history.includes(character.referenceImage)) history.push(character.referenceImage);
      if (!history.includes(imagePath)) history.push(imagePath);

      // Auto-crop multi-view ref to single portrait
      let singlePortraitPath: string | null = null;
      if (referenceLayout !== "single") {
        try {
          singlePortraitPath = await extractCharacterReferencePortrait(
            imagePath,
            referenceLayout,
          );
        } catch (cropErr) {
          console.warn(
            `[BatchCharacterImage] auto-crop failed for ${character.name}:`,
            cropErr instanceof Error ? cropErr.message : cropErr,
          );
        }
      }

      await db
        .update(characters)
        .set({
          referenceImage: imagePath,
          referenceImageHistory: JSON.stringify(history),
          referenceImageSingle: singlePortraitPath ?? character.referenceImageSingle,
          referenceLayout,
        })
        .where(eq(characters.id, character.id));
      results.push({
        characterId: character.id,
        name: character.name,
        imagePath,
        referenceLayout,
        singlePortraitPath,
        status: "ok",
      });
    } catch (err) {
      console.error(`[BatchCharacterImage] Error for ${character.name}:`, err);
      results.push({ characterId: character.id, name: character.name, status: "error", error: extractErrorMessage(err) });
    }
    if (taskId) updateTaskProgress(taskId, { total: needImages.length, completed: results.length, failed: results.filter(r => r.status === "error").map(r => r.characterId) });
  }

  if (taskId) completeTask(taskId, { total: needImages.length, completed: results.length, failed: results.filter(r => r.status === "error").map(r => r.characterId) });
  return NextResponse.json({ results });
}
