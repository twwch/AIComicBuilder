import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, shots } from "@/lib/db/schema";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { getActiveAsset, insertAssetVersion, patchAsset } from "@/lib/shot-asset-utils";
import {
  callImage2Generation,
  getImage2Model,
  mergePromptWithNegative,
  normalizeImage2Size,
} from "@/lib/image2-generation";

export const runtime = "nodejs";
export const maxDuration = 300;

interface StoryboardGenerateItem {
  shotId?: string;
  prompt?: string;
  negativePrompt?: string;
  size?: string;
  quality?: string;
  frame?: {
    frame_id?: string;
    positive_prompt?: string;
    negative_prompt?: string;
    active_assets?: unknown;
    subject?: unknown;
    validation?: unknown;
  };
}

interface StoryboardGenerateBody extends StoryboardGenerateItem {
  items?: StoryboardGenerateItem[];
  overwrite?: boolean;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as StoryboardGenerateBody;
  const items = normalizeItems(body);
  if (items.length === 0) {
    return NextResponse.json({ error: "Missing storyboard generation items" }, { status: 400 });
  }
  if (items.length > 24) {
    return NextResponse.json({ error: "Too many storyboard frames in one request; max is 24" }, { status: 400 });
  }

  const shotIds = Array.from(new Set(items.map((item) => item.shotId).filter(Boolean))) as string[];
  const shotRows = shotIds.length
    ? await db
        .select()
        .from(shots)
        .where(and(eq(shots.projectId, projectId), inArray(shots.id, shotIds)))
    : [];
  const shotById = new Map(shotRows.map((shot) => [shot.id, shot]));
  const overwrite = body.overwrite === true;

  const settled = await Promise.allSettled(
    items.map((item) => generateOneStoryboardFrame({
      item,
      projectId,
      shot: item.shotId ? shotById.get(item.shotId) : undefined,
      overwrite,
    })),
  );

  const results = settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      shotId: items[index]?.shotId || "",
      status: "error",
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
  const successCount = results.filter((result) => result.status === "succeeded").length;
  const skippedCount = results.filter((result) => result.status === "skipped").length;
  const errorCount = results.filter((result) => result.status === "error").length;

  return NextResponse.json(
    {
      provider: "jimapi:image2",
      model: getImage2Model(),
      results,
      stats: {
        total: results.length,
        succeeded: successCount,
        skipped: skippedCount,
        failed: errorCount,
      },
    },
    { status: successCount > 0 || skippedCount > 0 ? 200 : 400 },
  );
}

function normalizeItems(body: StoryboardGenerateBody): StoryboardGenerateItem[] {
  if (Array.isArray(body.items) && body.items.length > 0) {
    return body.items
      .map((item) => ({
        ...item,
        shotId: String(item.shotId || "").trim(),
      }))
      .filter((item) => item.shotId);
  }
  const shotId = String(body.shotId || "").trim();
  return shotId ? [{ ...body, shotId }] : [];
}

