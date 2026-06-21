import OpenAI from "openai";
import { toFile } from "openai";
import type { AIProvider, ImageOptions } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";

const ASPECT_SIZE_MAP: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "4:3": "1536x1024",
  "3:4": "1024x1536",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isQuotaError(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: number }).status;
    if (status === 401 || status === 403 || status === 429) return true;
  }
  return false;
}

function resolveSize(options?: ImageOptions): string {
  if (options?.size && options.size !== "2048x2048") return options.size;
  if (options?.aspectRatio) return ASPECT_SIZE_MAP[options.aspectRatio] || "1536x1024";
  return "1024x1024";
}

export class ASXSImageProvider implements AIProvider {
  private client: OpenAI;
  private model: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.client = new OpenAI({
      apiKey: params?.apiKey || process.env.ASXS_API_KEY || process.env.IMAGEGEN_API_KEY || process.env.OPENAI_API_KEY,
      baseURL: params?.baseUrl || process.env.ASXS_BASE_URL || process.env.IMAGEGEN_BASE_URL || "https://api.asxs.top/v1",
      timeout: 600_000,
      maxRetries: 0,
    });
    this.model = params?.model || process.env.ASXS_IMAGE_MODEL || "gpt-image-2";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(): Promise<string> {
    throw new Error("ASXS image provider does not support text generation");
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const refs = this.collectReferenceImages(options);
    const size = resolveSize(options);
    const quality = options?.quality || "auto";

    console.log(`[ASXSImage] Generating: model=${this.model}, refs=${refs.length}, size=${size}`);

    let lastError: unknown;

    const attemptGeneration = async (params: Record<string, unknown>, label: string): Promise<string | null> => {
      try {
        const resp = await (this.client.images.generate as unknown as (params: Record<string, unknown>) => Promise<{ data: Array<Record<string, unknown>> }>)(params);
        const data = resp.data[0];
        if (data?.b64_json) {
          return this.saveImageBuffer(Buffer.from(data.b64_json as string, "base64"), "png");
        }
        if (data?.url) {
          return await this.fetchImageToFile(data.url as string);
        }
        throw new Error(`No image data returned from ASXS images/generations`);
      } catch (err) {
        lastError = err;
        console.error(`[ASXSImage] ${label} failed: ${toErrorMessage(err)}`);
        return null;
      }
    };

    // Phase 1: with reference_images (if any), up to 2 attempts
    for (let attempt = 1; attempt <= 2; attempt++) {
      const generateParams: Record<string, unknown> = {
        model: this.model, prompt, n: 1, size, quality, response_format: "b64_json",
      };
      if (attempt === 1 && refs.length > 0) {
        const resolvedRefs = await Promise.all(refs.map((r) => this.resolveUploadable(r)));
        generateParams.reference_images = resolvedRefs;
      }
      const result = await attemptGeneration(generateParams, attempt === 1 && refs.length > 0 ? "with refs" : "txt2img");
      if (result) return result;
      if (isQuotaError(lastError)) break;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    // Phase 2: fallback without reference images, up to 3 attempts
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (isQuotaError(lastError)) break;
      const result = await attemptGeneration(
        { model: this.model, prompt, n: 1, size, quality, response_format: "b64_json" },
        `fallback ${attempt}/3`,
      );
      if (result) return result;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }

    throw new Error(`ASXS image generation failed: ${toErrorMessage(lastError)}`);
  }

  private async resolveUploadable(ref: string): Promise<Awaited<ReturnType<typeof toFile>>> {
    if (ref.startsWith("data:")) {
      const matches = ref.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) throw new Error(`Invalid data URI format`);
      return toFile(Buffer.from(matches[2], "base64"), `reference.${this.extFromMime(matches[1])}`, { type: matches[1] });
    }
    if (ref.startsWith("http://") || ref.startsWith("https://")) {
      const resp = await fetch(ref, { signal: AbortSignal.timeout(120_000) });
      if (!resp.ok) {
        throw new Error(`Failed to download image for edit: ${resp.status}`);
      }
      const type = this.normalizeImageMime(resp.headers.get("content-type") || "");
      return toFile(Buffer.from(await resp.arrayBuffer()), `reference.${this.extFromMime(type)}`, { type });
    }
    const resolved = path.resolve(ref);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Reference image not found: ${ref}`);
    }
    const type = this.mimeFromPath(resolved);
    return toFile(fs.createReadStream(resolved), path.basename(resolved), { type });
  }

  private normalizeImageMime(contentType: string): string {
    const type = contentType.split(";")[0]?.trim().toLowerCase();
    return type && type.startsWith("image/") ? type : "image/png";
  }

  private mimeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    return "image/png";
  }

  private extFromMime(mime: string): string {
    if (mime.includes("jpeg")) return "jpg";
    if (mime.includes("webp")) return "webp";
    if (mime.includes("gif")) return "gif";
    return "png";
  }

  private collectReferenceImages(options?: ImageOptions): string[] {
    // Prioritize character references, then editBaseImage/panels fill remaining slots
    const charRefs = (options?.referenceImages ?? []).filter((p): p is string => Boolean(p));
    const extraRefs = [options?.editBaseImage].filter((p): p is string => Boolean(p));
    const refs = [...charRefs, ...extraRefs];
    return Array.from(new Set(refs)).slice(0, 7);
  }

  private saveImageBuffer(buffer: Buffer, ext = "png"): string {
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  private async fetchImageToFile(url: string): Promise<string> {
    const imageResponse = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!imageResponse.ok) {
      const body = await imageResponse.text().catch(() => "");
      throw new Error(`Failed to download ASXS image: ${imageResponse.status} ${body}`);
    }
    const contentType = imageResponse.headers.get("content-type") || "";
    const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(imageResponse.body! as any, createWriteStream(filepath));
    return filepath;
  }
}
