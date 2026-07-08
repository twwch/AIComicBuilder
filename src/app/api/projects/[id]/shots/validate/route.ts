import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assetVariants, assets } from "@/lib/db/schema";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import {
  validateShotReview,
  type ReviewAsset,
  type ReviewAssetSystem,
  type ReviewAssetType,
  type ReviewAssetVariant,
} from "@/lib/shot-review-validator";

export const maxDuration = 60;

interface ShotValidateBody {
  shot_spec?: unknown[];
  shots?: unknown[];
  asset_system?: unknown;
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

export async function loadProjectReviewAssetSystem(projectId: string): Promise<ReviewAssetSystem> {
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as ShotValidateBody;
  const shotSpec = Array.isArray(body.shot_spec) ? body.shot_spec : body.shots;
  if (!Array.isArray(shotSpec) || shotSpec.length === 0) {
    return NextResponse.json({ error: "shot_spec is required" }, { status: 400 });
  }

  const assetSystem = normalizeAssetSystem(body.asset_system) ?? await loadProjectReviewAssetSystem(projectId);
  const result = validateShotReview({
    shot_spec: shotSpec,
    asset_system: assetSystem,
  });

  return NextResponse.json(result);
}
