import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";

function toDataUrl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/png";
  const base64 = fs.readFileSync(filePath, { encoding: "base64" });
  return `data:${mime};base64,${base64}`;
}

function toImageUrl(imagePathOrUrl: string): string {
  if (imagePathOrUrl.startsWith("http://") || imagePathOrUrl.startsWith("https://")) {
    return imagePathOrUrl;
  }
  return toDataUrl(imagePathOrUrl);
}

/**
 * UCloud ModelVerse Seedance provider.
 *
 * API docs: https://docs.ucloud.cn/modelverse/api_doc/video_api/doubao-seedance-1-5-pro-251215
 *
 * Submit:  POST {baseUrl}/v1/tasks/submit
 * Poll:    GET  {baseUrl}/v1/tasks/status?task_id=<id>
 *
 * Supports both Seedance 1.5 and Seedance 2.0 models.
 */
export class UCloudSeedanceProvider implements VideoProvider {
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
    this.apiKey = params?.apiKey || process.env.UCLOUD_API_KEY || "";
    this.baseUrl = (
      params?.baseUrl || "https://api.modelverse.cn"
    ).replace(/\/+$/, "");
    this.model = params?.model || "doubao-seedance-1-5-pro-251215";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const body = "firstFrame" in params
      ? this.buildKeyframeBody(params as VideoGenerateParams & { firstFrame: string; lastFrame: string })
      : this.buildReferenceBody(params as VideoGenerateParams & { initialImage: string });

    console.log(
      `[UCloudSeedance] Submitting task: model=${this.model}, duration=${(body.parameters as Record<string, unknown>)?.duration}`
    );

    const submitResponse = await fetch(`${this.baseUrl}/v1/tasks/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text();
      throw new Error(`UCloudSeedance submit failed: ${submitResponse.status} ${errText}`);
    }

    const submitResult = (await submitResponse.json()) as {
      output?: { task_id: string };
    };
    const taskId = submitResult.output?.task_id;
    if (!taskId) {
      throw new Error(`UCloudSeedance: no task_id in response: ${JSON.stringify(submitResult)}`);
    }
    console.log(`[UCloudSeedance] Task submitted: ${taskId}`);

    const videoUrl = await this.pollForResult(taskId);

    const videoResponse = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(videoResponse.body! as any, createWriteStream(filepath));

    return { filePath: filepath };
  }

  private buildKeyframeBody(
    params: VideoGenerateParams & { firstFrame: string; lastFrame: string }
  ): Record<string, unknown> {
    const isSeedance2 = this.model.includes("seedance-2");
    return {
      model: this.model,
      input: {
        content: [
          { type: "text", text: params.prompt },
          {
            type: "image_url",
            image_url: { url: toDataUrl(params.firstFrame) },
            role: "first_frame",
          },
          {
            type: "image_url",
            image_url: { url: toDataUrl(params.lastFrame) },
            role: "last_frame",
          },
        ],
      },
      parameters: {
        duration: params.duration || 5,
        ratio: params.ratio || "16:9",
        resolution: "720p",
        watermark: false,
        ...(isSeedance2 && { generate_audio: true }),
      },
    };
  }

  private buildReferenceBody(
    params: VideoGenerateParams & { initialImage: string }
  ): Record<string, unknown> {
    const isSeedance2 = this.model.includes("seedance-2");

    const content: Record<string, unknown>[] = [
      { type: "text", text: params.prompt },
    ];

    if (params.referenceImages && params.referenceImages.length > 0) {
      // Multi-reference mode (Seedance 2.0): all images as reference_image role
      content.push({
        type: "image_url",
        image_url: { url: toImageUrl(params.initialImage) },
        role: "reference_image",
      });
      for (const refImg of params.referenceImages.slice(0, 8)) {
        content.push({
          type: "image_url",
          image_url: { url: toImageUrl(refImg) },
          role: "reference_image",
        });
      }
    } else {
      // Single-image mode: first_frame role
      content.push({
        type: "image_url",
        image_url: { url: toImageUrl(params.initialImage) },
        role: "first_frame",
      });
    }

    return {
      model: this.model,
      input: { content },
      parameters: {
        duration: params.duration || 5,
        ratio: params.ratio || "16:9",
        resolution: "720p",
        watermark: false,
        ...(isSeedance2 && { generate_audio: true }),
      },
    };
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 360; // 30 min
    const interval = 5_000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, interval));

      const res = await fetch(
        `${this.baseUrl}/v1/tasks/status?task_id=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: this.apiKey }, signal: AbortSignal.timeout(30_000) }
      );

      if (!res.ok) {
        console.warn(`[UCloudSeedance] Poll ${i + 1}: HTTP ${res.status}, retrying…`);
        continue;
      }

      const result = (await res.json()) as {
        output?: {
          task_id?: string;
          task_status?: string;
          urls?: string[];
          error_message?: string;
        };
      };

      const status = result.output?.task_status ?? "UNKNOWN";
      console.log(`[UCloudSeedance] Poll ${i + 1}: status=${status}`);

      if (status === "Success") {
        const urls = result.output?.urls;
        if (!urls || urls.length === 0) {
          throw new Error(
            `UCloudSeedance: Success but no urls in response: ${JSON.stringify(result)}`
          );
        }
        return urls[0];
      }

      if (status === "Failure" || status === "Expired") {
        throw new Error(
          `UCloudSeedance generation ${status.toLowerCase()}: ${result.output?.error_message ?? "unknown error"}`
        );
      }

      // Pending / Running → keep polling
    }

    throw new Error("UCloudSeedance generation timed out after 30 minutes");
  }
}
