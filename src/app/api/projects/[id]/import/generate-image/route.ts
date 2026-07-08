import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { ApiKeyPool, splitConfiguredKeys } from "@/lib/ai/key-pool";
import { getImage2Model } from "@/lib/image2-generation";
import {
  patchStoryAsset,
  upsertStoryAsset,
  type ImportAssetDraft,
  type StoryAssetType,
} from "@/lib/story-assets";
import {
  buildAssetImagePrompt,
  buildCompiledAssetProviderPrompt,
  categoryToAssetType,
  defaultAssetStyleSpec,
  defaultAssetVisualSpec,
  type AssetPromptVariant,
  type AssetStyleSpec,
  type AssetVisualSpec,
  type AssetVisualSchema,
} from "@/lib/asset-prompt-builder";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 300;

type AssetCategory = "characters" | "props" | "scenes" | "voices" | string;

interface GenerateImageAsset {
  id?: string;
  assetId?: string;
  name?: string;
  aliases?: string[] | string;
  frequency?: number;
  category?: string;
  role?: string;
  roleKey?: string;
  scope?: "main" | "guest";
  episodes?: string[];
  visualHint?: string;
  description?: string;
  visualConstraints?: string;
  confirmed?: boolean;
  sceneAssetId?: string;
  visualSchema?: AssetVisualSchema;
  styleSpec?: AssetStyleSpec;
  prompt?: string;
  negativePrompt?: string;
  variants?: unknown[];
  history?: unknown[];
  mainImageName?: string;
  tags?: string[];
  faceTemplate?: {
    label?: string;
    url?: string;
    note?: string;
  } | null;
}

interface ProviderPayload {
  model: string;
  prompt: string;
  n: number;
  size: string;
  quality: string;
  output_format: "png";
  background: "opaque";
  metadata: {
    assetId: string;
    assetName: string;
    targetName: string;
    targetType: string;
    category: string;
    referenceImages: string[];
    projectId: string;
    promptBuilder?: string;
    compilerInput?: unknown;
    compilerIR?: unknown;
    compiledFinalPrompt?: string;
    compiledDisplayPrompt?: string;
    validation?: unknown;
    negativePrompt?: string;
    sourcePrompt?: string;
    providerPrompt?: string;
  };
}

interface GenerateImageBody {
  prompt?: string;
  negativePrompt?: string;
  category?: AssetCategory;
  size?: string;
  quality?: string;
  targetName?: string;
  targetType?: string;
  referenceImages?: string[];
  visualSpec?: AssetVisualSpec;
  styleSpec?: AssetStyleSpec;
  variant?: AssetPromptVariant;
  asset?: GenerateImageAsset;
}

const generatedDir = path.join(process.cwd(), "public", "generated");
let imageKeyPool: ApiKeyPool | null = null;
let imageKeyPoolSignature = "";

type CharacterFaceTemplate = NonNullable<GenerateImageAsset["faceTemplate"]>;

