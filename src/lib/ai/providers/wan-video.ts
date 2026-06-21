import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";

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

// Map ratio string to wan2.6 size string
export function ratioToSize(ratio: string): string {
  const map: Record<string, string> = {
    "16:9": "1280*720",
    "9:16": "720*1280",
    "1:1": "960*960",
    "4:3": "1088*832",
    "3:4": "832*1088",
  };
  return map[ratio] ?? "1280*720";
}

// Normalise ratio to one of the values accepted by wan2.7
export function normaliseRatio(ratio: string): string {
  const supported = ["16:9", "9:16", "1:1", "4:3", "3:4"];
  return supported.includes(ratio) ? ratio : "16:9";
}

export class WanVideoProvider implements VideoProvider {
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
    this.apiKey = params?.apiKey || process.env.WAN_API_KEY || process.env.DASHSCOPE_API_KEY || "";
    this.baseUrl = (
      params?.baseUrl ||
      process.env.WAN_BASE_URL ||
      "https://dashscope.aliyuncs.com/api/v1"
    ).replace(/\/+$/, "");
    this.model = params?.model || process.env.WAN_MODEL || "wan2.1-i2v-plus";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  // Detect whether this instance is running a wan2.7 model
  private get isWan27(): boolean {
    return this.model.startsWith("wan2.7");
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    let body: Record<string, unknown>;

    if ("firstFrame" in params) {
      // ── Keyframe mode ──
      body = this.buildKeyframeBody(
        params as VideoGenerateParams & { firstFrame: string; lastFrame: string }
      );
    } else if (params.initialImage) {
      // ── Reference image mode (initial image, optional extra refs) ──
      body = this.buildReferenceBody(
        params as VideoGenerateParams & { initialImage: string }
      );
    } else {
      // ── Text-to-video mode ──
      body = this.buildTextBody(params);
    }

    console.log(
      `[WanVideo] Submitting task: model=${this.model}, ratio=${params.ratio}`
    );

    const submitRes = await fetch(
      `${this.baseUrl}/services/aigc/video-generation/video-synthesis`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-DashScope-Async": "enable",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(`WanVideo submit failed: ${submitRes.status} ${errText}`);
    }

    const submitResult = (await submitRes.json()) as {
      output?: { task_id?: string };
    };

    const taskId = submitResult.output?.task_id;
    if (!taskId) {
      throw new Error(
        `WanVideo: no task_id in response: ${JSON.stringify(submitResult)}`
      );
    }

    console.log(`[WanVideo] Task submitted: ${taskId}`);

    const videoUrl = await this.pollForResult(taskId);

    // Download and persist video
    const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!videoRes.ok) {
      throw new Error(`WanVideo: failed to download video (${videoRes.status})`);
    }
    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(videoRes.body! as any, createWriteStream(filepath));

    console.log(`[WanVideo] Saved to ${filepath}`);
    return { filePath: filepath };
  }

  // ── Body builders ──────────────────────────────────────────────────────────

  buildKeyframeBody(
    params: VideoGenerateParams & { firstFrame: string; lastFrame: string }
  ): Record<string, unknown> {
    if (this.isWan27) {
      // wan2.7 uses wan2.7-r2v model with media[] array
      return {
        model: "wan2.7-r2v",
        input: {
          prompt: params.prompt,
          media: [
            { type: "first_frame", url: toImageUrl(params.firstFrame) },
            { type: "last_frame", url: toImageUrl(params.lastFrame) },
          ],
        },
        parameters: {
          resolution: "720P",
          ratio: normaliseRatio(params.ratio),
          duration: params.duration || 5,
        },
      };
    }

    // wan2.6 / wan2.1: image-to-video, uses img_url for first frame only
    return {
      model: this.model,
      input: {
        prompt: params.prompt,
        img_url: toImageUrl(params.firstFrame),
      },
      parameters: {
        size: ratioToSize(params.ratio),
        duration: params.duration || 5,
      },
    };
  }

  buildReferenceBody(
    params: VideoGenerateParams & { initialImage: string }
  ): Record<string, unknown> {
    if (this.isWan27) {
      // wan2.7: reference_image via media[]
      const media: { type: string; url: string }[] = [
        { type: "reference_image", url: toImageUrl(params.initialImage) },
      ];

      if (params.referenceImages && params.referenceImages.length > 0) {
        for (const refImg of params.referenceImages.slice(0, 8)) {
          media.push({ type: "reference_image", url: toImageUrl(refImg) });
        }
      }

      return {
        model: "wan2.7-r2v",
        input: {
          prompt: params.prompt,
          media,
        },
        parameters: {
          resolution: "720P",
          ratio: normaliseRatio(params.ratio),
          duration: params.duration || 5,
        },
      };
    }

    // wan2.6 / wan2.1: img_url for initial image
    return {
      model: this.model,
      input: {
        prompt: params.prompt,
        img_url: toImageUrl(params.initialImage),
      },
      parameters: {
        size: ratioToSize(params.ratio),
        duration: params.duration || 5,
      },
    };
  }

  buildTextBody(params: VideoGenerateParams): Record<string, unknown> {
    // Choose t2v variant: wan2.7-t2v for wan2.7 base, otherwise use model as-is
    const model = this.isWan27 ? "wan2.7-t2v" : this.model;

    if (this.isWan27) {
      return {
        model,
        input: {
          prompt: params.prompt,
        },
        parameters: {
          resolution: "720P",
          ratio: normaliseRatio(params.ratio),
          duration: params.duration || 5,
        },
      };
    }

    return {
      model,
      input: {
        prompt: params.prompt,
      },
      parameters: {
        size: ratioToSize(params.ratio),
        duration: params.duration || 5,
      },
    };
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 360;   // 30 min — Wan models are slower
    const interval = 5_000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, interval));

      const res = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        console.warn(`[WanVideo] Poll ${i + 1}: HTTP ${res.status}, retrying…`);
        continue;
      }

      const result = (await res.json()) as {
        output?: {
          task_id?: string;
          task_status?: string;
          video_url?: string;
          message?: string;
        };
        usage?: unknown;
      };

      const status = result.output?.task_status ?? "UNKNOWN";
      console.log(`[WanVideo] Poll ${i + 1}: status=${status}`);

      if (status === "SUCCEEDED") {
        const videoUrl = result.output?.video_url;
        if (!videoUrl) {
          throw new Error(
            `WanVideo: SUCCEEDED but no video_url in response: ${JSON.stringify(result)}`
          );
        }
        return videoUrl;
      }

      if (status === "FAILED") {
        throw new Error(
          `WanVideo generation failed: ${result.output?.message ?? "unknown error"}`
        );
      }

      // PENDING / RUNNING → keep polling
    }

    throw new Error("WanVideo generation timed out after 30 minutes");
  }
}
