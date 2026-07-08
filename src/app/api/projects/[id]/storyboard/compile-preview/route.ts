import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, ensureImportStatesTable } from "@/lib/db";
import { assetVariants, assets, importStates } from "@/lib/db/schema";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { getActiveProductionBible } from "@/lib/production-bible";
import { compileStoryboardFrames, type StoryboardProductionBibleInput } from "@/lib/storyboard";

export const maxDuration = 60;

interface CompilePreviewBody {
  locked_shots?: unknown[];
  lockedShots?: unknown[];
  shots?: unknown[];
  assets?: unknown[];
  assetVariants?: unknown[];
  visualAssets?: unknown[];
  productionBible?: unknown;
}

interface StoredShotReview {
  lockedShotIds?: string[];
  shots?: unknown[];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readShotId(value: unknown) {
  const record = toRecord(value);
  return String(record.shot_id || record.shotId || record.id || "").trim();
}

function readEpisodeId(value: unknown) {
  const record = toRecord(value);
  return String(record.episode_id || record.episodeId || "").trim();
}

async function loadProjectAssetInputs(projectId: string) {
  const [assetRows, variantRows] = await Promise.all([
    db
      .select({
        id: assets.id,
        type: assets.type,
        name: assets.name,
        description: assets.description,
        visualConstraints: assets.visualConstraints,
        negativeConstraints: assets.negativeConstraints,
        referenceImage: assets.referenceImage,
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
        state: assetVariants.state,
        lockedTraits: assetVariants.lockedTraits,
        changedTraits: assetVariants.changedTraits,
        visualConstraints: assetVariants.visualConstraints,
        negativeConstraints: assetVariants.negativeConstraints,
        referenceImage: assetVariants.referenceImage,
        status: assetVariants.status,
      })
      .from(assetVariants)
      .where(eq(assetVariants.projectId, projectId))
      .orderBy(asc(assetVariants.assetId), asc(assetVariants.createdAt)),
  ]);

  const visualAssets = [
    ...assetRows
      .filter((asset) => asset.referenceImage)
      .map((asset) => ({
        asset_id: asset.id,
        referenceImage: asset.referenceImage,
        role: "asset_reference",
        status: "active",
      })),
    ...variantRows
      .filter((variant) => variant.referenceImage)
      .map((variant) => ({
        asset_id: variant.assetId,
        variant_id: variant.id,
        referenceImage: variant.referenceImage,
        role: "variant_reference",
        status: variant.status,
      })),
  ];

  return { assetRows, variantRows, visualAssets };
}

async function loadStoredLockedShots(projectId: string) {
  ensureImportStatesTable();
  const [state] = await db
    .select({ shotReview: importStates.shotReview })
    .from(importStates)
    .where(eq(importStates.projectId, projectId));

  const review = toRecord(state?.shotReview) as StoredShotReview;
  const shots = Array.isArray(review.shots) ? review.shots : [];
  const lockedIds = new Set(
    Array.isArray(review.lockedShotIds)
      ? review.lockedShotIds.map((id) => String(id).trim()).filter(Boolean)
      : [],
  );
  if (lockedIds.size === 0) return shots.filter((shot) => toRecord(shot).lock_status === "locked");
  return shots.filter((shot) => lockedIds.has(readShotId(shot)));
}

function normalizeShotInput(body: CompilePreviewBody) {
  if (Array.isArray(body.locked_shots)) return body.locked_shots;
  if (Array.isArray(body.lockedShots)) return body.lockedShots;
  if (Array.isArray(body.shots)) return body.shots;
  return null;
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

  const body = (await request.json().catch(() => ({}))) as CompilePreviewBody;
  const bodyShots = normalizeShotInput(body);
  const lockedShots = bodyShots ?? await loadStoredLockedShots(projectId);
  if (!Array.isArray(lockedShots) || lockedShots.length === 0) {
    return NextResponse.json({ error: "locked_shots is required" }, { status: 400 });
  }

  const firstEpisodeId = lockedShots.map(readEpisodeId).find(Boolean) || null;
  const projectAssets = await loadProjectAssetInputs(projectId);
  const productionBible =
    body.productionBible && typeof body.productionBible === "object"
      ? body.productionBible as StoryboardProductionBibleInput
      : await getActiveProductionBible(projectId, firstEpisodeId);

  const result = compileStoryboardFrames({
    locked_shots: lockedShots,
    assets: Array.isArray(body.assets) ? body.assets : projectAssets.assetRows,
    assetVariants: Array.isArray(body.assetVariants) ? body.assetVariants : projectAssets.variantRows,
    visualAssets: Array.isArray(body.visualAssets) ? body.visualAssets : projectAssets.visualAssets,
    productionBible,
  });

  return NextResponse.json(result);
}