const CHARACTER_FACE_TEMPLATES: Record<string, CharacterFaceTemplate> = {
  maleLead: {
    label: "男主角真人模板",
    url: "/templates/male-lead-template.jpg",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态。",
  },
  femaleLead: {
    label: "女主角真人模板",
    url: "/templates/female-lead-template.png",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态。",
  },
  maleSupport: {
    label: "男配角真人模板",
    url: "/templates/male-support-template.png",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态。",
  },
  femaleSupport: {
    label: "女配角真人模板",
    url: "/templates/female-support-template.png",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态。",
  },
};

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

  const body = (await request.json()) as GenerateImageBody;
  const category = String(body.category || body.asset?.category || "");
  const assetType = categoryToAssetType(category);
  const effectiveFaceTemplate = resolveFaceTemplate(body.asset, category);
  const authoritativePrompt = String(body.prompt || body.asset?.prompt || "").trim();
  const builtPrompt = buildAssetImagePrompt({
    asset: {
      id: body.asset?.id || body.asset?.assetId || "",
      type: assetType,
      name: body.asset?.name || body.targetName || "asset",
      role: body.asset?.role || "",
      category,
      prompt: authoritativePrompt,
      description: body.asset?.description || "",
      visualHint: body.asset?.visualHint || "",
      visualConstraints: body.asset?.visualConstraints || "",
      negativeConstraints: body.asset?.negativePrompt || body.negativePrompt || "",
      tags: Array.isArray(body.asset?.tags) ? body.asset.tags : [],
      sceneAssetId: body.asset?.sceneAssetId || "",
      visualSchema: body.asset?.visualSchema || null,
      faceTemplate: effectiveFaceTemplate,
    },
    variant: body.variant || null,
    visualSpec: {
      ...defaultAssetVisualSpec(assetType, String(body.size || sizeForCategory(category))),
      ...(body.visualSpec || {}),
    },
    styleSpec: {
      ...defaultAssetStyleSpec(),
      ...(body.asset?.styleSpec || {}),
      ...(body.styleSpec || {}),
    },
  });
  const providerPrompt = buildCompiledAssetProviderPrompt({
    sourcePrompt: authoritativePrompt,
    compiledPrompt: builtPrompt.compiled_final_prompt,
    category,
    targetName: body.targetName || body.asset?.name || "asset",
    mode: "main",
  });

  if (!builtPrompt.compiled_final_prompt.trim()) {
    return NextResponse.json({ error: "Missing image prompt" }, { status: 400 });
  }
  if (!builtPrompt.validation_report.passed) {
    return NextResponse.json({
      error: "Asset prompt validation failed",
      validation: builtPrompt.validation_report,
      compilerIR: builtPrompt.compiler_ir,
    }, { status: 422 });
  }

  const referenceImages = [
    ...(Array.isArray(body.referenceImages) ? body.referenceImages : []),
    ...(effectiveFaceTemplate?.url ? [effectiveFaceTemplate.url] : []),
  ].filter((url): url is string => Boolean(url));

  const payload: ProviderPayload = {
    model: getImageModel(),
    prompt: mergePromptWithNegative(
      enforceCharacterIdentityPrompt(providerPrompt, category, effectiveFaceTemplate),
      builtPrompt.compiled_negative_prompt || defaultNegativePrompt(category),
    ),
    n: 1,
    size: normalizeImageSize(String(body.size || sizeForCategory(category))),
    quality: String(body.quality || process.env.JIMAPI_IMAGE_QUALITY || "high"),
    output_format: "png",
    background: "opaque",
    metadata: {
      assetId: body.asset?.id || body.asset?.assetId || "",
      assetName: body.asset?.name || "",
      targetName: body.targetName || body.asset?.name || "",
      targetType: body.targetType || "main",
      category,
      referenceImages,
      projectId,
      promptBuilder: "asset_prompt_compiler_v2",
      compilerInput: builtPrompt.compiler_input,
      compilerIR: builtPrompt.compiler_ir,
      sourcePrompt: authoritativePrompt,
      providerPrompt,
      compiledFinalPrompt: builtPrompt.compiled_final_prompt,
      compiledDisplayPrompt: builtPrompt.compiled_display_prompt,
      validation: builtPrompt.validation_report,
      negativePrompt: builtPrompt.compiled_negative_prompt,
    },
  };

  const result = await callImage2(payload);
  const resultRecord = result as Record<string, unknown>;
  const status = String(resultRecord.status || "");
  const imageUrl = typeof resultRecord.imageUrl === "string" ? resultRecord.imageUrl : "";
  if (status !== "succeeded" || !imageUrl) {
    const message = String(resultRecord.error || resultRecord.message || "image2 generation failed");
    return NextResponse.json({ ...result, error: message }, { status: 400 });
  }

  const dbAssetId = body.asset?.id || body.asset?.assetId || "";
  if (dbAssetId && imageUrl && body.targetType !== "variant") {
    const generatedImageMetadata = {
      provider: result.provider,
      status: result.status,
      targetName: payload.metadata.targetName,
      category: payload.metadata.category,
      promptBuilder: "asset_prompt_compiler_v2",
      compilerInput: builtPrompt.compiler_input,
      compilerIR: builtPrompt.compiler_ir,
      sourcePrompt: authoritativePrompt,
      providerPrompt,
      compiledFinalPrompt: builtPrompt.compiled_final_prompt,
      compiledDisplayPrompt: builtPrompt.compiled_display_prompt,
      validation: builtPrompt.validation_report,
      negativePrompt: builtPrompt.compiled_negative_prompt,
      updatedAt: new Date().toISOString(),
    };
    const patchedAsset = await patchStoryAsset(projectId, dbAssetId, {
      referenceImage: imageUrl,
      metadata: {
        generatedFromImportImage: generatedImageMetadata,
      },
    });
    if (!patchedAsset) {
      await upsertStoryAsset(projectId, toStoryAssetType(assetType), buildGeneratedAssetDraft({
        asset: body.asset,
        category,
        targetName: body.targetName,
        imageUrl,
        prompt: authoritativePrompt,
        negativePrompt: builtPrompt.compiled_negative_prompt || body.asset?.negativePrompt || body.negativePrompt || "",
        faceTemplate: effectiveFaceTemplate,
        promptMetadata: generatedImageMetadata,
        styleSpec: {
          ...defaultAssetStyleSpec(),
          ...(body.asset?.styleSpec || {}),
          ...(body.styleSpec || {}),
        },
      }));
    }
  } else if (imageUrl && body.targetType !== "variant") {
    await upsertStoryAsset(projectId, toStoryAssetType(assetType), buildGeneratedAssetDraft({
      asset: body.asset,
      category,
      targetName: body.targetName,
      imageUrl,
      prompt: authoritativePrompt,
      negativePrompt: builtPrompt.compiled_negative_prompt || body.asset?.negativePrompt || body.negativePrompt || "",
      faceTemplate: effectiveFaceTemplate,
      promptMetadata: {
        provider: result.provider,
        status: result.status,
        targetName: payload.metadata.targetName,
        category: payload.metadata.category,
        promptBuilder: "asset_prompt_compiler_v2",
        compilerInput: builtPrompt.compiler_input,
        compilerIR: builtPrompt.compiler_ir,
        sourcePrompt: authoritativePrompt,
        providerPrompt,
        compiledFinalPrompt: builtPrompt.compiled_final_prompt,
        compiledDisplayPrompt: builtPrompt.compiled_display_prompt,
        validation: builtPrompt.validation_report,
        negativePrompt: builtPrompt.compiled_negative_prompt,
        updatedAt: new Date().toISOString(),
      },
      styleSpec: {
        ...defaultAssetStyleSpec(),
        ...(body.asset?.styleSpec || {}),
        ...(body.styleSpec || {}),
      },
    }));
  }
  return NextResponse.json(result);
}

