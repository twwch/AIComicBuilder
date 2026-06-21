/**
 * Helpers for the unified `shot_assets` table.
 *
 * Concept reminder:
 *   - One row = one generated artifact (image or video) attached to a shot.
 *   - `type` discriminates which generation mode/role it belongs to.
 *   - Versioning: regenerating an asset inserts a new row with
 *     (asset_version + 1, is_active = 1) and flips the previous active row
 *     to is_active = 0. The "current" asset is always is_active = 1.
 */

import { db } from "@/lib/db";
import { shotAssets } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { id as genId } from "@/lib/id";

export type ShotAssetType =
  | "first_frame"
  | "last_frame"
  | "reference"
  | "keyframe_video"
  | "reference_video"
  | "panel_1"
  | "panel_2"
  | "panel_3"
  | "panel_4";

export type ShotAssetStatus =
  | "pending"
  | "generating"
  | "completed"
  | "failed";

export interface ShotAssetRow {
  id: string;
  shotId: string;
  type: ShotAssetType;
  sequenceInType: number;
  assetVersion: number;
  isActive: number;
  prompt: string;
  fileUrl: string | null;
  status: ShotAssetStatus;
  characters: string[] | null;
  modelProvider: string | null;
  modelId: string | null;
  meta: Record<string, unknown> | null;
  generationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToAsset(row: typeof shotAssets.$inferSelect): ShotAssetRow {
  return {
    id: row.id,
    shotId: row.shotId,
    type: row.type as ShotAssetType,
    sequenceInType: row.sequenceInType,
    assetVersion: row.assetVersion,
    isActive: row.isActive,
    prompt: row.prompt,
    fileUrl: row.fileUrl,
    status: row.status as ShotAssetStatus,
    characters: row.characters ? JSON.parse(row.characters) : null,
    modelProvider: row.modelProvider,
    modelId: row.modelId,
    meta: row.meta ? JSON.parse(row.meta) : null,
    generationId: row.generationId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Get all currently-active assets of a given type for a shot, ordered by sequenceInType. */
export async function getActiveAssets(
  shotId: string,
  type: ShotAssetType
): Promise<ShotAssetRow[]> {
  const rows = await db
    .select()
    .from(shotAssets)
    .where(
      and(
        eq(shotAssets.shotId, shotId),
        eq(shotAssets.type, type),
        eq(shotAssets.isActive, 1)
      )
    )
    .orderBy(shotAssets.sequenceInType);
  return rows.map(rowToAsset);
}

/** Get the single currently-active asset for a (shot, type, sequenceInType) slot. */
export async function getActiveAsset(
  shotId: string,
  type: ShotAssetType,
  sequenceInType = 0
): Promise<ShotAssetRow | null> {
  const [row] = await db
    .select()
    .from(shotAssets)
    .where(
      and(
        eq(shotAssets.shotId, shotId),
        eq(shotAssets.type, type),
        eq(shotAssets.sequenceInType, sequenceInType),
        eq(shotAssets.isActive, 1)
      )
    )
    .limit(1);
  return row ? rowToAsset(row) : null;
}

/** Get the full version history (all rows, including inactive) of a slot. */
export async function getAssetHistory(
  shotId: string,
  type: ShotAssetType,
  sequenceInType = 0
): Promise<ShotAssetRow[]> {
  const rows = await db
    .select()
    .from(shotAssets)
    .where(
      and(
        eq(shotAssets.shotId, shotId),
        eq(shotAssets.type, type),
        eq(shotAssets.sequenceInType, sequenceInType)
      )
    )
    .orderBy(desc(shotAssets.assetVersion));
  return rows.map(rowToAsset);
}

export interface UpsertAssetInput {
  shotId: string;
  type: ShotAssetType;
  sequenceInType?: number;
  prompt: string;
  fileUrl?: string | null;
  status?: ShotAssetStatus;
  characters?: string[] | null;
  modelProvider?: string | null;
  modelId?: string | null;
  meta?: Record<string, unknown> | null;
  generationId?: string | null;
}

/**
 * Insert a new asset version.
 * - If a previous active row exists for the same (shot_id, type, sequence_in_type),
 *   it is flipped to is_active=0 and the new row's asset_version = old + 1.
 * - Otherwise the new row starts at asset_version = 1.
 *
 * Returns the inserted row.
 */
export async function insertAssetVersion(
  input: UpsertAssetInput
): Promise<ShotAssetRow> {
  const sequenceInType = input.sequenceInType ?? 0;

  // Find any existing rows in this slot to compute the new version number,
  // and to deactivate the current active row.
  const existing = await db
    .select()
    .from(shotAssets)
    .where(
      and(
        eq(shotAssets.shotId, input.shotId),
        eq(shotAssets.type, input.type),
        eq(shotAssets.sequenceInType, sequenceInType)
      )
    )
    .orderBy(desc(shotAssets.assetVersion));

  const nextVersion = existing.length > 0 ? existing[0].assetVersion + 1 : 1;

  // Previous row in this slot — we inherit meta / characters from it when
  // the caller doesn't explicitly override. Version bump should NOT silently
  // drop metadata like sceneName, character tags, etc.
  const previousRow = existing[0];

  // Deactivate any currently active row in this slot.
  const activeIds = existing
    .filter((r) => r.isActive === 1)
    .map((r) => r.id);
  for (const id of activeIds) {
    await db
      .update(shotAssets)
      .set({ isActive: 0, updatedAt: new Date() })
      .where(eq(shotAssets.id, id));
  }

  // Resolve characters: explicit input > previous row's characters > null
  const resolvedCharacters =
    input.characters !== undefined
      ? input.characters
        ? JSON.stringify(input.characters)
        : null
      : previousRow?.characters ?? null;

  // Resolve meta: explicit input > previous row's meta > null
  const resolvedMeta =
    input.meta !== undefined
      ? input.meta
        ? JSON.stringify(input.meta)
        : null
      : previousRow?.meta ?? null;

  const now = new Date();
  const newRow = {
    id: genId(),
    shotId: input.shotId,
    type: input.type,
    sequenceInType,
    assetVersion: nextVersion,
    isActive: 1,
    prompt: input.prompt,
    fileUrl: input.fileUrl ?? null,
    status: input.status ?? "pending",
    characters: resolvedCharacters,
    modelProvider: input.modelProvider ?? null,
    modelId: input.modelId ?? null,
    meta: resolvedMeta,
    generationId: input.generationId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(shotAssets).values(newRow);
  return rowToAsset({ ...newRow });
}

/** Update an existing asset row in place (e.g. to attach the generated file_url after generation completes). */
export async function patchAsset(
  assetId: string,
  patch: Partial<{
    fileUrl: string | null;
    status: ShotAssetStatus;
    prompt: string;
    modelProvider: string | null;
    modelId: string | null;
    meta: Record<string, unknown> | null;
    generationId: string | null;
  }>
): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.fileUrl !== undefined) update.fileUrl = patch.fileUrl;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.prompt !== undefined) update.prompt = patch.prompt;
  if (patch.modelProvider !== undefined)
    update.modelProvider = patch.modelProvider;
  if (patch.modelId !== undefined) update.modelId = patch.modelId;
  if (patch.meta !== undefined)
    update.meta = patch.meta ? JSON.stringify(patch.meta) : null;
  if (patch.generationId !== undefined)
    update.generationId = patch.generationId;
  await db.update(shotAssets).set(update).where(eq(shotAssets.id, assetId));
}

/** Restore a specific historical version: flips its is_active to 1 and deactivates the rest. */
export async function activateAssetVersion(
  shotId: string,
  type: ShotAssetType,
  sequenceInType: number,
  assetVersion: number
): Promise<void> {
  const slotRows = await db
    .select()
    .from(shotAssets)
    .where(
      and(
        eq(shotAssets.shotId, shotId),
        eq(shotAssets.type, type),
        eq(shotAssets.sequenceInType, sequenceInType)
      )
    );
  for (const row of slotRows) {
    await db
      .update(shotAssets)
      .set({
        isActive: row.assetVersion === assetVersion ? 1 : 0,
        updatedAt: new Date(),
      })
      .where(eq(shotAssets.id, row.id));
  }
}

/** Hard-delete all assets of a given type for a shot (used when wiping a mode's data). */
export async function deleteAssetsByType(
  shotId: string,
  type: ShotAssetType
): Promise<void> {
  await db
    .delete(shotAssets)
    .where(and(eq(shotAssets.shotId, shotId), eq(shotAssets.type, type)));
}

/**
 * Legacy-shaped view of a single shot's currently-active assets. Used by code
 * that was previously reading the legacy columns on the shots table
 * (firstFrame, lastFrame, videoUrl, referenceVideoUrl, sceneRefFrame, etc.)
 * — return shape matches those column names so consumers can swap with
 * minimal diff.
 *
 * Single query loads all active assets for the shot.
 */
export interface ShotLegacyView {
  firstFrame: string | null;
  lastFrame: string | null;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  videoUrl: string | null;
  referenceVideoUrl: string | null;
  sceneRefFrame: string | null;
  /** All active reference image assets, ordered by sequence_in_type */
  referenceImages: ShotAssetRow[];
  /** 4-grid panel image URLs (index 0–3, null if not present) */
  panels: [string | null, string | null, string | null, string | null];
}

export async function loadShotLegacyView(shotId: string): Promise<ShotLegacyView> {
  const rows = await db
    .select()
    .from(shotAssets)
    .where(
      and(eq(shotAssets.shotId, shotId), eq(shotAssets.isActive, 1))
    )
    .orderBy(shotAssets.type, shotAssets.sequenceInType);
  const all = rows.map(rowToAsset);

  const firstFrameAsset = all.find(
    (a) => a.type === "first_frame" && a.sequenceInType === 0
  );
  const lastFrameAsset = all.find(
    (a) => a.type === "last_frame" && a.sequenceInType === 0
  );
  const keyframeVideoAsset = all.find(
    (a) => a.type === "keyframe_video" && a.sequenceInType === 0
  );
  const referenceVideoAsset = all.find(
    (a) => a.type === "reference_video" && a.sequenceInType === 0
  );
  const referenceImages = all
    .filter((a) => a.type === "reference")
    .sort((a, b) => a.sequenceInType - b.sequenceInType);

  // The "scene ref frame" was historically a single image used as the primary
  // reference anchor — map it to the first reference asset (sequence_in_type=0).
  const sceneRefAsset = referenceImages[0];

  const panelAssets = [1, 2, 3, 4].map((i) =>
    all.find((a) => a.type === `panel_${i}` as ShotAssetType && a.sequenceInType === 0)
  );

  return {
    firstFrame: firstFrameAsset?.fileUrl ?? null,
    lastFrame: lastFrameAsset?.fileUrl ?? null,
    startFrameDesc: firstFrameAsset?.prompt ?? panelAssets[0]?.prompt ?? null,
    endFrameDesc: lastFrameAsset?.prompt ?? panelAssets[3]?.prompt ?? null,
    videoUrl: keyframeVideoAsset?.fileUrl ?? null,
    referenceVideoUrl: referenceVideoAsset?.fileUrl ?? null,
    sceneRefFrame: sceneRefAsset?.fileUrl ?? null,
    referenceImages,
    panels: panelAssets.map((a) => a?.fileUrl ?? null) as [string | null, string | null, string | null, string | null],
  };
}

/**
 * Batch version: load legacy views for many shots in a single query, returns
 * a Map keyed by shot id.
 */
export async function loadShotLegacyViewsBatch(
  shotIds: string[]
): Promise<Map<string, ShotLegacyView>> {
  if (shotIds.length === 0) return new Map();
  const { inArray } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(shotAssets)
    .where(
      and(inArray(shotAssets.shotId, shotIds), eq(shotAssets.isActive, 1))
    );
  const byShot = new Map<string, ShotAssetRow[]>();
  for (const row of rows) {
    const a = rowToAsset(row);
    if (!byShot.has(a.shotId)) byShot.set(a.shotId, []);
    byShot.get(a.shotId)!.push(a);
  }
  const result = new Map<string, ShotLegacyView>();
  for (const shotId of shotIds) {
    const all = byShot.get(shotId) ?? [];
    const firstFrameAsset = all.find(
      (a) => a.type === "first_frame" && a.sequenceInType === 0
    );
    const lastFrameAsset = all.find(
      (a) => a.type === "last_frame" && a.sequenceInType === 0
    );
    const keyframeVideoAsset = all.find(
      (a) => a.type === "keyframe_video" && a.sequenceInType === 0
    );
    const referenceVideoAsset = all.find(
      (a) => a.type === "reference_video" && a.sequenceInType === 0
    );
    const referenceImages = all
      .filter((a) => a.type === "reference")
      .sort((a, b) => a.sequenceInType - b.sequenceInType);
    const sceneRefAsset = referenceImages[0];
    const panelAssets = [1, 2, 3, 4].map((i) =>
      all.find((a) => a.type === `panel_${i}` as ShotAssetType && a.sequenceInType === 0)
    );
    result.set(shotId, {
      firstFrame: firstFrameAsset?.fileUrl ?? null,
      lastFrame: lastFrameAsset?.fileUrl ?? null,
      startFrameDesc: firstFrameAsset?.prompt ?? panelAssets[0]?.prompt ?? null,
      endFrameDesc: lastFrameAsset?.prompt ?? panelAssets[3]?.prompt ?? null,
      videoUrl: keyframeVideoAsset?.fileUrl ?? null,
      referenceVideoUrl: referenceVideoAsset?.fileUrl ?? null,
      sceneRefFrame: sceneRefAsset?.fileUrl ?? null,
      referenceImages,
      panels: panelAssets.map((a) => a?.fileUrl ?? null) as [string | null, string | null, string | null, string | null],
    });
  }
  return result;
}
