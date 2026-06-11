import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";
import { toImageUrl, pollPrediction } from "./atlascloud";

/**
 * Atlas Cloud video provider — image-to-video via the async media API.
 *
 * Submits to POST /api/v1/model/generateVideo, then polls the prediction
 * endpoint until completion. Supports keyframe mode (first/last frame) and
 * reference mode (single initial image + optional character references).
 *
 * Equivalent models (drop-in for Seedance / Kling / Veo):
 *   • bytedance/seedance-2.0-fast/image-to-video   (Seedance)
 *   • kwaivgi/kling-v2.6-pro/image-to-video        (Kling)
 *   • alibaba/wan-2.7/image-to-video               (Wan)
 *   • google/veo3.1/image-to-video                 (Veo)
 *
 * Docs: https://www.atlascloud.ai/docs
 */

const DEFAULT_LLM_BASE_URL = "https://api.atlascloud.ai/v1";
const DEFAULT_VIDEO_MODEL = "bytedance/seedance-2.0-fast/image-to-video";

function mediaBaseFromLlmBase(llmBase: string): string {
  const trimmed = llmBase.replace(/\/+$/, "");
  if (/\/v1$/.test(trimmed)) {
    return trimmed.replace(/\/v1$/, "/api/v1/model");
  }
  return `${trimmed}/api/v1/model`;
}

// Seedance models require shot_type ("single" | "multi"); empty string errors.
function needsShotType(model: string): boolean {
  return model.includes("seedance");
}

export class AtlasCloudVideoProvider implements VideoProvider {
  private apiKey: string;
  private mediaBaseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
    this.apiKey =
      params?.apiKey || process.env.ATLASCLOUD_API_KEY || process.env.ATLAS_CLOUD_API_KEY || "";
    const llmBaseUrl = (params?.baseUrl || process.env.ATLASCLOUD_BASE_URL || DEFAULT_LLM_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.mediaBaseUrl = mediaBaseFromLlmBase(llmBaseUrl);
    this.model = params?.model || process.env.ATLASCLOUD_VIDEO_MODEL || DEFAULT_VIDEO_MODEL;
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    // Collect input frames as image URLs (newline-separated for the `images` field).
    const imageUrls: string[] = [];
    if ("firstFrame" in params && params.firstFrame) {
      imageUrls.push(toImageUrl(params.firstFrame));
      if (params.lastFrame) imageUrls.push(toImageUrl(params.lastFrame));
    } else if ("initialImage" in params && params.initialImage) {
      imageUrls.push(toImageUrl(params.initialImage));
      for (const ref of (params.referenceImages ?? []).slice(0, 8)) {
        imageUrls.push(toImageUrl(ref));
      }
    } else {
      throw new Error("AtlasCloud video requires an image input (firstFrame or initialImage)");
    }

    const body: Record<string, unknown> = {
      model: this.model,
      prompt: params.prompt,
      images: imageUrls.join("\n"),
      duration: params.duration || 5,
      aspect_ratio: params.ratio || "16:9",
      ...(needsShotType(this.model) && { shot_type: "single" }),
    };

    console.log(`[AtlasCloud] Submitting video task: model=${this.model}, ratio=${params.ratio}`);

    const submitRes = await fetch(`${this.mediaBaseUrl}/generateVideo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(`AtlasCloud video submit failed: ${submitRes.status} ${errText}`);
    }

    const submit = (await submitRes.json()) as { data?: { id?: string } };
    const taskId = submit.data?.id;
    if (!taskId) {
      throw new Error(`AtlasCloud: no task id in video response: ${JSON.stringify(submit)}`);
    }
    console.log(`[AtlasCloud] Video task submitted: ${taskId}`);

    const outputs = await pollPrediction(this.mediaBaseUrl, this.apiKey, taskId, {
      maxAttempts: 120,
      interval: 5000,
      label: "video",
    });

    const videoUrl = outputs[0];
    if (!videoUrl) throw new Error("AtlasCloud: no video URL in completed result");

    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      throw new Error(`AtlasCloud: failed to download video (${videoRes.status})`);
    }
    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(`[AtlasCloud] Video saved to ${filepath}`);
    return { filePath: filepath };
  }
}
