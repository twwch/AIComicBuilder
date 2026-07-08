import { and, asc, desc, eq, inArray, or, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assets,
  assetVariants,
  characterAssets,
  characters,
  complianceReports,
  dialogues,
  episodeCharacters,
  productionBibles,
  propAssets,
  sceneAssets,
  scriptChunks,
  scripts,
  shots,
  shotSpecs,
  storyboardFrames,
} from "@/lib/db/schema";
import type { AIProvider, ImageOptions } from "@/lib/ai/types";
import { id as genId } from "@/lib/id";
import { getActiveProductionBible } from "@/lib/production-bible";
import {
  buildDeterministicImagePrompt,
  type BuiltImagePrompt,
  type PromptAssetInput,
  type PromptAssetVariantInput,
  type PromptFrameRole,
} from "@/lib/image-prompt-builder";

type AssetType = "character" | "scene" | "prop";
type StoryAssetDetail =
  | Partial<typeof characterAssets.$inferInsert>
  | Partial<typeof sceneAssets.$inferInsert>
  | Partial<typeof propAssets.$inferInsert>;

function jsonText(value: unknown[] | undefined) {
  return JSON.stringify(value ?? []);
}

function parseJsonArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
  );
}

function assetTerms(asset: typeof assets.$inferSelect) {
  return uniq([asset.name, ...parseJsonArray(asset.aliases)]);
}

function textMentionsTerm(text: string, term: string) {
  const normalizedText = text.toLowerCase();
  const normalizedTerm = term.toLowerCase();
  return Boolean(normalizedTerm) && normalizedText.includes(normalizedTerm);
}

function textMentionsAsset(text: string, asset: typeof assets.$inferSelect) {
  return assetTerms(asset).some((term) => textMentionsTerm(text, term));
}

function inferShotType(shot: typeof shots.$inferSelect, promptText: string) {
  const text = `${shot.compositionGuide ?? ""} ${shot.focalPoint ?? ""} ${promptText}`.toLowerCase();
  if (/close[-\s]?up|特写|近景/.test(text)) return "close-up";
  if (/wide|全景|远景|establishing/.test(text)) return "wide";
  if (/medium|中景|半身/.test(text)) return "medium";
  if (/over[-\s]?shoulder|肩/.test(text)) return "over-shoulder";
  return "storyboard";
}

function buildDialogueText(dialogueItems: Array<{ character?: string; text: string }>) {
  return dialogueItems
    .map((item) => `${item.character ? `${item.character}: ` : ""}${item.text}`)
    .join("\n");
}

async function getCharactersForShot(projectId: string, episodeId?: string | null) {
  if (episodeId) {
    const linked = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    if (linked.length > 0) {
      return db
        .select()
        .from(characters)
        .where(inArray(characters.id, linked.map((row) => row.characterId)))
        .orderBy(asc(characters.name));
    }
    return db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.projectId, projectId),
          or(isNull(characters.episodeId), eq(characters.episodeId, episodeId)),
        ),
      )
      .orderBy(asc(characters.name));
  }

  return db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId))
    .orderBy(asc(characters.name));
}

export type ParsedShotForSpec = Partial<{
  sequence: number;
  sceneDescription: string;
  startFrame: string;
  endFrame: string;
  motionScript: string;
  videoScript: string | null;
  duration: number;
  dialogues: Array<{ character: string; text: string }>;
  cameraDirection: string;
  transitionIn: string;
  transitionOut: string;
  compositionGuide: string;
  focalPoint: string;
  depthOfField: string;
  soundDesign: string;
  musicCue: string;
  characters: string[];
  shotType: string;
  cameraAngle: string;
  cameraMovement: string;
  action: string;
  emotion: string;
  voiceover: string;
  continuityIn: string;
  continuityOut: string;
}>;

export type StoryboardPromptBuild = {
  prompt: string;
  negativePrompt: string;
  structuredPrompt: BuiltImagePrompt["structured_prompt"];
  referenceImages: string[];
  referenceLabels: string[];
  characterNames: string[];
};

