import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, ensureImportStatesTable } from "@/lib/db";
import { assetVariants, assets, importStates } from "@/lib/db/schema";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import {
  lockReviewedShots,
  type ReviewAsset,
  type ReviewAssetSystem,
  type ReviewAssetType,
  type ReviewAssetVariant,
  type StandardizedShotReview,
} from "@/lib/shot-review-validator";

export const maxDuration = 60;

interface ShotLockBody {
  shot_ids?: unknown[];
  shotIds?: unknown[];
  updated_shots?: unknown[];
  updatedShots?: unknown[];
  shots?: unknown[];
  asset_system?: unknown;
}

interface StoredShotReview {
  version: 1;
  lockedAt: string;
  lockedShotIds: string[];
  shots: StandardizedShotReview[];
  validationSummary?: unknown;
}

function parseAliases(value: string) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeAssetType(value: unknown): ReviewAssetType | null {
  if (value === "character" || value === "scene" || value === "prop") return value;
  return null;
}

function normalizeAsset(value: unknown, fallbackType?: ReviewAssetType): ReviewAsset | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id || record.asset_id || record.assetId || "").trim();
  const name = String(record.name || record.asset_name || record.assetName || "").trim();
  const type = normalizeAssetType(record.type) ?? fallbackType ?? null;
  if (!id || !name || !type) return null;
  const aliases = Array.isArray(record.aliases)
    ? record.aliases.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return { id, type, name, aliases };
}

function normalizeVariant(value: unknown): ReviewAssetVariant | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id || record.variant_id || record.variantId || "").trim();
  const assetId = String(record.assetId || record.asset_id || "").trim();
  const name = String(record.name || record.variant_name || record.variantName || "").trim();
  if (!id || !assetId) return null;
  return {
    id,
    assetId,
    name: name || "base_variant",
    variantType: String(record.variantType || record.variant_type || "").trim(),
    status: String(record.status || "").trim(),
  };
}

function normalizeAssetSystem(value: unknown): ReviewAssetSystem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const flatAssets = Array.isArray(record.assets)
    ? record.assets.map((asset) => normalizeAsset(asset)).filter((asset): asset is ReviewAsset => Boolean(asset))
    : [
        ...(Array.isArray(record.characters) ? record.characters.map((asset) => normalizeAsset(asset, "character")) : []),
        ...(Array.isArray(record.scenes) ? record.scenes.map((asset) => normalizeAsset(asset, "scene")) : []),
        ...(Array.isArray(record.props) ? record.props.map((asset) => normalizeAsset(asset, "prop")) : []),
      ].filter((asset): asset is ReviewAsset => Boolean(asset));
  const variants = Array.isArray(record.variants)
    ? record.variants.map(normalizeVariant).filter((variant): variant is ReviewAssetVariant => Boolean(variant))
    : [];
  if (flatAssets.length === 0) return null;
  return { assets: flatAssets, variants };
}

async function loadProjectReviewAssetSystem(projectId: string): Promise<ReviewAssetSystem> {
  const [assetRows, variantRows] = await Promise.all([
    db
      .select({
        id: assets.id,
        type: assets.type,
        name: assets.name,
        aliases: assets.aliases,
      })
      .from(assets)
      .where(eq(assets.projectId, projectId))
      .orderBy(asc(assets.type), asc(assets.name)),
    db
      .select({
        id: assetVariants.id,
        assetId: assetVariants.assetId,
        name: assetVariants.name,
        variantType: assetVariants.variantType,
        status: assetVariants.status,
      })
      .from(assetVariants)
      .where(eq(assetVariants.projectId, projectId))
      .orderBy(asc(assetVariants.assetId), asc(assetVariants.createdAt)),
  ]);

  return {
    assets: assetRows.map((asset) => ({
      id: asset.id,
      type: asset.type,
      name: asset.name,
      aliases: parseAliases(asset.aliases),
    })),
    variants: variantRows.map((variant) => ({
      id: variant.id,
      assetId: variant.assetId,
      name: variant.name,
      variantType: variant.variantType,
      status: variant.status,
    })),
  };
}

function normalizeIdList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function mergeShotReview(existing: unknown, next: StoredShotReview): StoredShotReview {
  const record = existing && typeof existing === "object" ? existing as Partial<StoredShotReview> : {};
  const previousShots = Array.isArray(record.shots) ? record.shots : [];
  const nextIds = new Set(next.shots.map((shot) => shot.shot_id));
  const mergedShots = [
    ...previousShots.filter((shot) => shot?.shot_id && !nextIds.has(shot.shot_id)),
    ...next.shots,
  ];
  return {
    ...next,
    shots: mergedShots,
    lockedShotIds: Array.from(new Set(mergedShots.map((shot) => shot.shot_id))),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as ShotLockBody;
  const shotIds = normalizeIdList(body.shot_ids ?? body.shotIds);
  const updatedShots = Array.isArray(body.updated_shots)
    ? body.updated_shots
    : Array.isArray(body.updatedShots)
      ? body.updatedShots
      : body.shots;

  if (shotIds.length === 0) {
    return NextResponse.json({ error: "shot_ids is required" }, { status: 400 });
  }
  if (!Array.isArray(updatedShots) || updatedShots.length === 0) {
    return NextResponse.json({ error: "updated_shots is required" }, { status: 400 });
  }

  const assetSystem = normalizeAssetSystem(body.asset_system) ?? await loadProjectReviewAssetSystem(projectId);
  const lockResult = lockReviewedShots({
    shot_ids: shotIds,
    updated_shots: updatedShots,
    asset_system: assetSystem,
  });

  if (lockResult.locked_shot_ids.length > 0) {
    ensureImportStatesTable();
    const [state] = await db
      .select({ shotReview: importStates.shotReview })
      .from(importStates)
      .where(eq(importStates.projectId, projectId));
    const merged = mergeShotReview(state?.shotReview, lockResult.shot_review);

    await db
      .insert(importStates)
      .values({
        projectId,
        shotReview: merged,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: importStates.projectId,
        set: {
          shotReview: merged,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      ...lockResult,
      shot_review: merged,
    });
  }

  return NextResponse.json(lockResult, { status: lockResult.rejected_shot_ids.length > 0 ? 422 : 200 });
}
