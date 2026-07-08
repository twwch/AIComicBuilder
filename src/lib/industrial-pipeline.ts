import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { db, ensureProductionPipelineTables } from "@/lib/db";
import {
  assetLibraryVersions,
  assetOccurrences,
  assetVariants,
  assets,
  costLedger,
  finalExportVersions,
  pipelineIssues,
  shotSpecs,
  shotVersions,
  storyboardPipelineVersions,
  videoClipVersions,
  visualAssetVersions,
  visualAssets,
} from "@/lib/db/schema";
import {
  buildAssetImagePrompt,
  type AssetPromptType,
  type AssetStyleSpec,
  type AssetVisualSchema,
} from "@/lib/asset-prompt-builder";
import { requireConfirmedScriptVersion } from "@/lib/confirmed-script-version";
import { id as genId } from "@/lib/id";
import {
  groupFlatAssets,
  validateShotAssetBindings,
  type FlatBindingAsset,
} from "@/lib/shot-asset-binding-validator";
import {
  compileStoryboardFrames,
  type StoryboardAssetInput,
  type StoryboardAssetVariantInput,
  type StoryboardVisualAssetInput,
} from "@/lib/storyboard";

type AssetRow = typeof assets.$inferSelect;
type AssetVariantRow = typeof assetVariants.$inferSelect;
type AssetLibraryVersionRow = typeof assetLibraryVersions.$inferSelect;

export type PipelineSeverity = "low" | "medium" | "high" | "critical";

export interface PipelineIssueInput {
  projectId: string;
  stage: string;
  issueType: string;
  severity?: PipelineSeverity;
  sourceVersionType?: string;
  sourceVersionId?: string;
  sourceObjectType?: string;
  sourceObjectId?: string;
  sourceRange?: unknown;
  sourceText?: string;
  message: string;
  suggestedAction?: string;
}

export interface CostLedgerInput {
  projectId: string;
  stage: string;
  objectType?: string;
  objectId?: string;
  provider?: string;
  modelId?: string;
  costCents?: number;
  currency?: string;
  usage?: unknown;
}

function now() {
  return new Date();
}

function asArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function parseAliases(value: unknown) {
  return asArray<string>(value).map((item) => String(item).trim()).filter(Boolean);
}

function importanceLabel(score: number) {
  if (score >= 80) return "core";
  if (score >= 50) return "important";
  if (score >= 20) return "temporary";
  if (score > 0) return "background";
  return "prompt_only";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function toOptionalRecord<T = Record<string, unknown>>(value: unknown): T | null {
  const record = toRecord(value);
  return Object.keys(record).length ? record as T : null;
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function readStringArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.map((item) => String(item ?? "").trim()).filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      if (value.trim().startsWith("[")) return asArray<string>(value);
      return value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function lockedAssetReviewSummary(assetsToLock: AssetRow[], excludedAssets: AssetRow[], variantsToLock: AssetVariantRow[]) {
  const missingVisual = assetsToLock
    .filter((asset) => !String(asset.visualConstraints || asset.description || "").trim())
    .map((asset) => ({ id: asset.id, name: asset.name, type: asset.type }));
  const missingNegative = assetsToLock
    .filter((asset) => !String(asset.negativeConstraints || "").trim())
    .map((asset) => ({ id: asset.id, name: asset.name, type: asset.type }));
  const variantAssetIds = new Set(variantsToLock.map((variant) => variant.assetId));
  const missingVariants = assetsToLock
    .filter((asset) => !variantAssetIds.has(asset.id))
    .map((asset) => ({ id: asset.id, name: asset.name, type: asset.type }));

  return {
    standardVersion: "asset_library_standard_v1",
    lockedAssetCount: assetsToLock.length,
    lockedVariantCount: variantsToLock.length,
    excludedUnconfirmedAssetCount: excludedAssets.length,
    excludedUnconfirmedAssets: excludedAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
    })),
    checks: {
      allLockedAssetsConfirmed: assetsToLock.every((asset) => asset.confirmed === 1),
      visualConstraintsPresent: missingVisual.length === 0,
      negativeConstraintsPresent: missingNegative.length === 0,
      variantsPresent: missingVariants.length === 0,
    },
    issues: {
      missingVisual,
      missingNegative,
      missingVariants,
    },
  };
}

function assertAssetLibraryLockable(summary: ReturnType<typeof lockedAssetReviewSummary>) {
  if (summary.lockedAssetCount === 0) {
    throw new Error("Cannot lock asset library: no confirmed assets are available");
  }
  if (summary.issues.missingVisual.length > 0) {
    throw new Error(`Cannot lock asset library: ${summary.issues.missingVisual.length} confirmed asset(s) are missing visual constraints`);
  }
}

async function nextAssetLibraryVersion(projectId: string) {
  const [row] = await db
    .select({ value: max(assetLibraryVersions.versionNum) })
    .from(assetLibraryVersions)
    .where(eq(assetLibraryVersions.projectId, projectId));
  return Number(row?.value ?? 0) + 1;
}

async function nextVisualAssetVersion(projectId: string) {
  const [row] = await db
    .select({ value: max(visualAssetVersions.versionNum) })
    .from(visualAssetVersions)
    .where(eq(visualAssetVersions.projectId, projectId));
  return Number(row?.value ?? 0) + 1;
}