function toStoryAssetType(assetType: "character" | "prop" | "scene"): StoryAssetType {
  return assetType;
}

function buildGeneratedAssetDraft(input: {
  asset?: GenerateImageAsset;
  category: string;
  targetName?: string;
  imageUrl: string;
  prompt: string;
  negativePrompt: string;
  faceTemplate: CharacterFaceTemplate | null;
  promptMetadata: unknown;
  styleSpec: AssetStyleSpec;
}): ImportAssetDraft {
  return {
    name: input.asset?.name || input.targetName || "asset",
    aliases: input.asset?.aliases,
    frequency: input.asset?.frequency,
    description: input.asset?.description || input.asset?.visualHint || input.targetName || "",
    visualHint: input.asset?.visualHint || "",
    visualConstraints: input.asset?.visualConstraints || input.prompt,
    confirmed: input.asset?.confirmed ?? true,
    assetId: input.asset?.assetId || input.asset?.id || "",
    category: input.category,
    role: input.asset?.role || "",
    roleKey: input.asset?.roleKey || "",
    scope: input.asset?.scope,
    episodes: input.asset?.episodes || [],
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    variants: input.asset?.variants || [],
    imageUrl: input.imageUrl,
    history: input.asset?.history || [],
    mainImageName: input.asset?.mainImageName || input.targetName || input.asset?.name || "",
    tags: input.asset?.tags || [],
    faceTemplate: input.faceTemplate,
    promptMetadata: input.promptMetadata,
    styleSpec: input.styleSpec,
    visualSchema: input.asset?.visualSchema || null,
  };
}

