import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";

export class AgnesVideoProvider implements VideoProvider {
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
    this.apiKey = (params?.apiKey || process.env.AGNES_API_KEY || "").trim();
    this.baseUrl = (params?.baseUrl || "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "");
    this.model = params?.model || "agnes-video-v2.0";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: params.prompt,
      width: 1152,
      height: 768,
      num_frames: 121,
      frame_rate: 24,
    };

    if ("firstFrame" in params && params.firstFrame) {
      const base64 = this.fileToBase64(params.firstFrame);
      body.image = base64;
    } else if ("initialImage" in params && params.initialImage) {
      const base64 = this.fileToBase64(params.initialImage);
      body.image = base64;
    }

    console.log(`[AgnesVideo] Submitting: model=${this.model}, hasImage=${"image" in body}`);

    const submitRes = await fetch(`${this.baseUrl}/videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(`Agnes video submit failed: ${submitRes.status} ${errText}`);
    }

    const submitJson = (await submitRes.json()) as {
      task_id: string;
      id?: string;
    };

    const taskId = submitJson.task_id || submitJson.id;
    if (!taskId) {
      throw new Error(`Agnes video: no task_id in submit response: ${JSON.stringify(submitJson)}`);
    }

    console.log(`[AgnesVideo] Task submitted: ${taskId}`);
    const videoUrl = await this.pollForResult(taskId);

    const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!videoRes.ok) {
      throw new Error(`Agnes video download failed: ${videoRes.status}`);
    }

    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(videoRes.body! as any, createWriteStream(filepath));

    console.log(`[AgnesVideo] Saved: ${filepath}`);
    return { filePath: filepath };
  }

  private fileToBase64(filePath: string): string {
    const data = fs.readFileSync(filePath);
    return data.toString("base64");
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 120;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 5_000));

      const res = await fetch(`${this.baseUrl}/videos/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) continue;

      const json = (await res.json()) as {
        status?: string;
        progress?: number;
        error?: string | null;
        remixed_from_video_id?: string;
        video_url?: string;
      };

      console.log(`[AgnesVideo] Poll ${i + 1}: status=${json.status}, progress=${json.progress}`);

      if (json.status === "completed") {
        const url = json.remixed_from_video_id || json.video_url;
        if (url) return url;
        throw new Error(`Agnes video: no URL in completed response: ${JSON.stringify(json)}`);
      }

      if (json.status === "failed") {
        throw new Error(`Agnes video generation failed: ${json.error || "unknown"}`);
      }
    }

    throw new Error("Agnes video generation timed out after 10 minutes");
  }
}
