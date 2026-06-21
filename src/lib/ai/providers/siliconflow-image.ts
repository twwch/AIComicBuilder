import type { AIProvider, ImageOptions } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";

const ASPECT_MAP: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "1664x928",
  "9:16": "928x1664",
  "4:3": "1472x1140",
  "3:4": "1140x1472",
  "3:2": "1584x1056",
  "2:3": "1056x1584",
};

const MAX_DIM = 2048;

export function clampSize(size: string): string {
  const cleaned = size.replace("*", "x");
  const [wStr, hStr] = cleaned.split("x");
  let w = parseInt(wStr, 10);
  let h = parseInt(hStr, 10);
  if (isNaN(w) || isNaN(h)) return "1024x1024";
  if (w <= MAX_DIM && h <= MAX_DIM) return `${w}x${h}`;
  const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  return `${w}x${h}`;
}

export function resolveImageSize(size?: string, aspectRatio?: string): string {
  if (size) return clampSize(size);
  if (aspectRatio) return ASPECT_MAP[aspectRatio] || "1024x1024";
  return "1024x1024";
}

export class SiliconFlowImageProvider implements AIProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.apiKey = params?.apiKey || process.env.SILICONFLOW_API_KEY || "";
    this.baseUrl = (
      params?.baseUrl ||
      process.env.SILICONFLOW_BASE_URL ||
      "https://api.siliconflow.cn/v1"
    ).replace(/\/+$/, "");
    this.model = params?.model || process.env.SILICONFLOW_IMAGE_MODEL || "black-forest-labs/FLUX.1-dev";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(): Promise<string> {
    throw new Error("SiliconFlow image models do not support text generation");
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const model = options?.model || this.model;
    const imageSize = resolveImageSize(options?.size, options?.aspectRatio);

    const body: Record<string, unknown> = {
      model,
      prompt,
      image_size: imageSize,
      batch_size: 1,
    };

    // If reference images exist, pass the first one as image for img2img
    const refs = options?.referenceImages;
    if (refs && refs.length > 0) {
      body.image = this.fileToUrl(refs[0]);
    }

    console.log(`[SiliconFlow] Generating: model=${model}, size=${imageSize}`);

    const res = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`SiliconFlow image request failed: ${res.status} ${errText}`);
    }

    const json = (await res.json()) as {
      images?: Array<{ url?: string }>;
      code?: number;
      message?: string;
    };

    if (json.code) {
      throw new Error(`SiliconFlow error [${json.code}]: ${json.message || "unknown"}`);
    }

    const imageUrl = json.images?.[0]?.url;
    if (!imageUrl) {
      throw new Error(`SiliconFlow: no image in response: ${JSON.stringify(json)}`);
    }

    // Download and save
    const imageRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
    if (!imageRes.ok) {
      throw new Error(`SiliconFlow: download failed (${imageRes.status})`);
    }

    const ext = imageUrl.split("?")[0].split(".").pop() || "png";
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(imageRes.body! as any, createWriteStream(filepath));

    console.log(`[SiliconFlow] Saved: ${filepath}`);
    return filepath;
  }

  private fileToUrl(filePath: string): string {
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
      return filePath;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : "image/webp";
    const data = fs.readFileSync(filePath);
    return `data:${mime};base64,${data.toString("base64")}`;
  }
}
