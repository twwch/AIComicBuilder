import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";

interface SenseNovaImageResponse {
  data?: Array<{
    url?: string;
    b64_json?: string;
  }>;
  error?: {
    message?: string;
  };
  message?: string;
}

const SENSENOVA_SIZE_BY_RATIO: Record<string, string> = {
  "16:9": "3072x1376",
  "9:16": "1344x3136",
  "1:1": "2048x2048",
  "4:3": "2752x1536",
  "3:4": "1536x2752",
};

export function normalizeSenseNovaSize(size?: string, aspectRatio?: string): string {
  if (aspectRatio && SENSENOVA_SIZE_BY_RATIO[aspectRatio]) {
    return SENSENOVA_SIZE_BY_RATIO[aspectRatio];
  }

  switch (size) {
    case "2560x1440":
    case "1792x1024":
    case "1664x936":
      return "3072x1376";
    case "1440x2560":
    case "1024x1792":
    case "936x1664":
      return "1344x3136";
    case "2048x2048":
      return "2048x2048";
    case "1536x2048":
    case "768x1024":
      return "1536x2752";
    case "2048x1536":
    case "1024x768":
      return "2752x1536";
    default:
      return "3072x1376";
  }
}

export function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || "https://token.sensenova.cn/v1").replace(/\/+$/, "");
  return raw.endsWith("/v1") ? raw : `${raw}/v1`;
}

export class SenseNovaImageProvider implements AIProvider {
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
    this.apiKey = params?.apiKey || process.env.OPENAI_API_KEY || "";
    this.baseUrl = normalizeBaseUrl(params?.baseUrl);
    this.model = params?.model || "sensenova-u1-fast";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(_prompt: string, _options?: TextOptions): Promise<string> {
    throw new Error("SenseNova image provider does not support text generation");
  }

  private saveImageBuffer(buffer: Buffer, ext = "png"): string {
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  private async downloadImage(url: string): Promise<string> {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SenseNova image download failed: ${res.status} ${body}`);
    }
    const contentType = res.headers.get("content-type") || "image/png";
    const ext = contentType.includes("jpeg") ? "jpg" : "png";
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(res.body! as any, createWriteStream(filepath));
    return filepath;
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const model = options?.model || this.model;
    const payload: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      size: normalizeSenseNovaSize(options?.size, options?.aspectRatio),
    };

    if (options?.aspectRatio) payload.aspect_ratio = options.aspectRatio;
    if (options?.quality) payload.quality = options.quality;

    const res = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(300_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SenseNova image request failed: ${res.status} ${body}`);
    }

    const json = (await res.json()) as SenseNovaImageResponse;
    if (json.error?.message) {
      throw new Error(`SenseNova image error: ${json.error.message}`);
    }

    const item = json.data?.[0];
    if (!item) {
      throw new Error(`SenseNova image: empty response ${JSON.stringify(json)}`);
    }

    if (item.b64_json) {
      return this.saveImageBuffer(Buffer.from(item.b64_json, "base64"), "png");
    }

    if (item.url) {
      return this.downloadImage(item.url);
    }

    throw new Error(`SenseNova image: no image payload ${JSON.stringify(json)}`);
  }
}
