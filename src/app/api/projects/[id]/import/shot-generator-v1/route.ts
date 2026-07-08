import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assetVariants, assets } from "@/lib/db/schema";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import {
  generateShotSpecsV1,
  type ShotGeneratorAsset,
  type ShotGeneratorAssetType,
} from "@/lib/shot-generator-v1";

export const maxDuration = 60;

interface ShotGeneratorRequestBody {
  script?: string;
  assets?: ShotGeneratorAsset[];
  productionBible?: unknown;
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

async function loadProjectAssets(projectId: string): Promise<ShotGeneratorAsset[]> {
  const [assetRows, variantRows] = await Promise.all([
    db
      .select({
        id: assets.id,
        type: assets.type,
        name: assets.name,
        aliases: assets.aliases,
        description: assets.description,
      })
      .from(assets)
      .where(eq(assets.projectId, projectId))
      .orderBy(asc(assets.type), asc(assets.name)),
    db
      .select({
        id: assetVariants.id,
        assetId: assetVariants.assetId,
        name: assetVariants.name,
        status: assetVariants.status,
      })
      .from(assetVariants)
      .where(eq(assetVariants.projectId, projectId))
      .orderBy(asc(assetVariants.assetId), asc(assetVariants.status)),
  ]);

  const variantByAssetId = new Map<string, { id: string; name: string }>();
  for (const variant of variantRows) {
    if (variantByAssetId.has(variant.assetId)) continue;
    variantByAssetId.set(variant.assetId, {
      id: variant.id,
      name: variant.name,
    });
  }

  return assetRows.map((asset): ShotGeneratorAsset => {
    const variant = variantByAssetId.get(asset.id);
    return {
      id: asset.id,
      type: asset.type as ShotGeneratorAssetType,
      name: asset.name,
      aliases: parseAliases(asset.aliases),
      description: asset.description,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? null,
    };
  });
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

  const body = (await request.json().catch(() => ({}))) as ShotGeneratorRequestBody;
  const script = String(body.script || project.script || "").trim();
  if (!script) {
    return NextResponse.json({ error: "script is required" }, { status: 400 });
  }

  const projectAssets = body.assets ?? await loadProjectAssets(projectId);
  const result = generateShotSpecsV1({
    script,
    assets: projectAssets,
    productionBible: body.productionBible,
  });

  return NextResponse.json(result);
}
