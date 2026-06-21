import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";

// ── Model family detection ──────────────────────────────────────────────────

export type NimVideoModelFamily = "cosmos-1.0" | "cosmos-predict1" | "cosmos-predict2";

export function getNimVideoModelFamily(model: string): NimVideoModelFamily {
  const m = model.toLowerCase();
  if (m.includes("cosmos-1-0") || m.includes("cosmos-1.0") || m.includes("cosmos1")) {
    return "cosmos-1.0";
  }
  if (m.includes("cosmos-predict1")) {
    return "cosmos-predict1";
  }
  if (m.includes("cosmos-predict2") || m.includes("cosmos-2")) {
    return "cosmos-predict2";
  }
  // Default: assume predict2 (newest public NIM model)
  return "cosmos-predict2";
}

// ── Capability detection ────────────────────────────────────────────────────

export function isVideoToWorld(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("video2world") || m.includes("i2v") || m.includes("v2v");
}

export function isTextToWorld(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("text2world") || m.includes("t2v");
}

// ── Aspect-ratio → resolution mapping ───────────────────────────────────────

const COSMOS_ASPECT_RATIO_MAP: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 1024, height: 1024 },
  "4:3": { width: 1024, height: 768 },
  "3:4": { width: 768, height: 1024 },
  "3:2": { width: 1152, height: 768 },
  "2:3": { width: 768, height: 1152 },
  "21:9": { width: 1472, height: 640 },
};

export function ratioToResolution(
  ratio: string,
  family: NimVideoModelFamily,
): { width: number; height: number } {
  const res = COSMOS_ASPECT_RATIO_MAP[ratio] ?? COSMOS_ASPECT_RATIO_MAP["16:9"];
  if (family === "cosmos-1.0" || family === "cosmos-predict1") {
    return { width: 1024, height: 640 };
  }
  return res;
}

// Convert a local file path to a data: URL; http(s) URLs are returned as-is
export function toImageUrl(imagePathOrUrl: string): string {
  if (imagePathOrUrl.startsWith("http://") || imagePathOrUrl.startsWith("https://")) {
    return imagePathOrUrl;
  }
  const ext = path.extname(imagePathOrUrl).toLowerCase().replace(".", "");
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/png";
  const base64 = fs.readFileSync(imagePathOrUrl, { encoding: "base64" });
  return `data:${mime};base64,${base64}`;
}

// ── NIM response types ──────────────────────────────────────────────────────

interface NimVideoResponse {
  id?: string;
  requestId?: string;
  task_id?: string;
  status?: string;
  message?: string;
  code?: string;
  video?: { url?: string; base64?: string } | string;
  output?: { video?: { url?: string; base64?: string } | string };
  data?: Array<{ video?: { url?: string; base64?: string } | string }>;
}

// ── Provider ────────────────────────────────────────────────────────────────

export class NvidiaNimVideoProvider implements VideoProvider {
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
      process.env.NVIDIA_NIM_VIDEO_MODEL ||
      "nvidia/cosmos-predict2-2b-text2world";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    this.pollIntervalMs = params?.pollIntervalMs ?? 5_000;
    this.maxPolls = params?.maxPolls ?? 360; // 30 min default
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const family = getNimVideoModelFamily(this.model);
    const { width, height } = ratioToResolution(params.ratio, family);
    const numFrames = this.defaultNumFrames(params.duration, family);
    const fps = this.defaultFps(family);

    const body = this.buildBody(params, { width, height, numFrames, fps });

    console.log(
      `[NvidiaNimVideo] Submitting: model=${this.model}, family=${family}, ratio=${params.ratio}, ${width}x${height}@${numFrames}f/${fps}fps`,
    );

    const submitRes = await fetch(this.submitUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(
        `NvidiaNimVideo submit failed: ${submitRes.status} ${errText}`,
      );
    }

    const submitResult = (await submitRes.json()) as NimVideoResponse;

    if (submitResult.code) {
      throw new Error(
        `NvidiaNimVideo submit error [${submitResult.code}]: ${submitResult.message ?? "unknown"}`,
      );
    }

    // Try sync response first (some endpoints return video inline)
    const syncVideo = this.extractVideoUrl(submitResult);
    if (syncVideo && !syncVideo.requiresPolling) {
      if (syncVideo.base64) {
        return { filePath: this.saveBase64Video(syncVideo.base64) };
      }
      if (syncVideo.url) {
        return { filePath: await this.downloadVideoFromUrl(syncVideo.url) };
      }
    }

    // Async: poll NVCF status endpoint
    const requestId =
      submitResult.id || submitResult.requestId || submitResult.task_id;
    if (!requestId) {
      throw new Error(
        `NvidiaNimVideo: no request id in response: ${JSON.stringify(submitResult)}`,
      );
    }

    console.log(`[NvidiaNimVideo] Task submitted: ${requestId}`);