async function nextShotVersion(projectId: string) {
  const [row] = await db
    .select({ value: max(shotVersions.versionNum) })
    .from(shotVersions)
    .where(eq(shotVersions.projectId, projectId));
  return Number(row?.value ?? 0) + 1;
}

async function nextStoryboardVersion(projectId: string) {
  const [row] = await db
    .select({ value: max(storyboardPipelineVersions.versionNum) })
    .from(storyboardPipelineVersions)
    .where(eq(storyboardPipelineVersions.projectId, projectId));
  return Number(row?.value ?? 0) + 1;
}

async function nextVideoClipVersion(projectId: string) {
  const [row] = await db
    .select({ value: max(videoClipVersions.versionNum) })
    .from(videoClipVersions)
    .where(eq(videoClipVersions.projectId, projectId));
  return Number(row?.value ?? 0) + 1;
}

async function nextFinalExportVersion(projectId: string) {
  const [row] = await db
    .select({ value: max(finalExportVersions.versionNum) })
    .from(finalExportVersions)
    .where(eq(finalExportVersions.projectId, projectId));
  return Number(row?.value ?? 0) + 1;
}

async function loadLatestAssetLibrary(projectId: string, versionId?: string | null) {
  ensureProductionPipelineTables();
  const where = versionId
    ? and(eq(assetLibraryVersions.projectId, projectId), eq(assetLibraryVersions.id, versionId))
    : and(eq(assetLibraryVersions.projectId, projectId), eq(assetLibraryVersions.status, "locked"));

  const [row] = await db
    .select()
    .from(assetLibraryVersions)
    .where(where)
    .orderBy(desc(assetLibraryVersions.versionNum), desc(assetLibraryVersions.createdAt))
    .limit(1);

  return row ?? null;
}

export async function requireLockedAssetLibraryVersion(projectId: string, versionId?: string | null) {
  const row = await loadLatestAssetLibrary(projectId, versionId);
  if (!row || row.status !== "locked") {
    const error = new Error("This stage requires a locked asset_library_version");
    error.name = "LockedAssetLibraryRequiredError";
    throw error;
  }
  return row;
}

async function loadLatestVisualAssetVersion(projectId: string, versionId?: string | null) {
  ensureProductionPipelineTables();
  const where = versionId
    ? and(eq(visualAssetVersions.projectId, projectId), eq(visualAssetVersions.id, versionId))
    : and(eq(visualAssetVersions.projectId, projectId), eq(visualAssetVersions.status, "locked"));

  const [row] = await db
    .select()
    .from(visualAssetVersions)
    .where(where)
    .orderBy(desc(visualAssetVersions.versionNum), desc(visualAssetVersions.createdAt))
    .limit(1);

  return row ?? null;
}

export async function requireLockedVisualAssetVersion(projectId: string, versionId?: string | null) {
  const row = await loadLatestVisualAssetVersion(projectId, versionId);
  if (!row || row.status !== "locked") {
    const error = new Error("This stage requires a locked visual_asset_version");
    error.name = "LockedVisualAssetRequiredError";
    throw error;
  }
  return row;
}

async function loadLatestShotVersion(projectId: string, versionId?: string | null) {
  ensureProductionPipelineTables();
  const where = versionId
    ? and(eq(shotVersions.projectId, projectId), eq(shotVersions.id, versionId))
    : and(eq(shotVersions.projectId, projectId), eq(shotVersions.status, "locked"));

  const [row] = await db
    .select()
    .from(shotVersions)
    .where(where)
    .orderBy(desc(shotVersions.versionNum), desc(shotVersions.createdAt))
    .limit(1);

  return row ?? null;
}

export async function requireLockedShotVersion(projectId: string, versionId?: string | null) {
  const row = await loadLatestShotVersion(projectId, versionId);
  if (!row || row.status !== "locked") {
    const error = new Error("This stage requires a locked shot_version");
    error.name = "LockedShotVersionRequiredError";
    throw error;
  }
  return row;
}

async function loadLatestStoryboardVersion(projectId: string, versionId?: string | null) {
  ensureProductionPipelineTables();
  const where = versionId
    ? and(eq(storyboardPipelineVersions.projectId, projectId), eq(storyboardPipelineVersions.id, versionId))
    : and(eq(storyboardPipelineVersions.projectId, projectId), eq(storyboardPipelineVersions.status, "locked"));

  const [row] = await db
    .select()
    .from(storyboardPipelineVersions)
    .where(where)
    .orderBy(desc(storyboardPipelineVersions.versionNum), desc(storyboardPipelineVersions.createdAt))
    .limit(1);

  return row ?? null;
}

export async function requireLockedStoryboardVersion(projectId: string, versionId?: string | null) {
  const row = await loadLatestStoryboardVersion(projectId, versionId);
  if (!row || row.status !== "locked") {
    const error = new Error("This stage requires a locked storyboard_version");
    error.name = "LockedStoryboardVersionRequiredError";
    throw error;
  }
  return row;
}