async function selectInserted<T extends { id: string }>(
  id: string,
  query: () => T[] | Promise<T[]>,
) {
  const [row] = await query();
  if (!row) throw new Error(`Inserted row not found: ${id}`);
  return row;
}

export type CreateScriptInput = Omit<
  typeof scripts.$inferInsert,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export async function createScriptRecord(input: CreateScriptInput) {
  const now = new Date();
  const scriptId = input.id ?? genId();
  await db.insert(scripts).values({
    ...input,
    id: scriptId,
    createdAt: now,
    updatedAt: now,
  });

  return selectInserted(scriptId, () =>
    db.select().from(scripts).where(eq(scripts.id, scriptId)).limit(1),
  );
}

export type CreateScriptChunkInput = Omit<
  typeof scriptChunks.$inferInsert,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export async function createScriptChunkRecords(
  chunks: CreateScriptChunkInput[],
) {
  if (chunks.length === 0) return [];

  const now = new Date();
  const rows = chunks.map((chunk) => ({
    ...chunk,
    id: chunk.id ?? genId(),
    createdAt: now,
    updatedAt: now,
  }));

  await db.insert(scriptChunks).values(rows);
  return rows;
}

export type CreateComplianceReportInput = Omit<
  typeof complianceReports.$inferInsert,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export async function createComplianceReport(
  input: CreateComplianceReportInput,
) {
  const now = new Date();
  const reportId = input.id ?? genId();
  await db.insert(complianceReports).values({
    ...input,
    id: reportId,
    createdAt: now,
    updatedAt: now,
  });

  return selectInserted(reportId, () =>
    db
      .select()
      .from(complianceReports)
      .where(eq(complianceReports.id, reportId))
      .limit(1),
  );
}

export type CreateStoryAssetInput = Omit<
  typeof assets.$inferInsert,
  | "id"
  | "aliases"
  | "createdAt"
  | "updatedAt"
> & {
  id?: string;
  aliases?: string[];
  detail?: StoryAssetDetail;
};

export async function createStoryAsset(input: CreateStoryAssetInput) {
  const now = new Date();
  const assetId = input.id ?? genId();
  const { aliases, detail, ...assetInput } = input;

  await db.insert(assets).values({
    ...assetInput,
    id: assetId,
    aliases: jsonText(aliases),
    createdAt: now,
    updatedAt: now,
  });

  if (assetInput.type === "character") {
    await db.insert(characterAssets).values({
      ...(detail as Partial<typeof characterAssets.$inferInsert>),
      assetId,
    });
  }

  if (assetInput.type === "scene") {
    await db.insert(sceneAssets).values({
      ...(detail as Partial<typeof sceneAssets.$inferInsert>),
      assetId,
    });
  }

  if (assetInput.type === "prop") {
    await db.insert(propAssets).values({
      ...(detail as Partial<typeof propAssets.$inferInsert>),
      assetId,
    });
  }

  return selectInserted(assetId, () =>
    db.select().from(assets).where(eq(assets.id, assetId)).limit(1),
  );
}

export async function listStoryAssets(projectId: string, type?: AssetType) {
  return db
    .select()
    .from(assets)
    .where(
      type
        ? and(eq(assets.projectId, projectId), eq(assets.type, type))
        : eq(assets.projectId, projectId),
    )
    .orderBy(assets.type, assets.importance, assets.name);
}

export type CreateProductionBibleInput = Omit<
  typeof productionBibles.$inferInsert,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export async function createProductionBible(
  input: CreateProductionBibleInput,
) {
  const now = new Date();
  const bibleId = input.id ?? genId();
  await db.insert(productionBibles).values({
    ...input,
    id: bibleId,
    createdAt: now,
    updatedAt: now,
  });

  return selectInserted(bibleId, () =>
    db
      .select()
      .from(productionBibles)
      .where(eq(productionBibles.id, bibleId))
      .limit(1),
  );
}