    const result = await this.pollForResult(requestId);
    if (result.base64) {
      return { filePath: this.saveBase64Video(result.base64) };
    }
    if (!result.url) {
      throw new Error("NvidiaNimVideo: completed but no video URL");
    }
    return { filePath: await this.downloadVideoFromUrl(result.url) };
  }

  // ── URL builders ─────────────────────────────────────────────────────────

  private submitUrl(): string {
    // NVIDIA NIM cosmos endpoint: /v1/cosmos/{model-id}
    return `${this.baseUrl}/v1/cosmos/${this.model}`;
  }

  private statusUrl(requestId: string): string {
    // NVCF status endpoint is on a different host than the genai endpoint
    const statusBase =
      process.env.NVIDIA_NIM_STATUS_BASE_URL ||
      "https://api.nvcf.nvidia.com/v2/nvcf/pexec/status";
    return `${statusBase}/${requestId}`;
  }

  // ── Body builder ─────────────────────────────────────────────────────────

  buildBody(
    params: VideoGenerateParams,
    meta: { width: number; height: number; numFrames: number; fps: number },
  ): Record<string, unknown> {
    const { width, height, numFrames, fps } = meta;
    const baseBody: Record<string, unknown> = {
      prompt: params.prompt,
      num_frames: numFrames,
      fps,
      width,
      height,
    };

    if ("firstFrame" in params && params.firstFrame) {
      // Keyframe mode: use firstFrame as conditioning image, lastFrame optional
      baseBody.image = toImageUrl(params.firstFrame);
      if (params.lastFrame) {
        baseBody.last_image = toImageUrl(params.lastFrame);
      }
    } else if ("initialImage" in params && params.initialImage) {
      // Reference / I2V mode
      baseBody.image = toImageUrl(params.initialImage);
    }
    // else: pure T2V — no image field

    return baseBody;
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  private async pollForResult(
    requestId: string,
  ): Promise<{ url?: string; base64?: string }> {
    for (let i = 0; i < this.maxPolls; i++) {
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));

      const res = await fetch(this.statusUrl(requestId), {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        console.warn(
          `[NvidiaNimVideo] Poll ${i + 1}: HTTP ${res.status}, retrying…`,
        );
        continue;
      }

      const result = (await res.json()) as NimVideoResponse;
      const status = (result.status ?? "").toLowerCase();

      console.log(
        `[NvidiaNimVideo] Poll ${i + 1}: status=${status || "unknown"}`,
      );

      if (
        status === "completed" ||
        status === "complete" ||
        status === "succeeded" ||
        status === "success"
      ) {
        const video = this.extractVideoUrl(result);
        if (video?.url || video?.base64) {
          return { url: video.url, base64: video.base64 };
        }
        throw new Error(
          `NvidiaNimVideo: completed but no video in response: ${JSON.stringify(result)}`,
        );
      }

      if (status === "failed" || status === "error" || status === "cancelled") {
        throw new Error(
          `NvidiaNimVideo generation failed: ${result.message ?? "unknown error"}`,
        );
      }

      // pending / running / unknown → keep polling
    }

    throw new Error(
      `NvidiaNimVideo generation timed out after ${
        (this.pollIntervalMs * this.maxPolls) / 1000
      }s`,
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private extractVideoUrl(payload: NimVideoResponse): {
    url?: string;
    base64?: string;
    requiresPolling?: boolean;
  } | null {
    // Direct: video is a string URL
    if (typeof payload.video === "string") {
      if (payload.video.startsWith("data:") || payload.video.length > 200) {
        return { base64: payload.video };
      }
      return { url: payload.video };
    }

    // Nested: video.url or video.base64
    if (payload.video && typeof payload.video === "object") {
      if (payload.video.url) return { url: payload.video.url };
      if (payload.video.base64) return { base64: payload.video.base64 };
    }

    if (payload.output?.video) {
      if (typeof payload.output.video === "string") {
        if (
          payload.output.video.startsWith("data:") ||
          payload.output.video.length > 200
        ) {
          return { base64: payload.output.video };
        }
        return { url: payload.output.video };
      }
      if (payload.output.video.url) return { url: payload.output.video.url };
      if (payload.output.video.base64)
        return { base64: payload.output.video.base64 };
    }

    // Some NIM endpoints return data: [{video: ...}]
    if (Array.isArray(payload.data) && payload.data[0]?.video) {
      const v = payload.data[0].video;
      if (typeof v === "string") return { url: v };
      if (v.url) return { url: v.url };
      if (v.base64) return { base64: v.base64 };
    }

    // Has id but no video — needs polling
    if (payload.id || payload.requestId || payload.task_id) {
      return { requiresPolling: true };
    }

    return null;
  }

  private defaultNumFrames(durationSec: number, family: NimVideoModelFamily): number {
    if (family === "cosmos-1.0" || family === "cosmos-predict1") {
      // Cosmos 1.0 / Predict1: 32 frames fixed for 5s clip
      return 32;
    }
    // Cosmos Predict2: scales with duration
    if (durationSec <= 5) return 32;
    if (durationSec <= 10) return 64;
    return 93;
  }

  private defaultFps(family: NimVideoModelFamily): number {
    if (family === "cosmos-1.0" || family === "cosmos-predict1") {
      return 8;
    }
    return 16;
  }

  // ── Download + save ──────────────────────────────────────────────────────

  private saveBase64Video(b64: string): string {
    const cleaned = b64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleaned, "base64");
    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    console.log(`[NvidiaNimVideo] Saved base64 to ${filepath}`);
    return filepath;
  }

  private async downloadVideoFromUrl(url: string): Promise<string> {
    const videoRes = await fetch(url, {
      signal: AbortSignal.timeout(300_000),
    });
    if (!videoRes.ok) {
      throw new Error(
        `NvidiaNimVideo: failed to download video (${videoRes.status})`,
      );
    }
    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(videoRes.body! as any, createWriteStream(filepath));
    console.log(`[NvidiaNimVideo] Saved to ${filepath}`);
    return filepath;
  }
}
