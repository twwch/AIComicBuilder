import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { ApiKeyPool, splitConfiguredKeys } from "@/lib/ai/key-pool";
import {
  buildAssetImagePrompt,
  buildCompiledAssetProviderPrompt,
  categoryToAssetType,
  defaultAssetStyleSpec,
  defaultAssetVisualSpec,
  type AssetStyleSpec,
  type AssetVisualSpec,
  type AssetVisualSchema,
} from "@/lib/asset-prompt-builder";

export const runtime = "nodejs";
export const maxDuration = 300;

interface EditImageAsset {
  id?: string;
  assetId?: string;
  name?: string;
  category?: string;
  role?: string;
  roleKey?: string;
  visualHint?: string;
  description?: string;
  visualConstraints?: string;
  sceneAssetId?: string;
  visualSchema?: AssetVisualSchema;
  styleSpec?: AssetStyleSpec;
  prompt?: string;
  negativePrompt?: string;
  tags?: string[];
  faceTemplate?: {
    label?: string;
    url?: string;
    note?: string;
  } | null;
}

interface EditImageBody {
  imageUrl?: string;
  editPrompt?: string;
  prompt?: string;
  negativePrompt?: string;
  category?: string;
  size?: string;
  quality?: string;
  targetName?: string;
  targetType?: string;
  visualSpec?: AssetVisualSpec;
  styleSpec?: AssetStyleSpec;
  asset?: EditImageAsset;
}

interface EditImagePayload {
  model: string;
  prompt: string;
  image: string;
  n: number;
  size: string;
  quality: string;
  output_format: "png";
  metadata: {
    assetId: string;
    assetName: string;
    targetName: string;
    targetType: string;
    category: string;
    sourceImage: string;
    projectId: string;
    promptBuilder?: string;
    compilerInput?: unknown;
    compilerIR?: unknown;
    sourcePrompt?: string;
    providerPrompt?: string;
    compiledFinalPrompt?: string;
    compiledDisplayPrompt?: string;
    validation?: unknown;
  };
}

const generatedDir = path.join(process.cwd(), "public", "generated", "import-assets");
let imageEditKeyPool: ApiKeyPool | null = null;
let imageEditKeyPoolSignature = "";