export type CreateShotSpecInput = Omit<
  typeof shotSpecs.$inferInsert,
  | "id"
  | "characters"
  | "propAssetIds"
  | "createdAt"
  | "updatedAt"
> & {
  id?: string;
  characters?: string[];
  propAssetIds?: string[];
};

export async function createShotSpec(input: CreateShotSpecInput) {
  const now = new Date();
  const shotSpecId = input.id ?? genId();
  const { characters, propAssetIds, ...shotSpecInput } = input;

  await db.insert(shotSpecs).values({
    ...shotSpecInput,
    id: shotSpecId,
    characters: jsonText(characters),
    propAssetIds: jsonText(propAssetIds),
    createdAt: now,
    updatedAt: now,
  });

  return selectInserted(shotSpecId, () =>
    db.select().from(shotSpecs).where(eq(shotSpecs.id, shotSpecId)).limit(1),
  );
}

export async function listShotSpecsForScene(sceneId: string) {
  return db
    .select()
    .from(shotSpecs)
    .where(eq(shotSpecs.sceneId, sceneId))
    .orderBy(shotSpecs.sequence);
}

export type CreateStoryboardFrameInput = Omit<
  typeof storyboardFrames.$inferInsert,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export async function createStoryboardFrame(
  input: CreateStoryboardFrameInput,
) {
  const now = new Date();
  const frameId = input.id ?? genId();
  await db.insert(storyboardFrames).values({
    ...input,
    id: frameId,
    createdAt: now,
    updatedAt: now,
  });

  return selectInserted(frameId, () =>
    db
      .select()
      .from(storyboardFrames)
      .where(eq(storyboardFrames.id, frameId))
      .limit(1),
  );
}

