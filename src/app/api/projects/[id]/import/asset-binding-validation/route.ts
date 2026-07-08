import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import {
  groupFlatAssets,
  validateShotAssetBindings,
  type AssetBindingSystem,
  type BindingAsset,
  type BindingAssetType,
  type FlatBindingAsset,
} from "@/lib/shot-asset-binding-validator";

export const maxDuration = 60;

interface AssetBindingValidationBody {
  shot_spec?: unknown[];
  shots?: unknown[];
  asset_system?: AssetBindingSystem;
  assets?: FlatBindingAsset[];
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

function asAssetType(value: string): BindingAssetType {
  if (value === "character" || value === "scene" || value === "prop") return value;
  return "prop";
}

function normalizeAsset(value: unknown): BindingAsset | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id || record.asset_id || "").trim();
  const name = String(record.name || record.asset_name || "").trim();
  if (!id || !name) return null;
  const aliases = Array.isArray(record.aliases)
    ? record.aliases.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return {
    id,
    name,
    aliases,
    description: String(record.description || "").trim(),
  };
}

function normalizeAssetSystem(value: AssetBindingSystem | undefined): AssetBindingSystem | null {
  if (!value || typeof value !== "object") return null;
  return {
    characters: (Array.isArray(value.characters) ? value.characters : []).map(normalizeAsset).filter((asset): asset is BindingAsset => Boolean(asset)),
    scenes: (Array.isArray(value.scenes) ? value.scenes : []).map(normalizeAsset).filter((asset): asset is BindingAsset => Boolean(asset)),
    props: (Array.isArray(value.props) ? value.props : []).map(normalizeAsset).filter((asset): asset is BindingAsset => Boolean(asset)),
  };
}

async function loadProjectAssetSystem(projectId: string): Promise<AssetBindingSystem> {
  const rows = await db
    .select({
      id: assets.id,
      type: assets.type,
      name: assets.name,
      aliases: assets.aliases,
      description: assets.description,
    })
    .from(assets)
    .where(eq(assets.projectId, projectId))
    .orderBy(asc(assets.type), asc(assets.name));

  return groupFlatAssets(rows.map((asset): FlatBindingAsset => ({
    id: asset.id,
    type: asAssetType(asset.type),
    name: asset.name,
    aliases: parseAliases(asset.aliases),
    description: asset.description,
  })));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as AssetBindingValidationBody;
  const shotSpec = Array.isArray(body.shot_spec) ? body.shot_spec : body.shots;
  if (!Array.isArray(shotSpec) || shotSpec.length === 0) {
    return NextResponse.json({ error: "shot_spec is required" }, { status: 400 });
  }

  const assetSystem =
    normalizeAssetSystem(body.asset_system) ??
    (Array.isArray(body.assets) ? groupFlatAssets(body.assets) : null) ??
    await loadProjectAssetSystem(projectId);

  const result = validateShotAssetBindings({
    shot_spec: shotSpec,
    asset_system: assetSystem,
  });

  return NextResponse.json(result);
}