type CharacterFaceTemplate = NonNullable<EditImageAsset["faceTemplate"]>;

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

  const body = (await request.json()) as EditImageBody;
  const sourceImage = String(body.imageUrl || "").trim();
  const editPrompt = String(body.editPrompt || "").trim();
  if (!sourceImage) {
    return NextResponse.json({ error: "Missing source image" }, { status: 400 });
  }
  if (!editPrompt) {
    return NextResponse.json({ error: "Missing edit prompt" }, { status: 400 });
  }

  const category = String(body.category || body.asset?.category || "");
  const providerImage = await toProviderImage(sourceImage);
  const isVariantTarget = String(body.targetType || "").startsWith("variant");
  const assetType = categoryToAssetType(category);
  const effectiveFaceTemplate = resolveFaceTemplate(body.asset, category);
  const authoritativePrompt = editPrompt || body.prompt || body.asset?.prompt || "";
  const builtPrompt = buildAssetImagePrompt({
    asset: {
      id: body.asset?.id || body.asset?.assetId || "",
      type: assetType,
      name: body.asset?.name || body.targetName || "asset",
      role: body.asset?.role || "",
      category,
      prompt: body.prompt || body.asset?.prompt || "",
      description: body.asset?.description || "",
      visualHint: body.asset?.visualHint || "",
      visualConstraints: body.asset?.visualConstraints || "",
      negativeConstraints: body.asset?.negativePrompt || body.negativePrompt || "",
      tags: Array.isArray(body.asset?.tags) ? body.asset.tags : [],
      sceneAssetId: body.asset?.sceneAssetId || "",
      visualSchema: body.asset?.visualSchema || null,
      faceTemplate: effectiveFaceTemplate,
    },
    variant: {
      id: "",
      name: body.targetName || "variant",
      variantType: isVariantTarget ? "variant" : "edit",
      state: editPrompt,
      editInstruction: editPrompt,
      visualConstraints: editPrompt,
      negativeConstraints: body.negativePrompt || "",
    },
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
  const anchoredPrompt = buildCompiledAssetProviderPrompt({
    sourcePrompt: authoritativePrompt,
    compiledPrompt: builtPrompt.compiled_final_prompt,
    category,
    targetName: body.targetName || body.asset?.name || "asset",
    mode: isVariantTarget ? "variant" : "edit",
  });
  if (!builtPrompt.validation_report.passed) {
    return NextResponse.json({
      error: "Asset prompt validation failed",
      validation: builtPrompt.validation_report,
      compilerIR: builtPrompt.compiler_ir,
    }, { status: 422 });
  }
  const prompt = [
    isVariantTarget
      ? "Create a reusable asset variant from the source image, not a story scene."
      : "Edit this reusable asset image, not a story scene.",
    "Preserve the same asset identity, facial features, body proportions, layout discipline, and clean asset-sheet purpose unless the authoritative prompt explicitly changes a visual trait.",
    "The written prompt controls the target profession, world style, clothing, props, material state, and variant state; do not fall back to generic studio fashion or unrelated clean catalog imagery.",
    enforceCharacterIdentityPrompt(category, effectiveFaceTemplate),
    anchoredPrompt,
  ].filter(Boolean).join("\n\n");

  const payload: EditImagePayload = {
    model: getEditImageModel(),
    prompt: mergePromptWithNegative(prompt, builtPrompt.compiled_negative_prompt || defaultNegativePrompt(category)),
    image: providerImage,
    n: 1,
    size: normalizeImageSize(String(body.size || sizeForCategory(category))),
    quality: String(body.quality || process.env.JIMAPI_IMAGE_QUALITY || "high"),
    output_format: "png",
    metadata: {
      assetId: body.asset?.id || body.asset?.assetId || "",
      assetName: body.asset?.name || "",
      targetName: body.targetName || body.asset?.name || "",
      targetType: body.targetType || "variant-edit",
      category,
      sourceImage,
      projectId,
      promptBuilder: "asset_prompt_compiler_v2",
      compilerInput: builtPrompt.compiler_input,
      compilerIR: builtPrompt.compiler_ir,
      sourcePrompt: authoritativePrompt,
      providerPrompt: prompt,
      compiledFinalPrompt: builtPrompt.compiled_final_prompt,
      compiledDisplayPrompt: builtPrompt.compiled_display_prompt,
      validation: builtPrompt.validation_report,
    },
  };

  const result = await callImageEdit(payload);
  const resultRecord = result as Record<string, unknown>;
  const status = String(resultRecord.status || "");
  const imageUrl = typeof resultRecord.imageUrl === "string" ? resultRecord.imageUrl : "";
  if (status !== "succeeded" || !imageUrl) {
    const message = String(resultRecord.error || resultRecord.message || "image edit failed");
    return NextResponse.json({ ...result, error: message }, { status: 400 });
  }

  return NextResponse.json(result);
}

async function callImageEdit(payload: EditImagePayload) {
  const endpoint = getEditImageEndpoint();
  const keyPool = getImageKeyPool();
  if (!endpoint || !keyPool) {
    return {
      provider: "jimapi:image-edit",
      status: "error",
      request: payload,
      error: "Image edit endpoint or API key is not configured.",
    };
  }

  try {
    return await keyPool.withKey(async (entry) => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Number(process.env.IMAGE_EDIT_TIMEOUT_MS || process.env.IMAGE2_TIMEOUT_MS || 300000),
      );
      const startedAt = Date.now();

      try {
        const formData = await buildMultipartPayload(payload);
        const response = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${entry.apiKey}`,
          },
          body: formData,
        });

        const text = await response.text();
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { raw: text };
        }

        if (!response.ok) {
          const error = getProviderError(json) || `image edit returned HTTP ${response.status}`;
          console.warn(`[ImageEdit] Provider error after ${Date.now() - startedAt}ms: ${error}`);
          if (response.status === 429) throw new Error(error);
          return {
            provider: "jimapi:image-edit",
            status: "error",
            request: payload,
            error,
            raw: sanitizeProviderRaw(json),
          };
        }

        const extracted = await extractImageResult(json, payload);
        console.log(`[ImageEdit] Succeeded in ${Date.now() - startedAt}ms; cached=${Boolean(extracted.savedPath)}`);
        return {
          provider: "jimapi:image-edit",
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
    return {
      provider: "jimapi:image-edit",
      status: "error",
      request: payload,
      error: error instanceof Error && error.name === "AbortError"
        ? `image edit exceeded ${process.env.IMAGE_EDIT_TIMEOUT_MS || process.env.IMAGE2_TIMEOUT_MS || 300000}ms and was aborted.`
        : error instanceof Error ? error.message : "image edit request failed",
    };
  }
}

function getEditImageEndpoint() {
  if (process.env.JIMAPI_IMAGE_EDIT_ENDPOINT) return process.env.JIMAPI_IMAGE_EDIT_ENDPOINT;
  if (process.env.IMAGE_EDIT_ENDPOINT) return process.env.IMAGE_EDIT_ENDPOINT;
  const base = (process.env.JIMAPI_BASE_URL || "https://www.jimapi.com/v1").replace(/\/+$/, "");
  return `${base}/images/edits`;
}

function getImageKeyPool() {
  const hasPoolKeys = Boolean(process.env.JIMAPI_API_KEYS || process.env.IMAGE_EDIT_API_KEYS || process.env.IMAGE2_API_KEYS);
  const entries = splitConfiguredKeys({
    apiKey: hasPoolKeys ? "" : process.env.JIMAPI_API_KEY || process.env.IMAGE_EDIT_API_KEY || process.env.IMAGE2_API_KEY || "",
    apiKeysEnv: ["JIMAPI_API_KEYS", "IMAGE_EDIT_API_KEYS", "IMAGE2_API_KEYS"],
    labelPrefix: "jimapi:image-edit",
  });
  if (entries.length === 0) return null;

  const signature = entries.map((entry) => entry.apiKey).join("|");
  if (!imageEditKeyPool || imageEditKeyPoolSignature !== signature) {
    imageEditKeyPool = new ApiKeyPool(entries);
    imageEditKeyPoolSignature = signature;
    console.log(`[ImageKeyPool] jimapi:image-edit loaded ${entries.length} API keys`);
  }

  return imageEditKeyPool;
}

function getEditImageModel() {
  return "gpt-image-2";
}

async function buildMultipartPayload(payload: EditImagePayload) {
  const formData = new FormData();
  formData.append("model", payload.model);
  formData.append("prompt", payload.prompt);
  formData.append("n", String(payload.n));
  formData.append("size", payload.size);
  formData.append("quality", payload.quality);
  formData.append("output_format", payload.output_format);

  const image = await imageBlobFromProviderImage(payload.image, payload.metadata.assetName || payload.metadata.targetName);
  formData.append("image", image.blob, image.filename);
  return formData;
}

async function imageBlobFromProviderImage(image: string, filenameBase: string) {
  if (image.startsWith("data:image/")) {
    const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid data image");
    const buffer = Buffer.from(match[2], "base64");
    return {
      blob: new Blob([buffer], { type: match[1] }),
      filename: `${slugify(filenameBase || "source")}.${extensionFromMime(match[1])}`,
    };
  }

  const response = await fetch(image);
  if (!response.ok) throw new Error(`Failed to load source image: ${response.status}`);
  const contentType = response.headers.get("content-type") || "image/png";
  return {
    blob: await response.blob(),
    filename: `${slugify(filenameBase || "source")}.${extensionFromMime(contentType)}`,
  };
}

async function toProviderImage(imageUrl: string) {
  if (imageUrl.startsWith("data:image/") || /^https?:\/\//i.test(imageUrl)) return imageUrl;
  const normalized = imageUrl.replace(/\\/g, "/");
  let localPath = "";
  if (normalized.startsWith("/generated/")) {
    localPath = path.join(process.cwd(), "public", normalized);
  } else if (normalized.startsWith("/templates/")) {
    localPath = path.join(process.cwd(), "public", normalized);
  } else if (normalized.startsWith("/api/uploads/")) {
    localPath = path.join(process.cwd(), "uploads", normalized.replace(/^\/api\/uploads\//, ""));
  } else if (normalized.includes("/uploads/")) {
    localPath = normalized.replace(/^.*?uploads\//, path.join(process.cwd(), "uploads", path.sep));
  } else if (path.isAbsolute(imageUrl)) {
    localPath = imageUrl;
  }

  if (!localPath) return imageUrl;
  const buffer = await fs.readFile(localPath);
  const mimeType = mimeTypeFor(localPath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function mimeTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  return "image/png";
}

function extensionFromMime(mimeType: string) {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("bmp")) return "bmp";
  return "png";
}

async function extractImageResult(json: unknown, payload: EditImagePayload) {
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
    payload.metadata.assetName || payload.metadata.assetId || payload.metadata.targetName || "asset-edit",
  );
  const filename = `${Date.now()}_${safeAsset}_edit.png`;
  const outputPath = path.join(generatedDir, filename);
  await fs.writeFile(outputPath, buffer);
  return {
    imageUrl: `/generated/import-assets/${filename}`,
    savedPath: outputPath,
  };
}

async function saveRemoteImage(imageUrl: string, payload: EditImagePayload) {
  if (!/^https?:\/\//i.test(imageUrl)) return null;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    const ext = imageExtensionFrom(contentType, imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(generatedDir, { recursive: true });
    const safeAsset = slugify(
      payload.metadata.assetName || payload.metadata.assetId || payload.metadata.targetName || "asset-edit",
    );
    const filename = `${Date.now()}_${safeAsset}_edit.${ext}`;
    const outputPath = path.join(generatedDir, filename);
    await fs.writeFile(outputPath, buffer);
    return {
      imageUrl: `/generated/import-assets/${filename}`,
      savedPath: outputPath,
    };
  } catch (err) {
    console.warn("[ImageEdit] Failed to cache remote image locally:", err instanceof Error ? err.message : err);
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
    if (key === "b64_json" || key === "image_base64" || key === "base64" || key === "image") return "[base64 omitted]";
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

function resolveFaceTemplate(asset: EditImageAsset | undefined, category: string): CharacterFaceTemplate | null {
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

function enforceCharacterIdentityPrompt(category: string, faceTemplate: CharacterFaceTemplate | null) {
  if (category !== "characters") return "";
  const templateText = faceTemplate
    ? [
        `Face reference template: ${faceTemplate.label || "character template"} (${faceTemplate.url || ""}).`,
        faceTemplate.note || "",
      ].filter(Boolean).join(" ")
    : "Keep the same character identity across the main image and every variant.";
  return [
    "STRICT CHARACTER IDENTITY LOCK:",
    templateText,
    "The face shape, facial features, eyebrow-eye-nose-lip proportions, facial bone structure, gender, age impression, and recognizability must stay exactly consistent with the template/reference. Variants and edits may only change hairstyle, clothing, makeup intensity, expression, pose, and story state.",
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

function defaultNegativePrompt(category: string) {
  const common = "subtitles, text, logo, watermark, UI, low resolution, deformation, extra limbs, wrong perspective";
  if (category === "props") return `${common}, people, hands, background environment`;
  if (category === "scenes") return `${common}, people, silhouettes, pedestrians, unrelated modern objects`;
  return `${common}, multiple people, duplicate character, distorted face, inconsistent outfit`;
}

function slugify(value: string) {
  return String(value || "asset")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "asset";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