export async function upsertShotSpecFromShot(input: {
  projectId: string;
  episodeId?: string | null;
  shotId: string;
  parsedShot?: ParsedShotForSpec;
}) {
  const [shot] = await db.select().from(shots).where(eq(shots.id, input.shotId)).limit(1);
  if (!shot) throw new Error(`Shot not found: ${input.shotId}`);

  const episodeId = input.episodeId ?? shot.episodeId ?? null;
  const parsedShot = input.parsedShot ?? {};
  const allAssets = await listStoryAssets(input.projectId);
  const characterRows = await getCharactersForShot(input.projectId, episodeId);
  const textCorpus = [
    shot.prompt,
    shot.motionScript,
    shot.videoScript,
    shot.cameraDirection,
    shot.compositionGuide,
    shot.focalPoint,
    parsedShot.sceneDescription,
    parsedShot.startFrame,
    parsedShot.endFrame,
    parsedShot.motionScript,
    parsedShot.videoScript,
  ].filter(Boolean).join("\n");

  const dbDialogueRows = parsedShot.dialogues
    ? []
    : await db
        .select({
          text: dialogues.text,
          characterName: characters.name,
        })
        .from(dialogues)
        .leftJoin(characters, eq(dialogues.characterId, characters.id))
        .where(eq(dialogues.shotId, shot.id))
        .orderBy(asc(dialogues.sequence));

  const dialogueItems = parsedShot.dialogues
    ? parsedShot.dialogues
    : dbDialogueRows.map((row) => ({
        character: row.characterName ?? "",
        text: row.text,
      }));

  const dialogueText = buildDialogueText(dialogueItems);
  const characterNames = uniq([
    ...(parsedShot.characters ?? []),
    ...dialogueItems.map((item) => item.character),
    ...characterRows
      .filter((character) =>
        textMentionsTerm(`${textCorpus}\n${dialogueText}`, character.name),
      )
      .map((character) => character.name),
    ...allAssets
      .filter((asset) => asset.type === "character" && textMentionsAsset(`${textCorpus}\n${dialogueText}`, asset))
      .map((asset) => asset.name),
  ]);

  const sceneAsset = allAssets
    .filter((asset) => asset.type === "scene")
    .find((asset) => textMentionsAsset(textCorpus, asset));
  const propAssetIds = allAssets
    .filter((asset) => asset.type === "prop" && textMentionsAsset(`${textCorpus}\n${dialogueText}`, asset))
    .map((asset) => asset.id);
  const activeBible = await getActiveProductionBible(input.projectId, episodeId);
  const positivePrompt = buildShotSpecPositivePrompt({
    shot,
    parsedShot,
    characterNames,
    sceneAsset,
    propAssets: allAssets.filter((asset) => propAssetIds.includes(asset.id)),
    bible: activeBible,
  });
  const negativePrompt = [
    activeBible?.negativePromptTemplate,
    ...allAssets
      .filter((asset) => asset.type === "character" && characterNames.includes(asset.name))
      .map((asset) => asset.negativeConstraints),
    sceneAsset?.negativeConstraints,
  ].filter(Boolean).join("\n");

  const now = new Date();
  const values = {
    shotId: shot.id,
    projectId: input.projectId,
    episodeId,
    sceneId: shot.sceneId ?? null,
    sequence: shot.sequence,
    duration: shot.duration,
    characters: jsonText(characterNames),
    sceneAssetId: sceneAsset?.id ?? null,
    propAssetIds: jsonText(propAssetIds),
    shotType: parsedShot.shotType || inferShotType(shot, textCorpus),
    cameraAngle: parsedShot.cameraAngle || shot.compositionGuide || "",
    cameraMovement: parsedShot.cameraMovement || shot.cameraDirection || "",
    action: parsedShot.action || shot.motionScript || parsedShot.motionScript || shot.prompt || "",
    emotion: parsedShot.emotion || shot.focalPoint || "",
    dialogue: dialogueText,
    voiceover: parsedShot.voiceover || "",
    continuityIn: parsedShot.continuityIn || parsedShot.startFrame || "",
    continuityOut: parsedShot.continuityOut || parsedShot.endFrame || "",
    positivePrompt,
    negativePrompt,
    status: "ready" as const,
    updatedAt: now,
  };

  const [existing] = await db
    .select()
    .from(shotSpecs)
    .where(eq(shotSpecs.shotId, shot.id))
    .orderBy(desc(shotSpecs.version))
    .limit(1);

  if (existing) {
    await db.update(shotSpecs).set(values).where(eq(shotSpecs.id, existing.id));
    const [updated] = await db.select().from(shotSpecs).where(eq(shotSpecs.id, existing.id)).limit(1);
    return updated;
  }

  const shotSpecId = genId();
  await db.insert(shotSpecs).values({
    ...values,
    id: shotSpecId,
    version: 1,
    createdAt: now,
  });
  const [created] = await db.select().from(shotSpecs).where(eq(shotSpecs.id, shotSpecId)).limit(1);
  return created;
}