async function loadLatestVideoClipVersion(projectId: string, versionId?: string | null) {
  ensureProductionPipelineTables();
  const where = versionId
    ? and(eq(videoClipVersions.projectId, projectId), eq(videoClipVersions.id, versionId))
    : and(eq(videoClipVersions.projectId, projectId), eq(videoClipVersions.status, "approved"));

  const [row] = await db
    .select()
    .from(videoClipVersions)
    .where(where)
    .orderBy(desc(videoClipVersions.versionNum), desc(videoClipVersions.createdAt))
    .limit(1);

  return row ?? null;
}

export async function requireApprovedVideoClipVersion(projectId: string, versionId?: string | null) {
  const row = await loadLatestVideoClipVersion(projectId, versionId);
  if (!row || row.status !== "approved") {
    const error = new Error("This stage requires an approved video_clip_version");
    error.name = "ApprovedVideoClipVersionRequiredError";
    throw error;
  }
  return row;
}

function snapshotAsset(row: AssetRow, sourceMentionIds: string[]) {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    name: row.name,
    aliases: parseAliases(row.aliases),
    canonicalDescription: row.description || row.visualConstraints || "",
    importance: importanceLabel(row.importance ?? 0),
    importanceScore: row.importance ?? 0,
    sourceMentionIds,
    status: "locked",
    visualConstraints: row.visualConstraints,
    negativeConstraints: row.negativeConstraints,
    referenceImage: row.referenceImage,
    metadata: row.metadata ?? {},
  };
}

function snapshotVariant(row: AssetVariantRow) {
  return {
    id: row.id,
    assetId: row.assetId,
    variantType: row.variantType,
    name: row.name,
    attributes: {
      state: row.state,
      lockedTraits: row.lockedTraits ?? {},
      changedTraits: row.changedTraits ?? {},
      visualConstraints: row.visualConstraints,
      negativeConstraints: row.negativeConstraints,
      referenceImage: row.referenceImage,
      metadata: row.metadata ?? {},
    },
    sourceMentionIds: row.sourceOccurrenceId ? [row.sourceOccurrenceId] : [],
    importance: "important",
    status: "locked",
  };
}

async function ensureBaseVariant(projectId: string, asset: AssetRow) {
  const existing = await db
    .select()
    .from(assetVariants)
    .where(eq(assetVariants.assetId, asset.id))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [row] = await db
    .insert(assetVariants)
    .values({
      id: genId(),
      projectId,
      assetId: asset.id,
      variantType: "base",
      name: "base",
      state: asset.visualConstraints || asset.description || "base reusable state",
      lockedTraits: {
        assetName: asset.name,
        assetType: asset.type,
      },
      changedTraits: {},
      visualConstraints: asset.visualConstraints || asset.description || "",
      negativeConstraints: asset.negativeConstraints || "",
      referenceImage: asset.referenceImage,
      status: "locked",
      metadata: { source: "auto_base_variant" },
      createdAt: now(),
      updatedAt: now(),
    })
    .returning();
  return row;
}

export async function lockAssetLibraryVersion(input: {
  projectId: string;
  confirmedScriptVersionId?: string | null;
  assetIds?: string[];
  userId?: string;
  reviewSummary?: unknown;
}) {
  ensureProductionPipelineTables();
  const confirmed = await requireConfirmedScriptVersion(
    input.projectId,
    input.confirmedScriptVersionId,
  );

  const assetRows = await db
    .select()
    .from(assets)
    .where(eq(assets.projectId, input.projectId))
    .orderBy(desc(assets.importance), asc(assets.type), asc(assets.name));
  if (assetRows.length === 0) {
    throw new Error("Cannot lock asset library: no assets have been created");
  }

  const requestedAssetIds = new Set((input.assetIds ?? []).map((id) => String(id || "").trim()).filter(Boolean));
  const assetsInRelease = requestedAssetIds.size > 0
    ? assetRows.filter((asset) => requestedAssetIds.has(asset.id))
    : assetRows;
  if (requestedAssetIds.size > 0 && assetsInRelease.length !== requestedAssetIds.size) {
    throw new Error("Cannot lock asset library: one or more selected assets are missing from the project");
  }

  const confirmedAssets = assetsInRelease.filter((asset) => asset.confirmed === 1);
  const selectedAssets = confirmedAssets;
  const excludedAssets = assetRows.filter((asset) =>
    requestedAssetIds.size > 0 ? !requestedAssetIds.has(asset.id) || asset.confirmed !== 1 : asset.confirmed !== 1
  );
  if (selectedAssets.length === 0) {
    throw new Error("Cannot lock asset library: no confirmed assets are available");
  }
  for (const asset of selectedAssets) {
    await ensureBaseVariant(input.projectId, asset);
  }

  const assetIds = selectedAssets.map((asset) => asset.id);
  const [variantRows, occurrenceRows] = await Promise.all([
    db
      .select()
      .from(assetVariants)
      .where(inArray(assetVariants.assetId, assetIds))
      .orderBy(asc(assetVariants.assetId), asc(assetVariants.createdAt)),
    db
      .select()
      .from(assetOccurrences)
      .where(inArray(assetOccurrences.assetId, assetIds))
      .orderBy(asc(assetOccurrences.createdAt)),
  ]);
  const selectedVariants = variantRows.filter((variant) => variant.status !== "rejected");
  const sourceIdsByAsset = new Map<string, string[]>();
  for (const occurrence of occurrenceRows) {
    const list = sourceIdsByAsset.get(occurrence.assetId) ?? [];
    list.push(occurrence.id);
    sourceIdsByAsset.set(occurrence.assetId, list);
  }
  const standardReviewSummary = lockedAssetReviewSummary(selectedAssets, excludedAssets, selectedVariants);
  assertAssetLibraryLockable(standardReviewSummary);

  await db
    .update(assets)
    .set({ confirmed: 1, updatedAt: now() })
    .where(inArray(assets.id, assetIds));
  if (selectedVariants.length > 0) {
    await db
      .update(assetVariants)
      .set({ status: "locked", updatedAt: now() })
      .where(inArray(assetVariants.id, selectedVariants.map((variant) => variant.id)));
  }

  const versionNum = await nextAssetLibraryVersion(input.projectId);
  await db
    .update(assetLibraryVersions)
    .set({ status: "archived" })
    .where(and(
      eq(assetLibraryVersions.projectId, input.projectId),
      eq(assetLibraryVersions.status, "locked"),
    ));

  const [version] = await db
    .insert(assetLibraryVersions)
    .values({
      id: genId(),
      projectId: input.projectId,
      confirmedScriptVersionId: confirmed.id,
      versionNum,
      status: "locked",
      assetsJson: selectedAssets.map((asset) => snapshotAsset(asset, sourceIdsByAsset.get(asset.id) ?? [])),
      variantsJson: selectedVariants.map(snapshotVariant),
      reviewSummary: {
        ...(toRecord(input.reviewSummary)),
        assetLibraryStandard: standardReviewSummary,
      },
      lockedBy: input.userId ?? "",
      createdAt: now(),
    })
    .returning();

  return version;
}

