import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assetVariants, assets } from "@/lib/db/schema";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { getActiveProductionBible } from "@/lib/production-bible";
import {
  compileStoryboardFrames,
  planStoryboardFramesWithAgent,
  validateStoryboardFramePlanOutput,
  type StoryboardAgentFramePlan,
  type StoryboardAssetInput,
  type StoryboardAssetVariantInput,
  type StoryboardProductionBibleInput,
  type StoryboardVisualAssetInput,
} from "@/lib/storyboard";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";

export const runtime = "nodejs";
export const maxDuration = 180;

interface PlanPreviewBody {
  episode_id?: string;
  episodeId?: string;
  scene_id?: string;
  sceneId?: string;
  scene_summary?: string;
  sceneSummary?: string;
  locked_shots?: unknown[];
  lockedShots?: unknown[];
  assets?: unknown[];
  assetVariants?: unknown[];
  visualAssets?: unknown[];
  productionBible?: unknown;
  modelConfig?: { text?: ProviderConfig | null } | null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function normalizeShotInput(body: PlanPreviewBody) {
  if (Array.isArray(body.locked_shots)) return body.locked_shots;
  if (Array.isArray(body.lockedShots)) return body.lockedShots;
  return [];
}

function readEpisodeIdFromShots(shots: unknown[]) {
  return shots.map((shot) => readString(toRecord(shot), ["episode_id", "episodeId"])).find(Boolean) || "";
}

function readSceneIdFromShots(shots: unknown[]) {
  return shots.map((shot) => readString(toRecord(shot), ["scene_id", "sceneId"])).find(Boolean) || "";
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as PlanPreviewBody;
  const lockedShots = normalizeShotInput(body);
  if (lockedShots.length === 0) {
    return NextResponse.json({ error: "locked_shots is required" }, { status: 400 });
  }

  const episodeId = body.episode_id || body.episodeId || readEpisodeIdFromShots(lockedShots);
  const sceneId = body.scene_id || body.sceneId || readSceneIdFromShots(lockedShots);
  if (!episodeId || !sceneId) {
    return NextResponse.json({ error: "episode_id and scene_id are required" }, { status: 400 });
  }

  const projectAssets = await loadProjectAssetInputs(projectId);
  const assetRows = Array.isArray(body.assets) ? body.assets : projectAssets.assetRows;
  const variantRows = (Array.isArray(body.assetVariants) ? body.assetVariants : projectAssets.variantRows) as StoryboardAssetVariantInput[];
  const visualAssets = (Array.isArray(body.visualAssets) ? body.visualAssets : projectAssets.visualAssets) as StoryboardVisualAssetInput[];
  const productionBible =
    body.productionBible && typeof body.productionBible === "object"
      ? body.productionBible as StoryboardProductionBibleInput
      : await getActiveProductionBible(projectId, episodeId);

  let agentError = "";
  const agentResult = await planStoryboardFramesWithAgent({
    episode_id: episodeId,
    scene_id: sceneId,
    scene_summary: body.scene_summary || body.sceneSummary || "",
    locked_shots: lockedShots,
    assets: assetRows as StoryboardAssetInput[],
    assetVariants: variantRows,
    visualAssets,
    productionBible,
    modelConfig: body.modelConfig,
  }).catch((error) => {
    agentError = error instanceof Error ? error.message : String(error);
    return null;
  });

  if (!agentResult) {
    return NextResponse.json({ error: "Storyboard frame planning failed", detail: agentError }, { status: 502 });
  }

  const planValidation = validateStoryboardFramePlanOutput({
    output: agentResult.output,
    assets: assetRows as StoryboardAssetInput[],
  });

  const plannedShots = agentResult.output.frames.map((frame, index) =>
    framePlanToCompilerShot(frame, {
      index,
      episodeId,
      sceneId,
      lockedShots,
    }),
  );

  const compiled = compileStoryboardFrames({
    locked_shots: plannedShots,
    assets: assetRows,
    assetVariants: variantRows,
    visualAssets,
    productionBible,
  });

  return NextResponse.json({
    storyboard_frames: compiled.storyboard_frames,
    validation: mergeValidation(compiled.validation, planValidation),
    stats: {
      ...compiled.stats,
      agent_used: true,
      agent_model: agentResult.model.modelId,
      plan_errors: planValidation.errors.length,
      plan_warnings: planValidation.warnings.length,
    },
    frame_plan: agentResult.output,
  });
}

function framePlanToCompilerShot(frame: StoryboardAgentFramePlan, context: {
  index: number;
  episodeId: string;
  sceneId: string;
  lockedShots: unknown[];
}) {
  const sourceShot = findSourceShot(frame, context.lockedShots);
  const source = toRecord(sourceShot);
  const shotId = frame.shot_id || readString(source, ["shot_id", "shotId", "id"]) || `shot_${context.index + 1}`;
  return {
    id: shotId,
    shot_id: shotId,
    frame_id: frame.frame_id || `${context.episodeId}_${context.sceneId}_${shotId}_plan_${String(context.index + 1).padStart(2, "0")}`,
    episode_id: frame.episode_id || context.episodeId,
    scene_id: frame.scene_id || context.sceneId,
    preplanned_frame: true,
    static_frame_description: frame.static_frame_description,
    frame_description: frame.static_frame_description,
    action: frame.static_frame_description,
    composition: frame.composition || "",
    camera: {
      shot_type: frame.camera?.shot_type || readString(toRecord(source.camera), ["shot_type", "shotType"]) || readString(source, ["shot_type", "shotType"]),
      angle: frame.camera?.angle || readString(toRecord(source.camera), ["angle"]) || "",
      framing: frame.camera?.framing || frame.composition || readString(toRecord(source.camera), ["framing"]) || "",
      movement: "",
    },
    subject: frame.subject,
    active_assets: frame.active_assets,
    characters: frame.active_assets.characters,
    scene_asset: frame.active_assets.scene,
    props: frame.active_assets.props,
    dialogue: readString(source, ["dialogue", "dialogue_text", "dialogueText"]),
    sound_effect: readString(source, ["sound_effect", "soundEffect", "soundDesign"]),
    duration: readString(source, ["duration"]),
    voiceover: readString(source, ["voiceover", "voiceOver"]),
    lock_status: "locked",
  };
}

function findSourceShot(frame: StoryboardAgentFramePlan, lockedShots: unknown[]) {
  const sourceIds = new Set([frame.shot_id, ...(frame.source_shot_ids ?? [])].filter(Boolean));
  return lockedShots.find((shot) => {
    const record = toRecord(shot);
    const shotId = readString(record, ["shot_id", "shotId", "id"]);
    return sourceIds.has(shotId);
  }) || lockedShots[0];
}

function mergeValidation(
  compiled: ReturnType<typeof compileStoryboardFrames>["validation"],
  plan: ReturnType<typeof validateStoryboardFramePlanOutput>,
) {
  const hasErrors = compiled.errors.length > 0 || plan.errors.length > 0;
  const hasWarnings = compiled.warnings.length > 0 || plan.warnings.length > 0;
  return {
    status: hasErrors ? "invalid" : hasWarnings ? "needs_review" : "valid",
    errors: [...plan.errors, ...compiled.errors],
    warnings: [...plan.warnings, ...compiled.warnings],
    split_suggestions: plan.split_suggestions,
  };
}