async function generateOneStoryboardFrame(input: {
  item: StoryboardGenerateItem;
  projectId: string;
  shot: typeof shots.$inferSelect | undefined;
  overwrite: boolean;
}) {
  const { item, projectId, shot, overwrite } = input;
  if (!item.shotId || !shot) {
    return { shotId: item.shotId || "", status: "error", error: "Shot not found" };
  }

  const existing = await getActiveAsset(item.shotId, "first_frame", 0);
  if (existing?.fileUrl && !overwrite) {
    return {
      shotId: item.shotId,
      status: "skipped",
      imageUrl: existing.fileUrl,
      assetId: existing.id,
      reason: "storyboard frame already exists",
    };
  }

  const positivePrompt = normalizeStoryboardPrompt(
    item.prompt ||
      item.frame?.positive_prompt ||
      shot.videoPrompt ||
      shot.prompt ||
      shot.videoScript ||
      shot.motionScript ||
      "",
  );
  if (!positivePrompt.trim()) {
    return { shotId: item.shotId, status: "error", error: "Missing storyboard image prompt" };
  }

  const negativePrompt =
    item.negativePrompt ||
    item.frame?.negative_prompt ||
    defaultStoryboardNegativePrompt();
  const referenceImages = collectReferenceImages(item.frame?.active_assets);
  const frameId = item.frame?.frame_id || `${shot.episodeId || "episode"}_${shot.sceneId || "scene"}_${shot.id}_frame01`;
  const model = getImage2Model();

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, item.shotId));
    if (existing) await patchAsset(existing.id, { status: "generating", prompt: positivePrompt });

    const result = await callImage2Generation(
      {
        model,
        prompt: mergePromptWithNegative(positivePrompt, negativePrompt),
        n: 1,
        size: normalizeImage2Size(item.size || "1536x1024"),
        quality: item.quality || process.env.JIMAPI_IMAGE_QUALITY || "high",
        output_format: "png",
        background: "opaque",
        metadata: {
          projectId,
          episodeId: shot.episodeId,
          sceneId: shot.sceneId,
          shotId: item.shotId,
          frameId,
          promptBuilder: "storyboard_prompt_compiler_v1",
          referenceImages,
          negativePrompt,
          activeAssets: item.frame?.active_assets || null,
          subject: item.frame?.subject || null,
          validation: item.frame?.validation || null,
        },
      },
      { generatedSubdir: "storyboard" },
    );

    if (result.status !== "succeeded" || !result.imageUrl) {
      throw new Error(result.error || "storyboard image generation failed");
    }

    const asset = await insertAssetVersion({
      shotId: item.shotId,
      type: "first_frame",
      sequenceInType: 0,
      prompt: positivePrompt,
      fileUrl: result.imageUrl,
      status: "completed",
      characters: collectCharacterAssetIds(item.frame?.active_assets),
      modelProvider: result.provider,
      modelId: model,
      meta: {
        frame_id: frameId,
        image_role: "storyboard_frame",
        prompt_builder: "storyboard_prompt_compiler_v1",
        positive_prompt: positivePrompt,
        negative_prompt: negativePrompt,
        referenceImages,
        active_assets: item.frame?.active_assets || null,
        subject: item.frame?.subject || null,
        validation: item.frame?.validation || null,
        provider: result.provider,
        model,
        savedPath: result.savedPath || "",
        generatedAt: new Date().toISOString(),
      },
    });

    await db.update(shots).set({ status: "completed" }).where(eq(shots.id, item.shotId));
    return {
      shotId: item.shotId,
      status: "succeeded",
      imageUrl: result.imageUrl,
      assetId: asset.id,
      model,
      provider: result.provider,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "storyboard image generation failed";
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, item.shotId));
    if (existing) await patchAsset(existing.id, { status: "failed" });
    return { shotId: item.shotId, status: "error", error: message };
  }
}

function normalizeStoryboardPrompt(prompt: string) {
  const trimmed = String(prompt || "").trim();
  if (!trimmed) return "";
  if (/Storyboard key frame image|one static still frame|Static frame:/i.test(trimmed)) return trimmed;
  return [
    "Storyboard key frame image, one static still frame, not a video prompt.",
    "",
    "Static frame:",
    trimmed,
    "",
    "Style:",
    "Realistic live-action short-drama storyboard frame, cinematic composition, consistent asset identities.",
    "",
    "Safety constraints:",
    "No subtitles, no UI, no watermark, no explicit gore, no multiple sequential actions.",
  ].join("\n");
}

function defaultStoryboardNegativePrompt() {
  return [
    "text",
    "subtitles",
    "caption",
    "logo",
    "watermark",
    "UI",
    "extra people",
    "duplicate character",
    "inconsistent face",
    "inconsistent costume",
    "unbound character",
    "explicit gore",
    "graphic injury",
    "multiple sequential actions",
    "video timeline",
  ].join(", ");
}

function collectReferenceImages(activeAssets: unknown) {
  const refs: string[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      if (/^(https?:\/\/|\/generated\/|\/api\/uploads\/|\/templates\/)/i.test(value)) refs.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    visit(record.reference_image_url);
    visit(record.referenceImage);
    visit(record.imageUrl);
    visit(record.fileUrl);
    Object.values(record).forEach((item) => {
      if (item && typeof item === "object") visit(item);
    });
  };
  visit(activeAssets);
  return Array.from(new Set(refs)).slice(0, 8);
}

function collectCharacterAssetIds(activeAssets: unknown) {
  const record = activeAssets && typeof activeAssets === "object" ? activeAssets as Record<string, unknown> : {};
  const characters = Array.isArray(record.characters) ? record.characters : [];
  return characters
    .map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>).asset_id || "") : "")
    .filter(Boolean);
}