function buildShotSpecPositivePrompt(input: {
  shot: typeof shots.$inferSelect;
  parsedShot: ParsedShotForSpec;
  characterNames: string[];
  sceneAsset?: typeof assets.$inferSelect;
  propAssets: Array<typeof assets.$inferSelect>;
  bible: typeof productionBibles.$inferSelect | null;
}) {
  const { shot, parsedShot, characterNames, sceneAsset, propAssets, bible } = input;
  const lines = [
    bible?.positivePromptTemplate,
    "Storyboard still, cinematic short-drama frame, realistic production design, clean composition, no text overlay.",
    `Shot ${shot.sequence}: ${parsedShot.startFrame || shot.prompt || parsedShot.sceneDescription || ""}`,
    shot.motionScript && `Action: ${shot.motionScript}`,
    shot.cameraDirection && `Camera: ${shot.cameraDirection}`,
    shot.compositionGuide && `Composition: ${shot.compositionGuide}`,
    shot.focalPoint && `Focus/emotion: ${shot.focalPoint}`,
    characterNames.length > 0 && `Characters on screen: ${characterNames.join(", ")}`,
    sceneAsset && `Scene asset: ${sceneAsset.name}. ${sceneAsset.description || sceneAsset.visualConstraints || ""}`,
    propAssets.length > 0 && `Props: ${propAssets.map((asset) => `${asset.name} ${asset.description || asset.visualConstraints || ""}`.trim()).join("; ")}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export async function syncShotSpecsForShots(input: {
  projectId: string;
  episodeId?: string | null;
  versionId?: string | null;
}) {
  const conditions = [eq(shots.projectId, input.projectId)];
  if (input.episodeId) conditions.push(eq(shots.episodeId, input.episodeId));
  if (input.versionId) conditions.push(eq(shots.versionId, input.versionId));

  const shotRows = await db
    .select()
    .from(shots)
    .where(and(...conditions))
    .orderBy(asc(shots.sequence));

  const specs = [];
  for (const shot of shotRows) {
    specs.push(
      await upsertShotSpecFromShot({
        projectId: input.projectId,
        episodeId: input.episodeId ?? shot.episodeId,
        shotId: shot.id,
      }),
    );
  }

  return specs;
}

export async function buildStoryboardPromptForShotSpec(
  shotSpecId: string,
  options?: { frameRole?: PromptFrameRole },
): Promise<StoryboardPromptBuild> {
  const [spec] = await db.select().from(shotSpecs).where(eq(shotSpecs.id, shotSpecId)).limit(1);
  if (!spec) throw new Error(`Shot spec not found: ${shotSpecId}`);
  const bible = await getActiveProductionBible(spec.projectId, spec.episodeId);
  const characterNames = parseJsonArray(spec.characters);
  const propAssetIds = parseJsonArray(spec.propAssetIds);
  const allStoryAssets = await listStoryAssets(spec.projectId);
  const characterAssetsRows = allStoryAssets.filter((asset) =>
    asset.type === "character" &&
    characterNames.some((name) => asset.name === name || assetTerms(asset).includes(name)),
  );
  const sceneAsset = allStoryAssets.find((asset) => asset.id === spec.sceneAssetId);
  const propAssetsForPrompt = allStoryAssets.filter((asset) => propAssetIds.includes(asset.id));
  const selectedAssets = uniqueAssets([
    ...characterAssetsRows,
    ...(sceneAsset ? [sceneAsset] : []),
    ...propAssetsForPrompt,
  ]);
  const selectedAssetIds = selectedAssets.map((asset) => asset.id);
  const selectedVariants = selectedAssetIds.length > 0
    ? await db
        .select()
        .from(assetVariants)
        .where(inArray(assetVariants.assetId, selectedAssetIds))
        .orderBy(asc(assetVariants.assetId), asc(assetVariants.createdAt))
    : [];
  const variantsByAssetId = new Map<string, PromptAssetVariantInput | null>();
  for (const asset of selectedAssets) {
    const variants = selectedVariants.filter((variant) => variant.assetId === asset.id);
    variantsByAssetId.set(asset.id, normalizePromptVariant(choosePromptVariant(variants)));
  }

  const built = buildDeterministicImagePrompt({
    shotSpec: {
      id: spec.id,
      sequence: spec.sequence,
      duration: spec.duration,
      characters: characterNames,
      sceneAssetId: spec.sceneAssetId,
      propAssetIds,
      shotType: spec.shotType,
      cameraAngle: spec.cameraAngle,
      cameraMovement: spec.cameraMovement,
      action: spec.action,
      emotion: spec.emotion,
    },
    productionBible: bible,
    assets: selectedAssets.map(normalizePromptAsset),
    variantsByAssetId,
    frameRole: options?.frameRole ?? "storyboard",
  });

  const references = uniq([
    ...selectedAssets.map((asset) => variantsByAssetId.get(asset.id)?.referenceImage || asset.referenceImage),
  ]);
  const referenceLabels = references.map((ref) => {
    const asset = selectedAssets.find((row) =>
      row.referenceImage === ref || variantsByAssetId.get(row.id)?.referenceImage === ref
    );
    return asset?.name ?? "reference";
  });

  return {
    prompt: built.prompt,
    negativePrompt: built.negative_prompt,
    structuredPrompt: built.structured_prompt,
    referenceImages: references,
    referenceLabels,
    characterNames,
  };
}

function uniqueAssets(rows: Array<typeof assets.$inferSelect>) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function normalizePromptAsset(row: typeof assets.$inferSelect): PromptAssetInput {
  return {
    id: row.id,
    type: row.type as PromptAssetInput["type"],
    name: row.name,
    description: row.description,
    visualConstraints: row.visualConstraints,
    negativeConstraints: row.negativeConstraints,
    referenceImage: row.referenceImage,
  };
}

function choosePromptVariant(rows: Array<typeof assetVariants.$inferSelect>) {
  if (rows.length === 0) return null;
  const statusRank = new Map([
    ["locked", 0],
    ["approved", 1],
    ["generated", 2],
    ["reviewing", 3],
    ["draft", 4],
    ["rejected", 5],
  ]);
  return [...rows].sort((a, b) => {
    const byStatus = (statusRank.get(a.status) ?? 10) - (statusRank.get(b.status) ?? 10);
    if (byStatus !== 0) return byStatus;
    const byDefault =
      (a.variantType === "default" || a.name === "default" ? 0 : 1) -
      (b.variantType === "default" || b.name === "default" ? 0 : 1);
    if (byDefault !== 0) return byDefault;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

function normalizePromptVariant(row: typeof assetVariants.$inferSelect | null | undefined): PromptAssetVariantInput | null {
  if (!row) return null;
  return {
    id: row.id,
    assetId: row.assetId,
    name: row.name,
    variantType: row.variantType,
    state: row.state,
    lockedTraits: row.lockedTraits,
    changedTraits: row.changedTraits,
    visualConstraints: row.visualConstraints,
    negativeConstraints: row.negativeConstraints,
    referenceImage: row.referenceImage,
  };
}

export async function upsertStoryboardFramePrompt(input: {
  projectId: string;
  episodeId?: string | null;
  shotSpecId: string;
  frameIndex?: number;
  overwrite?: boolean;
}) {
  const [spec] = await db.select().from(shotSpecs).where(eq(shotSpecs.id, input.shotSpecId)).limit(1);
  if (!spec) throw new Error(`Shot spec not found: ${input.shotSpecId}`);

  const frameIndex = input.frameIndex ?? 0;
  const built = await buildStoryboardPromptForShotSpec(spec.id);
  const [existing] = await db
    .select()
    .from(storyboardFrames)
    .where(and(eq(storyboardFrames.shotSpecId, spec.id), eq(storyboardFrames.frameIndex, frameIndex)))
    .orderBy(desc(storyboardFrames.createdAt))
    .limit(1);
  const now = new Date();

  if (existing) {
    if (!input.overwrite && existing.prompt && existing.imageUrl) return existing;
    await db
      .update(storyboardFrames)
      .set({
        prompt: built.prompt,
        negativePrompt: built.negativePrompt,
        status: existing.imageUrl && !input.overwrite ? existing.status : "pending",
        imageUrl: input.overwrite ? null : existing.imageUrl,
        metadata: {
          ...(typeof existing.metadata === "object" && existing.metadata ? existing.metadata : {}),
          referenceImages: built.referenceImages,
          referenceLabels: built.referenceLabels,
          structured_prompt: built.structuredPrompt,
          prompt_builder: "deterministic_v1",
        },
        updatedAt: now,
      })
      .where(eq(storyboardFrames.id, existing.id));
    const [updated] = await db.select().from(storyboardFrames).where(eq(storyboardFrames.id, existing.id)).limit(1);
    return updated;
  }

  const frameId = genId();
  await db.insert(storyboardFrames).values({
    id: frameId,
    projectId: input.projectId,
    episodeId: input.episodeId ?? spec.episodeId ?? null,
    sceneId: spec.sceneId ?? null,
    shotId: spec.shotId ?? null,
    shotSpecId: spec.id,
    frameIndex,
    prompt: built.prompt,
    negativePrompt: built.negativePrompt,
    status: "pending",
    metadata: {
      referenceImages: built.referenceImages,
      referenceLabels: built.referenceLabels,
      structured_prompt: built.structuredPrompt,
      prompt_builder: "deterministic_v1",
    },
    createdAt: now,
    updatedAt: now,
  });
  const [created] = await db.select().from(storyboardFrames).where(eq(storyboardFrames.id, frameId)).limit(1);
  return created;
}

export async function createStoryboardPromptsForShots(input: {
  projectId: string;
  episodeId?: string | null;
  versionId?: string | null;
  overwrite?: boolean;
}) {
  const specs = await syncShotSpecsForShots(input);
  const frames = [];
  for (const spec of specs) {
    frames.push(
      await upsertStoryboardFramePrompt({
        projectId: input.projectId,
        episodeId: input.episodeId ?? spec.episodeId,
        shotSpecId: spec.id,
        frameIndex: 0,
        overwrite: input.overwrite,
      }),
    );
  }
  return { specs, frames };
}

export async function generateStoryboardFrameImage(input: {
  frameId: string;
  imageProvider: AIProvider;
  imageOptions?: ImageOptions;
  modelProvider?: string | null;
  modelId?: string | null;
  overwrite?: boolean;
}) {
  const [frame] = await db.select().from(storyboardFrames).where(eq(storyboardFrames.id, input.frameId)).limit(1);
  if (!frame) throw new Error(`Storyboard frame not found: ${input.frameId}`);
  if (frame.imageUrl && !input.overwrite) return frame;

  const built = frame.shotSpecId
    ? await buildStoryboardPromptForShotSpec(frame.shotSpecId)
    : {
        prompt: frame.prompt,
        negativePrompt: frame.negativePrompt,
        structuredPrompt: ((frame.metadata as { structured_prompt?: BuiltImagePrompt["structured_prompt"] } | null)?.structured_prompt ?? {
          subjects: [],
          scene: { asset_id: null, variant_id: null, name: "", visual: "", era: "", constraints: [] },
          camera: { shot_type: "storyboard", movement: "static", composition: "", frame_role: "storyboard" },
          action: "",
          style: "",
        }),
        referenceImages: parseJsonArray((frame.metadata as { referenceImages?: unknown } | null)?.referenceImages),
        referenceLabels: parseJsonArray((frame.metadata as { referenceLabels?: unknown } | null)?.referenceLabels),
        characterNames: [],
      };
  const prompt = [built.prompt, built.negativePrompt && `Negative prompt: ${built.negativePrompt}`]
    .filter(Boolean)
    .join("\n\n");

  await db
    .update(storyboardFrames)
    .set({ status: "generating", updatedAt: new Date() })
    .where(eq(storyboardFrames.id, frame.id));

  try {
    const imageUrl = await input.imageProvider.generateImage(prompt, {
      ...input.imageOptions,
      quality: input.imageOptions?.quality ?? "hd",
      referenceImages: built.referenceImages,
      referenceLabels: built.referenceLabels,
    });
    await db
      .update(storyboardFrames)
      .set({
        imageUrl,
        prompt: built.prompt,
        negativePrompt: built.negativePrompt,
        status: "completed",
        modelProvider: input.modelProvider ?? null,
        modelId: input.modelId ?? null,
        metadata: {
          ...(typeof frame.metadata === "object" && frame.metadata ? frame.metadata : {}),
          referenceImages: built.referenceImages,
          referenceLabels: built.referenceLabels,
          structured_prompt: built.structuredPrompt,
          prompt_builder: "deterministic_v1",
          generatedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(storyboardFrames.id, frame.id));
    const [updated] = await db.select().from(storyboardFrames).where(eq(storyboardFrames.id, frame.id)).limit(1);
    return updated;
  } catch (error) {
    await db
      .update(storyboardFrames)
      .set({
        status: "failed",
        metadata: {
          ...(typeof frame.metadata === "object" && frame.metadata ? frame.metadata : {}),
          error: error instanceof Error ? error.message : String(error),
        },
        updatedAt: new Date(),
      })
      .where(eq(storyboardFrames.id, frame.id));
    throw error;
  }
}
