import fs from "node:fs/promises";
import path from "node:path";
import { ApiKeyPool, splitConfiguredKeys } from "@/lib/ai/key-pool";

export interface Image2GenerationPayload {
  model?: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: string;
  output_format?: "png";
  background?: "opaque";
  metadata?: Record<string, unknown>;
}

export interface Image2GenerationResult {
  provider: "jimapi:image2";
  status: "succeeded" | "error";
  request: Image2GenerationPayload;
  imageUrl?: string;
  savedPath?: string;
  error?: string;
  raw?: unknown;
}

let imageKeyPool: ApiKeyPool | null = null;
let imageKeyPoolSignature = "";

export function getImage2Model() {
  return process.env.JIMAPI_IMAGE_MODEL || process.env.IMAGE2_MODEL || "gpt-image-2";
}

export function mergePromptWithNegative(prompt: string, negativePrompt?: string | null) {
  const negative = String(negativePrompt || "").trim();
  if (!negative) return prompt;
  return `${prompt}\n\nNegative prompt: ${negative}`;
}

export function normalizeImage2Size(size?: string | null) {
  const supported = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
  return supported.has(String(size || "")) ? String(size) : "1536x1024";
}

export async function callImage2Generation(
  input: Image2GenerationPayload,
  options?: { generatedSubdir?: string },
): Promise<Image2GenerationResult> {
  const payload: Image2GenerationPayload = {
    model: input.model || getImage2Model(),
    prompt: input.prompt,
    n: input.n ?? 1,
    size: normalizeImage2Size(input.size),
    quality: input.quality || process.env.JIMAPI_IMAGE_QUALITY || "high",
    output_format: input.output_format || "png",
    background: input.background || "opaque",
    metadata: input.metadata,
  };
  const endpoint = getImageEndpoint();
  const keyPool = getImageKeyPool();
  if (!endpoint || !keyPool) {
    return {
      provider: "jimapi:image2",
      status: "error",
      request: payload,
      error:
        "IMAGE2/JimAPI image key is not configured. Please set JIMAPI_API_KEY, JIMAPI_API_KEYS, IMAGE2_API_KEY, or IMAGE2_API_KEYS.",
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

        const extracted = await extractImageResult(json, payload, options?.generatedSubdir);
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
      error:
        error instanceof Error && error.name === "AbortError"
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

function stripMetadataForProvider(payload: Image2GenerationPayload) {
  const providerPayload = { ...payload } as Omit<Image2GenerationPayload, "metadata"> & {
    metadata?: Image2GenerationPayload["metadata"];
  };
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
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (key === "b64_json" || key === "image_base64" || key === "base64") return "[base64 omitted]";
      if (typeof item === "string" && item.length > 500) {
        if (/^[A-Za-z0-9+/=]+$/.test(item.slice(0, 80))) return `[base64 omitted: ${item.length} chars]`;
        return `${item.slice(0, 500)}...`;
      }
      return item;
    }),
  );
}

async function extractImageResult(
  json: unknown,
  payload: Image2GenerationPayload,
  generatedSubdir?: string,
) {
  const directUrl = extractImageUrl(json);
  if (directUrl) {
    const saved = await saveRemoteImage(directUrl, payload, generatedSubdir);
    if (saved) return saved;
    return { imageUrl: directUrl, savedPath: "" };
  }

  const b64 = extractImageBase64(json);
  if (!b64) return { imageUrl: "", savedPath: "" };

  const cleanB64 = b64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(cleanB64, "base64");
  const target = generatedTarget(payload, generatedSubdir, "png");
  await fs.mkdir(target.dir, { recursive: true });
  await fs.writeFile(target.outputPath, buffer);
  return {
    imageUrl: target.publicUrl,
    savedPath: target.outputPath,
  };
}

async function saveRemoteImage(
  imageUrl: string,
  payload: Image2GenerationPayload,
  generatedSubdir?: string,
) {
  if (!/^https?:\/\//i.test(imageUrl)) return null;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    const ext = imageExtensionFrom(contentType, imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const target = generatedTarget(payload, generatedSubdir, ext);
    await fs.mkdir(target.dir, { recursive: true });
    await fs.writeFile(target.outputPath, buffer);
    return {
      imageUrl: target.publicUrl,
      savedPath: target.outputPath,
    };
  } catch (err) {
    console.warn("[Image2] Failed to cache remote image locally:", err instanceof Error ? err.message : err);
    return null;
  }
}

function generatedTarget(payload: Image2GenerationPayload, generatedSubdir: string | undefined, ext: string) {
  const safeSubdir = String(generatedSubdir || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => slugify(part))
    .filter(Boolean)
    .join("/");
  const dir = path.join(process.cwd(), "public", "generated", safeSubdir);
  const metadata = (payload.metadata || {}) as Record<string, unknown>;
  const safeName = slugify(
    String(
      metadata.frameId ||
        metadata.shotId ||
        metadata.assetName ||
        metadata.assetId ||
        metadata.targetName ||
        "image",
    ),
  );
  const filename = `${Date.now()}_${safeName}.${ext}`;
  return {
    dir,
    outputPath: path.join(dir, filename),
    publicUrl: `/generated/${safeSubdir ? `${safeSubdir}/` : ""}${filename}`,
  };
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
  return url.startsWith("http") || url.startsWith("data:image/") || url.startsWith("/") ? url : "";
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
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function slugify(value: string) {
  return (
    String(value || "image")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "image"
  );
}