async function callImage2(payload: ProviderPayload) {
  const endpoint = getImageEndpoint();
  const keyPool = getImageKeyPool();
  if (!endpoint || !keyPool) {
    return {
      provider: "jimapi:image2",
      status: "error",
      request: payload,
      error: "IMAGE2/JimAPI image key is not configured. Please set JIMAPI_API_KEY, JIMAPI_API_KEYS, IMAGE2_API_KEY, or IMAGE2_API_KEYS.",
    };
  }

  try {
    return await keyPool.withKey(async (entry) => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Number(process.env.IMAGE2_TIMEOUT_MS || 300000),
      );
      const startedAt = Date.now();

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${entry.apiKey}`,
          },
          body: JSON.stringify(stripMetadataForProvider(payload)),
        });

        const text = await response.text();
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { raw: text };
        }

        if (!response.ok) {
          const error = getProviderError(json) || `image2 returned HTTP ${response.status}`;
          console.warn(`[Image2] Provider error after ${Date.now() - startedAt}ms: ${error}`);
          if (response.status === 429) throw new Error(error);
          return {
            provider: "jimapi:image2",
            status: "error",
            request: payload,
            error,
            raw: sanitizeProviderRaw(json),
          };
        }

        const extracted = await extractImageResult(json, payload);
        console.log(`[Image2] Succeeded in ${Date.now() - startedAt}ms; cached=${Boolean(extracted.savedPath)}`);
        return {
          provider: "jimapi:image2",
          status: "succeeded",
          request: payload,
          imageUrl: extracted.imageUrl,
          savedPath: extracted.savedPath,
          raw: sanitizeProviderRaw(json),
        };
      } finally {
        clearTimeout(timeout);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "image2 request failed";
    return {
      provider: "jimapi:image2",
      status: "error",
      request: payload,
      error: error instanceof Error && error.name === "AbortError"
        ? `image2 generation exceeded ${process.env.IMAGE2_TIMEOUT_MS || 300000}ms and was aborted.`
        : message,
    };
  }
}

function getImageEndpoint() {
  if (process.env.JIMAPI_IMAGE_ENDPOINT) return process.env.JIMAPI_IMAGE_ENDPOINT;
  if (process.env.IMAGE2_ENDPOINT) return process.env.IMAGE2_ENDPOINT;
  const base = (process.env.JIMAPI_BASE_URL || "https://www.jimapi.com/v1").replace(/\/+$/, "");
  return `${base}/images/generations`;
}

function getImageKeyPool() {
  const hasPoolKeys = Boolean(process.env.JIMAPI_API_KEYS || process.env.IMAGE2_API_KEYS);
  const entries = splitConfiguredKeys({
    apiKey: hasPoolKeys ? "" : process.env.JIMAPI_API_KEY || process.env.IMAGE2_API_KEY || "",
    apiKeysEnv: ["JIMAPI_API_KEYS", "IMAGE2_API_KEYS"],
    labelPrefix: "jimapi:image2",
  });
  if (entries.length === 0) return null;

  const signature = entries.map((entry) => entry.apiKey).join("|");
  if (!imageKeyPool || imageKeyPoolSignature !== signature) {
    imageKeyPool = new ApiKeyPool(entries);
    imageKeyPoolSignature = signature;
    console.log(`[ImageKeyPool] jimapi:image2 loaded ${entries.length} API keys`);
  }

  return imageKeyPool;
}

function getImageModel() {
  return getImage2Model();
}

function stripMetadataForProvider(payload: ProviderPayload) {
  const providerPayload = { ...payload } as Omit<ProviderPayload, "metadata"> & { metadata?: ProviderPayload["metadata"] };
  delete providerPayload.metadata;
  return providerPayload;
}

function getProviderError(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const nestedError = record.error;
  if (typeof nestedError === "string") return nestedError;
  if (nestedError && typeof nestedError === "object") {
    const message = (nestedError as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return typeof record.message === "string" ? record.message : "";
}

function sanitizeProviderRaw(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (key === "b64_json" || key === "image_base64" || key === "base64") return "[base64 omitted]";
    if (typeof item === "string" && item.length > 500) {
      if (/^[A-Za-z0-9+/=]+$/.test(item.slice(0, 80))) return `[base64 omitted: ${item.length} chars]`;
      return `${item.slice(0, 500)}...`;
    }
    return item;
  }));
}

function mergePromptWithNegative(prompt: string, negativePrompt: string) {
  const negative = String(negativePrompt || "").trim();
  if (!negative) return prompt;
  return `${prompt}\n\nNegative prompt: ${negative}`;
}

function resolveFaceTemplate(asset: GenerateImageAsset | undefined, category: string): CharacterFaceTemplate | null {
  if (category !== "characters") return null;
  if (asset?.faceTemplate?.url) return asset.faceTemplate;
  const key = String(asset?.roleKey || "");
  if (CHARACTER_FACE_TEMPLATES[key]) return CHARACTER_FACE_TEMPLATES[key];

  const roleText = `${asset?.role || ""} ${(asset?.tags || []).join(" ")}`;
  if (/男主/.test(roleText)) return CHARACTER_FACE_TEMPLATES.maleLead;
  if (/女主/.test(roleText)) return CHARACTER_FACE_TEMPLATES.femaleLead;
  if (/男配/.test(roleText)) return CHARACTER_FACE_TEMPLATES.maleSupport;
  if (/女配/.test(roleText)) return CHARACTER_FACE_TEMPLATES.femaleSupport;
  if (/主角/.test(roleText) && /男性/.test(roleText)) return CHARACTER_FACE_TEMPLATES.maleLead;
  if (/主角/.test(roleText) && /女性/.test(roleText)) return CHARACTER_FACE_TEMPLATES.femaleLead;
  if (/(配角|反派)/.test(roleText) && /男性/.test(roleText)) return CHARACTER_FACE_TEMPLATES.maleSupport;
  if (/(配角|反派)/.test(roleText) && /女性/.test(roleText)) return CHARACTER_FACE_TEMPLATES.femaleSupport;
  return null;
}

function enforceCharacterIdentityPrompt(
  prompt: string,
  category: string,
  faceTemplate: CharacterFaceTemplate | null,
) {
  if (category !== "characters") return prompt;
  const templateText = faceTemplate
    ? [
        `Face reference template: ${faceTemplate.label || "character template"} (${faceTemplate.url || ""}).`,
        faceTemplate.note || "",
      ].filter(Boolean).join(" ")
    : "Keep the same character identity across the main image and every variant.";
  return [
    prompt,
    "STRICT CHARACTER IDENTITY LOCK:",
    templateText,
    "The face shape, facial features, eyebrow-eye-nose-lip proportions, facial bone structure, gender, age impression, and recognizability must stay exactly consistent with the template/reference. Variants may only change hairstyle, clothing, makeup intensity, expression, pose, and story state.",
    "Use realistic live-action photography style with natural skin texture. Do not use comic, anime, illustration, stylized cartoon, face-swap artifacts, or altered identity.",
  ].join("\n");
}

function normalizeImageSize(size: string) {
  const supported = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
  return supported.has(size) ? size : "1536x1024";
}

function sizeForCategory(category: string) {
  if (category === "characters") return "1536x1024";
  if (category === "props") return "1536x1024";
  if (category === "scenes") return "1536x1024";
  return "1024x1024";
}

async function extractImageResult(json: unknown, payload: ProviderPayload) {
  const directUrl = extractImageUrl(json);
  if (directUrl) {
    const saved = await saveRemoteImage(directUrl, payload);
    if (saved) return saved;
    return { imageUrl: directUrl, savedPath: "" };
  }

  const b64 = extractImageBase64(json);
  if (!b64) return { imageUrl: "", savedPath: "" };

  const cleanB64 = b64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(cleanB64, "base64");
  await fs.mkdir(generatedDir, { recursive: true });
  const safeAsset = slugify(
    payload.metadata.assetName || payload.metadata.assetId || payload.metadata.targetName || "asset",
  );
  const filename = `${Date.now()}_${safeAsset}.png`;
  const outputPath = path.join(generatedDir, filename);
  await fs.writeFile(outputPath, buffer);
  return {
    imageUrl: `/generated/${filename}`,
    savedPath: outputPath,
  };
}

async function saveRemoteImage(imageUrl: string, payload: ProviderPayload) {
  if (!/^https?:\/\//i.test(imageUrl)) return null;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    const ext = imageExtensionFrom(contentType, imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(generatedDir, { recursive: true });
    const safeAsset = slugify(
      payload.metadata.assetName || payload.metadata.assetId || payload.metadata.targetName || "asset",
    );
    const filename = `${Date.now()}_${safeAsset}.${ext}`;
    const outputPath = path.join(generatedDir, filename);
    await fs.writeFile(outputPath, buffer);
    return {
      imageUrl: `/generated/${filename}`,
      savedPath: outputPath,
    };
  } catch (err) {
    console.warn("[Image2] Failed to cache remote image locally:", err instanceof Error ? err.message : err);
    return null;
  }
}

function imageExtensionFrom(contentType: string, imageUrl: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("png")) return "png";
  const ext = imageUrl.split("?")[0].split(".").pop()?.toLowerCase();
  return ext && /^[a-z0-9]+$/.test(ext) ? ext : "png";
}

function extractImageUrl(value: unknown): string {
  const record = asRecord(value);
  const candidates = [
    record.imageUrl,
    record.image_url,
    record.url,
    asRecord(record.output).url,
    asRecord(record.output).image_url,
    asRecord(asArray(record.data)[0]).url,
    asRecord(asArray(record.data)[0]).image_url,
    asRecord(asArray(record.images)[0]).url,
    asRecord(asArray(record.output)[0]).url,
    asRecord(record.result).url,
  ];

  const url = candidates.find((item): item is string => typeof item === "string" && item.length > 0);
  if (!url) return "";
  return url.startsWith("http") || url.startsWith("data:image/") || url.startsWith("/")
    ? url
    : "";
}

function extractImageBase64(value: unknown): string {
  const record = asRecord(value);
  const candidates = [
    record.b64_json,
    record.image_base64,
    record.base64,
    asRecord(asArray(record.data)[0]).b64_json,
    asRecord(asArray(record.data)[0]).image_base64,
    asRecord(asArray(record.images)[0]).b64_json,
    asRecord(asArray(record.images)[0]).base64,
    asRecord(asArray(record.output)[0]).b64_json,
    asRecord(asArray(record.output)[0]).image_base64,
    asRecord(record.result).b64_json,
    asRecord(record.result).image_base64,
  ];

  return candidates.find((item): item is string => typeof item === "string" && item.length > 0) || "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function defaultNegativePrompt(category: string) {
  const common = "subtitles, text, logo, watermark, UI, low resolution, distorted anatomy, extra limbs, wrong perspective";
  if (category === "props") return `${common}, people, hands, background environment, reflected lettering`;
  if (category === "scenes") return `${common}, people, silhouettes, pedestrians, unrelated modern objects`;
  return `${common}, multiple people, duplicate character, distorted facial features, inconsistent costume`;
}

function slugify(value: string) {
  return String(value || "asset")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "asset";
}