function assetsFromLibrary(version: AssetLibraryVersionRow) {
  return asArray<ReturnType<typeof snapshotAsset>>(version.assetsJson);
}

function variantsFromLibrary(version: AssetLibraryVersionRow) {
  return asArray<ReturnType<typeof snapshotVariant>>(version.variantsJson);
}

function variantForAsset(assetId: string, variants: Array<ReturnType<typeof snapshotVariant>>) {
  const assetVariantsForAsset = variants.filter((variant) => variant.assetId === assetId);
  return assetVariantsForAsset.find((variant) => variant.variantType === "base")
    ?? assetVariantsForAsset.find((variant) => variant.variantType === "default")
    ?? assetVariantsForAsset[0]
    ?? null;
}

function assetPromptType(type: string): AssetPromptType {
  return type === "character" || type === "scene" || type === "prop" ? type : "prop";
}

function shouldGenerateVisualAsset(asset: ReturnType<typeof snapshotAsset>) {
  return asset.importance === "core" || asset.importance === "important" || asset.importanceScore >= 50;
}

export async function compileVisualAssetVersion(input: {
  projectId: string;
  assetLibraryVersionId?: string | null;
}) {
  ensureProductionPipelineTables();
  const library = await requireLockedAssetLibraryVersion(input.projectId, input.assetLibraryVersionId);
  const libraryAssets = assetsFromLibrary(library);
  const libraryVariants = variantsFromLibrary(library);
  const candidates = libraryAssets.filter(shouldGenerateVisualAsset);
  const targetAssets = candidates.length > 0 ? candidates : libraryAssets;
  if (targetAssets.length === 0) throw new Error("No locked assets available for visual prompt compilation");

  const versionNum = await nextVisualAssetVersion(input.projectId);
  const [version] = await db
    .insert(visualAssetVersions)
    .values({
      id: genId(),
      projectId: input.projectId,
      assetLibraryVersionId: library.id,
      versionNum,
      status: "draft",
      itemsJson: [],
      validationJson: { errors: [], warnings: [] },
      createdAt: now(),
      updatedAt: now(),
    })
    .returning();

  const items = [];
  for (const asset of targetAssets) {
    const variant = variantForAsset(asset.id, libraryVariants);
    const assetMetadata = toRecord(asset.metadata);
    const variantAttributes = toRecord(variant?.attributes);
    const variantMetadata = toRecord(variantAttributes.metadata);
    const prompt = buildAssetImagePrompt({
      asset: {
        id: asset.id,
        type: assetPromptType(asset.type),
        name: asset.name,
        role: readString(assetMetadata, ["role", "roleKey", "scope"]),
        category: readString(assetMetadata, ["category"]),
        description: asset.canonicalDescription,
        prompt: readString(assetMetadata, ["prompt"]),
        visualConstraints: asset.visualConstraints,
        negativeConstraints: asset.negativeConstraints,
        tags: readStringArray(assetMetadata, ["tags"]),
        faceTemplate: toOptionalRecord(assetMetadata.faceTemplate),
        visualSchema: toOptionalRecord<AssetVisualSchema>(assetMetadata.visualSchema),
      },
      variant: variant ? {
        id: variant.id,
        name: variant.name,
        variantType: variant.variantType,
        state: String(variant.attributes?.state || ""),
        visualConstraints: String(variant.attributes?.visualConstraints || ""),
        negativeConstraints: String(variant.attributes?.negativeConstraints || ""),
        lockedTraits: variant.attributes?.lockedTraits,
        changedTraits: variant.attributes?.changedTraits,
        visualSchema: toOptionalRecord<Partial<AssetVisualSchema>>(variantMetadata.visualSchema),
      } : null,
      styleSpec: toOptionalRecord<AssetStyleSpec>(assetMetadata.styleSpec),
    });

    const [visualAsset] = await db
      .insert(visualAssets)
      .values({
        id: genId(),
        projectId: input.projectId,
        visualAssetVersionId: version.id,
        assetId: asset.id,
        variantId: variant?.id ?? null,
        assetType: assetPromptType(asset.type),
        prompt: prompt.compiled_final_prompt,
        negativePrompt: prompt.compiled_negative_prompt,
        status: prompt.validation_report.passed ? "queued" : "failed",
        metadata: {
          compiler_ir: prompt.compiler_ir,
          validation_report: prompt.validation_report,
          sourceAssetLibraryVersionId: library.id,
        },
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();

    items.push({
      id: visualAsset.id,
      asset_id: asset.id,
      variant_id: variant?.id ?? "",
      asset_type: asset.type,
      prompt_status: visualAsset.status,
      validation: prompt.validation_report,
    });
  }

  const validation = {
    errors: items.flatMap((item) => item.validation.errors.map((message: string) => ({
      visual_asset_id: item.id,
      message,
    }))),
    warnings: items.flatMap((item) => item.validation.warnings.map((message: string) => ({
      visual_asset_id: item.id,
      message,
    }))),
  };

  await db
    .update(visualAssetVersions)
    .set({
      itemsJson: items,
      validationJson: validation,
      status: validation.errors.length > 0 ? "failed" : "waiting_review",
      updatedAt: now(),
    })
    .where(eq(visualAssetVersions.id, version.id));

  const [updated] = await db
    .select()
    .from(visualAssetVersions)
    .where(eq(visualAssetVersions.id, version.id));
  return updated;
}

export async function lockVisualAssetVersion(input: {
  projectId: string;
  visualAssetVersionId: string;
  userId?: string;
  allowMissingImages?: boolean;
}) {
  ensureProductionPipelineTables();
  const [version] = await db
    .select()
    .from(visualAssetVersions)
    .where(and(
      eq(visualAssetVersions.projectId, input.projectId),
      eq(visualAssetVersions.id, input.visualAssetVersionId),
    ));
  if (!version) throw new Error("Visual asset version not found");

  const rows = await db
    .select()
    .from(visualAssets)
    .where(eq(visualAssets.visualAssetVersionId, version.id))
    .orderBy(asc(visualAssets.createdAt));
  const missing = rows.filter((row) => !row.resultUrl && !input.allowMissingImages);
  if (missing.length > 0) {
    throw new Error(`Cannot lock visual assets: ${missing.length} generated image(s) are missing`);
  }

  await db
    .update(visualAssetVersions)
    .set({ status: "archived", updatedAt: now() })
    .where(and(
      eq(visualAssetVersions.projectId, input.projectId),
      eq(visualAssetVersions.status, "locked"),
    ));

  if (rows.length > 0) {
    await db
      .update(visualAssets)
      .set({ status: "locked", updatedAt: now() })
      .where(inArray(visualAssets.id, rows.map((row) => row.id)));
  }
  for (const row of rows) {
    if (!row.resultUrl) continue;
    await db
      .update(assets)
      .set({ referenceImage: row.resultUrl, updatedAt: now() })
      .where(eq(assets.id, row.assetId));
    if (row.variantId) {
      await db
        .update(assetVariants)
        .set({ referenceImage: row.resultUrl, status: "locked", updatedAt: now() })
        .where(eq(assetVariants.id, row.variantId));
    }
  }

  await db
    .update(visualAssetVersions)
    .set({
      status: "locked",
      lockedBy: input.userId ?? "",
      itemsJson: rows.map((row) => ({
        id: row.id,
        asset_id: row.assetId,
        variant_id: row.variantId ?? "",
        result_url: row.resultUrl ?? "",
        status: "locked",
      })),
      updatedAt: now(),
    })
    .where(eq(visualAssetVersions.id, version.id));

  const [updated] = await db
    .select()
    .from(visualAssetVersions)
    .where(eq(visualAssetVersions.id, version.id));
  return updated;
}

function assetSystemFromLibrary(library: AssetLibraryVersionRow) {
  const rows = assetsFromLibrary(library).map((asset): FlatBindingAsset => ({
    id: asset.id,
    type: asset.type === "character" || asset.type === "scene" ? asset.type : "prop",
    name: asset.name,
    aliases: asset.aliases,
    description: asset.canonicalDescription,
  }));
  return groupFlatAssets(rows);
}

function idByAssetName(library: AssetLibraryVersionRow, type: "character" | "scene" | "prop") {
  const map = new Map<string, string>();
  for (const asset of assetsFromLibrary(library)) {
    if (asset.type !== type) continue;
    map.set(asset.name.toLowerCase(), asset.id);
    for (const alias of asset.aliases ?? []) map.set(alias.toLowerCase(), asset.id);
  }
  return map;
}

async function loadShotInputs(projectId: string, supplied?: unknown[]) {
  if (Array.isArray(supplied) && supplied.length > 0) return supplied;
  const rows = await db
    .select()
    .from(shotSpecs)
    .where(eq(shotSpecs.projectId, projectId))
    .orderBy(asc(shotSpecs.sequence), asc(shotSpecs.createdAt));
  return rows.map((row) => ({
    id: row.shotId || row.id,
    shot_id: row.shotId || row.id,
    episode_id: row.episodeId,
    scene_id: row.sceneId,
    scene_asset_id: row.sceneAssetId,
    character_asset_ids: asArray(row.characters),
    prop_asset_ids: asArray(row.propAssetIds),
    shot_type: row.shotType,
    camera: {
      shot_type: row.shotType,
      angle: row.cameraAngle,
      movement: row.cameraMovement,
    },
    action: row.action,
    emotion: row.emotion,
    dialogue: row.dialogue,
    voiceover: row.voiceover,
    duration_hint: row.duration,
    source_text: row.positivePrompt,
    lock_status: row.status === "ready" ? "locked" : row.status,
  }));
}

function normalizeShotForLibrary(rawShot: unknown, library: AssetLibraryVersionRow, index: number) {
  const record = toRecord(rawShot);
  const characterNameMap = idByAssetName(library, "character");
  const propNameMap = idByAssetName(library, "prop");
  const sceneNameMap = idByAssetName(library, "scene");
  const characterIds = readStringArray(record, ["character_asset_ids", "characterAssetIds", "character_ids", "characterIds"]);
  const propIds = readStringArray(record, ["prop_asset_ids", "propAssetIds", "prop_ids", "propIds"]);
  const characters = characterIds.map((value) => characterNameMap.get(value.toLowerCase()) ?? value);
  const props = propIds.map((value) => propNameMap.get(value.toLowerCase()) ?? value);
  const sceneAssetId = readString(record, ["scene_asset_id", "sceneAssetId"])
    || sceneNameMap.get(readString(record, ["location_name", "location", "scene"]).toLowerCase())
    || "";
  const shotId = readString(record, ["shot_id", "shotId", "id"]) || `shot_${String(index + 1).padStart(3, "0")}`;

  return {
    ...record,
    id: shotId,
    shot_id: shotId,
    scene_id: readString(record, ["scene_id", "sceneId"]) || readString(record, ["sceneId"]),
    scene_asset_id: sceneAssetId,
    character_asset_ids: characters,
    prop_asset_ids: props,
    action: readString(record, ["action", "motion_script", "motionScript", "source_text", "sourceText"]),
    dialogue: readString(record, ["dialogue", "dialogues", "dialogue_text", "dialogueText"]),
    source_text: readString(record, ["source_text", "sourceText", "prompt", "videoScript", "positive_prompt"]),
    lock_status: "locked",
  };
}

export async function createShotVersion(input: {
  projectId: string;
  assetLibraryVersionId?: string | null;
  confirmedScriptVersionId?: string | null;
  shots?: unknown[];
  lock?: boolean;
  userId?: string;
}) {
  ensureProductionPipelineTables();
  const confirmed = await requireConfirmedScriptVersion(input.projectId, input.confirmedScriptVersionId);
  const library = await requireLockedAssetLibraryVersion(input.projectId, input.assetLibraryVersionId);
  if (library.confirmedScriptVersionId !== confirmed.id) {
    throw new Error("Shot generation must use an asset library locked from the same confirmed script version");
  }

  const rawShots = await loadShotInputs(input.projectId, input.shots);
  if (rawShots.length === 0) throw new Error("No shot specs are available");
  const normalizedShots = rawShots.map((shot, index) => normalizeShotForLibrary(shot, library, index));
  const validation = validateShotAssetBindings({
    shot_spec: normalizedShots,
    asset_system: assetSystemFromLibrary(library),
  });
  if (input.lock && !validation.passed) {
    throw new Error(`Cannot lock shot version: ${validation.summary.errors} binding/feasibility error(s)`);
  }

  const versionNum = await nextShotVersion(input.projectId);
  if (input.lock) {
    await db
      .update(shotVersions)
      .set({ status: "archived" })
      .where(and(
        eq(shotVersions.projectId, input.projectId),
        eq(shotVersions.status, "locked"),
      ));
  }

  const [version] = await db
    .insert(shotVersions)
    .values({
      id: genId(),
      projectId: input.projectId,
      confirmedScriptVersionId: confirmed.id,
      assetLibraryVersionId: library.id,
      versionNum,
      status: input.lock ? "locked" : validation.passed ? "waiting_review" : "draft",
      shotsJson: normalizedShots,
      validationJson: validation,
      lockedBy: input.lock ? input.userId ?? "" : "",
      createdAt: now(),
    })
    .returning();

  return version;
}

function visualAssetsForStoryboard(rows: Array<typeof visualAssets.$inferSelect>): StoryboardVisualAssetInput[] {
  return rows
    .filter((row) => row.status === "locked" || row.resultUrl)
    .map((row) => ({
      asset_id: row.assetId,
      variant_id: row.variantId ?? "",
      referenceImage: row.resultUrl ?? "",
      status: row.status,
    }));
}

function storyboardAssetRows(library: AssetLibraryVersionRow): StoryboardAssetInput[] {
  return assetsFromLibrary(library).map((asset) => ({
    id: asset.id,
    type: asset.type,
    name: asset.name,
    aliases: asset.aliases,
    description: asset.canonicalDescription,
    visualConstraints: asset.visualConstraints,
    negativeConstraints: asset.negativeConstraints,
    referenceImage: asset.referenceImage,
  }));
}

function storyboardVariantRows(library: AssetLibraryVersionRow): StoryboardAssetVariantInput[] {
  return variantsFromLibrary(library).map((variant) => ({
    id: variant.id,
    assetId: variant.assetId,
    name: variant.name,
    variantType: variant.variantType,
    state: String(variant.attributes?.state || ""),
    lockedTraits: variant.attributes?.lockedTraits,
    changedTraits: variant.attributes?.changedTraits,
    visualConstraints: String(variant.attributes?.visualConstraints || ""),
    negativeConstraints: String(variant.attributes?.negativeConstraints || ""),
    referenceImage: String(variant.attributes?.referenceImage || ""),
    status: variant.status,
  }));
}

export async function createStoryboardPipelineVersion(input: {
  projectId: string;
  shotVersionId?: string | null;
  visualAssetVersionId?: string | null;
  frames?: unknown[];
  lock?: boolean;
  userId?: string;
}) {
  ensureProductionPipelineTables();
  const shotVersion = await requireLockedShotVersion(input.projectId, input.shotVersionId);
  const library = await requireLockedAssetLibraryVersion(input.projectId, shotVersion.assetLibraryVersionId);
  const visualVersion = input.visualAssetVersionId
    ? await requireLockedVisualAssetVersion(input.projectId, input.visualAssetVersionId)
    : await loadLatestVisualAssetVersion(input.projectId);

  const suppliedFrames = Array.isArray(input.frames) ? input.frames : [];
  let frames = suppliedFrames;
  let validation: unknown = { status: "valid", errors: [], warnings: [] };

  if (frames.length === 0) {
    const visualRows = visualVersion
      ? await db
          .select()
          .from(visualAssets)
          .where(eq(visualAssets.visualAssetVersionId, visualVersion.id))
      : [];
    const compiled = compileStoryboardFrames({
      locked_shots: asArray(shotVersion.shotsJson),
      assets: storyboardAssetRows(library),
      assetVariants: storyboardVariantRows(library),
      visualAssets: visualAssetsForStoryboard(visualRows),
      productionBible: null,
    });
    frames = compiled.storyboard_frames;
    validation = compiled.validation;
  }

  if (frames.length === 0) throw new Error("No storyboard frames are available");
  const validationRecord = toRecord(validation);
  const errors = Array.isArray(validationRecord.errors) ? validationRecord.errors : [];
  if (input.lock && errors.length > 0) {
    throw new Error(`Cannot lock storyboard version: ${errors.length} validation error(s)`);
  }

  const versionNum = await nextStoryboardVersion(input.projectId);
  if (input.lock) {
    await db
      .update(storyboardPipelineVersions)
      .set({ status: "archived", updatedAt: now() })
      .where(and(
        eq(storyboardPipelineVersions.projectId, input.projectId),
        eq(storyboardPipelineVersions.status, "locked"),
      ));
  }

  const [version] = await db
    .insert(storyboardPipelineVersions)
    .values({
      id: genId(),
      projectId: input.projectId,
      shotVersionId: shotVersion.id,
      visualAssetVersionId: visualVersion?.id ?? null,
      versionNum,
      status: input.lock ? "locked" : "waiting_review",
      framesJson: frames,
      validationJson: validation,
      lockedBy: input.lock ? input.userId ?? "" : "",
      createdAt: now(),
      updatedAt: now(),
    })
    .returning();

  return version;
}

function routeVideoModel(frame: unknown) {
  const record = toRecord(frame);
  const text = [
    readString(record, ["frame_description", "static_frame_description", "prompt"]),
    readString(record, ["action", "motion_script"]),
  ].join(" ").toLowerCase();
  if (/vehicle|truck|car|crash|fight|battle|explosion|rainstorm|chase|车辆|卡车|汽车|撞|战斗|追逐|暴雨/.test(text)) {
    return "high_quality_motion";
  }
  return "economy_static_or_dialogue";
}

export async function createVideoClipVersion(input: {
  projectId: string;
  storyboardVersionId?: string | null;
  clips?: unknown[];
  approve?: boolean;
  quality?: unknown;
}) {
  ensureProductionPipelineTables();
  const storyboard = await requireLockedStoryboardVersion(input.projectId, input.storyboardVersionId);
  const suppliedClips = Array.isArray(input.clips) ? input.clips : [];
  const clips = suppliedClips.length > 0
    ? suppliedClips
    : asArray(storyboard.framesJson).map((frame, index) => {
        const record = toRecord(frame);
        return {
          id: genId(),
          clip_id: `${readString(record, ["frame_id", "id"]) || `frame_${index + 1}`}_clip`,
          frame_id: readString(record, ["frame_id", "id"]),
          shot_id: readString(record, ["shot_id", "shotId"]),
          status: "pending",
          model_route: routeVideoModel(frame),
          prompt: "",
          result_url: "",
        };
      });

  const missing = clips.filter((clip) => {
    const record = toRecord(clip);
    return input.approve && !readString(record, ["result_url", "resultUrl", "file_url", "fileUrl"]);
  });
  if (missing.length > 0) {
    throw new Error(`Cannot approve video clips: ${missing.length} clip output(s) are missing`);
  }

  const versionNum = await nextVideoClipVersion(input.projectId);
  if (input.approve) {
    await db
      .update(videoClipVersions)
      .set({ status: "archived", updatedAt: now() })
      .where(and(
        eq(videoClipVersions.projectId, input.projectId),
        eq(videoClipVersions.status, "approved"),
      ));
  }

  const [version] = await db
    .insert(videoClipVersions)
    .values({
      id: genId(),
      projectId: input.projectId,
      storyboardVersionId: storyboard.id,
      versionNum,
      status: input.approve ? "approved" : "draft",
      clipsJson: clips,
      qualityJson: input.quality ?? {},
      createdAt: now(),
      updatedAt: now(),
    })
    .returning();

  return version;
}

export async function createFinalExportVersion(input: {
  projectId: string;
  videoClipVersionId?: string | null;
  exports?: unknown[];
  timeline?: unknown;
  complete?: boolean;
}) {
  ensureProductionPipelineTables();
  const clipsVersion = await requireApprovedVideoClipVersion(input.projectId, input.videoClipVersionId);
  const clips = asArray(clipsVersion.clipsJson);
  const exports = Array.isArray(input.exports) && input.exports.length > 0
    ? input.exports
    : [{
        platform: "master",
        aspect_ratio: "16:9",
        file_url: "",
        clip_count: clips.length,
      }];
  const missing = exports.filter((item) => input.complete && !readString(toRecord(item), ["file_url", "fileUrl", "url"]));
  if (missing.length > 0) {
    throw new Error(`Cannot complete final export: ${missing.length} export file(s) are missing`);
  }

  const versionNum = await nextFinalExportVersion(input.projectId);
  if (input.complete) {
    await db
      .update(finalExportVersions)
      .set({ status: "archived", updatedAt: now() })
      .where(and(
        eq(finalExportVersions.projectId, input.projectId),
        eq(finalExportVersions.status, "completed"),
      ));
  }

  const [version] = await db
    .insert(finalExportVersions)
    .values({
      id: genId(),
      projectId: input.projectId,
      videoClipVersionId: clipsVersion.id,
      versionNum,
      status: input.complete ? "completed" : "draft",
      exportsJson: exports,
      timelineJson: input.timeline ?? {
        sourceVideoClipVersionId: clipsVersion.id,
        clipCount: clips.length,
      },
      createdAt: now(),
      updatedAt: now(),
    })
    .returning();

  return version;
}

export async function recordPipelineIssue(input: PipelineIssueInput) {
  ensureProductionPipelineTables();
  const [issue] = await db
    .insert(pipelineIssues)
    .values({
      id: genId(),
      projectId: input.projectId,
      stage: input.stage,
      issueType: input.issueType,
      severity: input.severity ?? "low",
      sourceVersionType: input.sourceVersionType ?? "",
      sourceVersionId: input.sourceVersionId ?? "",
      sourceObjectType: input.sourceObjectType ?? "",
      sourceObjectId: input.sourceObjectId ?? "",
      sourceRangeJson: input.sourceRange ?? null,
      sourceText: input.sourceText ?? "",
      message: input.message,
      suggestedAction: input.suggestedAction ?? "human_review",
      status: "open",
      resolution: "",
      createdAt: now(),
      updatedAt: now(),
    })
    .returning();
  return issue;
}

export async function recordPipelineCost(input: CostLedgerInput) {
  ensureProductionPipelineTables();
  const [row] = await db
    .insert(costLedger)
    .values({
      id: genId(),
      projectId: input.projectId,
      stage: input.stage,
      objectType: input.objectType ?? "",
      objectId: input.objectId ?? "",
      provider: input.provider ?? "",
      modelId: input.modelId ?? "",
      costCents: Math.max(0, Math.round(input.costCents ?? 0)),
      currency: input.currency ?? "USD",
      usageJson: input.usage ?? {},
      createdAt: now(),
    })
    .returning();
  return row;
}

export async function getPipelineVersions(projectId: string) {
  ensureProductionPipelineTables();
  const [
    assetLibraries,
    visualVersions,
    shotVersionRows,
    storyboardVersions,
    videoVersions,
    exportVersions,
  ] = await Promise.all([
    db.select().from(assetLibraryVersions).where(eq(assetLibraryVersions.projectId, projectId)).orderBy(desc(assetLibraryVersions.versionNum)),
    db.select().from(visualAssetVersions).where(eq(visualAssetVersions.projectId, projectId)).orderBy(desc(visualAssetVersions.versionNum)),
    db.select().from(shotVersions).where(eq(shotVersions.projectId, projectId)).orderBy(desc(shotVersions.versionNum)),
    db.select().from(storyboardPipelineVersions).where(eq(storyboardPipelineVersions.projectId, projectId)).orderBy(desc(storyboardPipelineVersions.versionNum)),
    db.select().from(videoClipVersions).where(eq(videoClipVersions.projectId, projectId)).orderBy(desc(videoClipVersions.versionNum)),
    db.select().from(finalExportVersions).where(eq(finalExportVersions.projectId, projectId)).orderBy(desc(finalExportVersions.versionNum)),
  ]);

  return {
    asset_library_versions: assetLibraries,
    visual_asset_versions: visualVersions,
    shot_versions: shotVersionRows,
    storyboard_versions: storyboardVersions,
    video_clip_versions: videoVersions,
    final_export_versions: exportVersions,
  };
}
