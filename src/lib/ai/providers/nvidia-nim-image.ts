import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";

// ── NIM cosmos text-to-image response types ────────────────────────────────

interface NimImageResponse {
  id?: string;
  requestId?: string;
  task_id?: string;
  status?: string;
  message?: string;
  code?: string;
  // Sync response shapes
  image?: { url?: string; base64?: string } | string;
  output?: { image?: { url?: string; base64?: string } | string };
  data?: Array<{ image?: { url?: string; base64?: string } | string }>;
}

// ── Provider ────────────────────────────────────────────────────────────────

export class NvidiaNimImageProvider implements AIProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;
  private pollIntervalMs: number;
  private maxPolls: number;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
    pollIntervalMs?: number;
    maxPolls?: number;
  }) {
    this.apiKey = params?.apiKey || process.env.NVIDIA_NIM_API_KEY || process.env.NVIDIA_API_KEY || "";
    this.baseUrl = (
      params?.baseUrl ||
      process.env.NVIDIA_NIM_BASE_URL ||
      "https://ai.api.nvidia.com"
    ).replace(/\/+$/, "");
    this.model =
      params?.model ||
      process.env.NVIDIA_NIM_IMAGE_MODEL ||
      "nvidia/cosmos-predict2-2b-text2image";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    this.pollIntervalMs = params?.pollIntervalMs ?? 3_000;
    this.maxPolls = params?.maxPolls ?? 120; // 6 min default
  }

  async generateText(
    _prompt: string,
    _options?: TextOptions,
  ): Promise<string> {
    throw new Error("NvidiaNimImageProvider does not support text generation");
  }

  async generateImage(
    prompt: string,
    options?: ImageOptions,
  ): Promise<string> {
    const model = options?.model || this.model;
    const { width, height } = this.resolveDimensions(
      options?.size,
      options?.aspectRatio,
    );
    const steps = this.resolveSteps(model);
    const guidance = this.resolveGuidance(model);

    const body: Record<string, unknown> = {
      prompt,
      width,
      height,
      num_inference_steps: steps,
      guidance_scale: guidance,
      ...(options?.negativePrompt && { negative_prompt: options.negativePrompt }),
    };

    console.log(
      `[NvidiaNimImage] Generating: model=${model}, ${width}x${height}, steps=${steps}, cfg=${guidance}`,
    );

    const submitRes = await fetch(`${this.baseUrl}/v1/cosmos/${model}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(
        `NvidiaNimImage submit failed: ${submitRes.status} ${errText}`,
      );
    }

    const result = (await submitRes.json()) as NimImageResponse;

    if (result.code) {
      throw new Error(
        `NvidiaNimImage error [${result.code}]: ${result.message ?? "unknown"}`,
      );
    }

    // Sync response
    const image = this.extractImage(result);
    if (image?.url || image?.base64) {
      if (image.base64) {
        return this.saveBase64Image(image.base64);
      }
      return this.downloadImageFromUrl(image.url!);
    }

    // Async: poll
    const requestId = result.id || result.requestId || result.task_id;
    if (!requestId) {
      throw new Error(
        `NvidiaNimImage: no request id in response: ${JSON.stringify(result)}`,
      );
    }

    console.log(`[NvidiaNimImage] Task submitted: ${requestId}`);

    const polled = await this.pollForResult(requestId);
    if (polled.base64) {
      return this.saveBase64Image(polled.base64);
    }
    return this.downloadImageFromUrl(polled.url!);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private resolveDimensions(
    size?: string,
    aspectRatio?: string,
  ): { width: number; height: number } {
    if (size) {
      const [w, h] = size.split(/[x*]/).map((n) => parseInt(n, 10));
      if (w && h) return { width: w, height: h };
    }
    const map: Record<string, [number, number]> = {
      "1:1": [1024, 1024],
      "16:9": [1280, 720],
      "9:16": [720, 1280],
      "4:3": [1024, 768],
      "3:4": [768, 1024],
      "3:2": [1152, 768],
      "2:3": [768, 1152],
      "21:9": [1472, 640],
    };
    const key = aspectRatio ?? "1:1";
    const [w, h] = map[key] ?? [1024, 1024];
    return { width: w, height: h };
  }

  private resolveSteps(model: string): number {
    if (model.toLowerCase().includes("turbo") || model.includes("-2b-")) {
      return 20;
    }
    return 35;
  }

  private resolveGuidance(model: string): number {
    if (model.toLowerCase().includes("turbo") || model.includes("-2b-")) {
      return 3.0;
    }
    return 7.0;
  }

  private extractImage(payload: NimImageResponse): {
    url?: string;
    base64?: string;
  } | null {
    if (typeof payload.image === "string") {
      if (payload.image.startsWith("data:") || payload.image.length > 200) {
        return { base64: payload.image };
      }
      return { url: payload.image };
    }
    if (payload.image && typeof payload.image === "object") {
      if (payload.image.url) return { url: payload.image.url };
      if (payload.image.base64) return { base64: payload.image.base64 };
    }
    if (payload.output?.image) {
      if (typeof payload.output.image === "string") {
        if (
          payload.output.image.startsWith("data:") ||
          payload.output.image.length > 200
        ) {
          return { base64: payload.output.image };
        }
        return { url: payload.output.image };
      }
      if (payload.output.image.url) return { url: payload.output.image.url };
      if (payload.output.image.base64)
        return { base64: payload.output.image.base64 };
    }
    if (Array.isArray(payload.data) && payload.data[0]?.image) {
      const img = payload.data[0].image;
      if (typeof img === "string") return { url: img };
      if (img.url) return { url: img.url };
      if (img.base64) return { base64: img.base64 };
    }
    return null;
  }

  private async pollForResult(
    requestId: string,
  ): Promise<{ url?: string; base64?: string }> {
    const statusBase =
      process.env.NVIDIA_NIM_STATUS_BASE_URL ||
      "https://api.nvcf.nvidia.com/v2/nvcf/pexec/status";

    for (let i = 0; i < this.maxPolls; i++) {
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));

      const res = await fetch(`${statusBase}/${requestId}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        console.warn(
          `[NvidiaNimImage] Poll ${i + 1}: HTTP ${res.status}, retrying…`,
        );
        continue;
      }

      const result = (await res.json()) as NimImageResponse;
      const status = (result.status ?? "").toLowerCase();

      console.log(`[NvidiaNimImage] Poll ${i + 1}: status=${status || "unknown"}`);

      if (
        status === "completed" ||
        status === "complete" ||
        status === "succeeded" ||
        status === "success"
      ) {
        const image = this.extractImage(result);
        if (image?.url || image?.base64) {
          return { url: image.url, base64: image.base64 };
        }
        throw new Error(
          `NvidiaNimImage: completed but no image: ${JSON.stringify(result)}`,
        );
      }

      if (status === "failed" || status === "error" || status === "cancelled") {
        throw new Error(
          `NvidiaNimImage generation failed: ${result.message ?? "unknown"}`,
        );
      }
    }

    throw new Error(
      `NvidiaNimImage generation timed out after ${
        (this.pollIntervalMs * this.maxPolls) / 1000
      }s`,
    );
  }

  private saveBase64Image(b64: string): string {
    const cleaned = b64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleaned, "base64");
    const filename = `${genId()}.png`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    console.log(`[NvidiaNimImage] Saved base64 to ${filepath}`);
    return filepath;
  }

  private async downloadImageFromUrl(url: string): Promise<string> {
    const imageRes = await fetch(url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!imageRes.ok) {
      throw new Error(
        `NvidiaNimImage: failed to download image (${imageRes.status})`,
      );
    }
    const filename = `${genId()}.png`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(imageRes.body! as any, createWriteStream(filepath));
    console.log(`[NvidiaNimImage] Saved to ${filepath}`);
    return filepath;
  }
}
