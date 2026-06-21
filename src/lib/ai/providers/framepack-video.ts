import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";

type GradioEvent =
  | { type: "data"; data: unknown[] }
  | { type: "complete"; data: unknown[] }
  | { type: "progress"; data: { index: number; length: number; desc: string } }
  | { type: "heartbeat"; data: string }
  | { type: "log"; data: string };

export class FramepackVideoProvider implements VideoProvider {
  private baseUrl: string;
  private uploadDir: string;

  constructor(params?: { baseUrl?: string; uploadDir?: string }) {
    this.baseUrl = (params?.baseUrl || process.env.FRAMEPACK_BASE_URL || "http://localhost:7860").replace(/\/+$/, "");
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  private apiBase(): string {
    return `${this.baseUrl}/gradio_api`;
  }

  private async uploadImage(imagePath: string): Promise<string> {
    const body = new FormData();
    body.append("files", new Blob([fs.readFileSync(imagePath)]), path.basename(imagePath));

    const res = await fetch(`${this.apiBase()}/upload`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`FramePack image upload failed: ${res.status}`);
    }
    const result = (await res.json()) as Array<{ name: string; data: string }>;
    if (!result?.[0]?.data) {
      throw new Error(`FramePack image upload returned no data: ${JSON.stringify(result)}`);
    }
    return result[0].data;
  }

  private async startGeneration(data: unknown[]): Promise<string> {
    const res = await fetch(`${this.apiBase()}/call/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`FramePack generation start failed: ${res.status} ${text}`);
    }
    const result = (await res.json()) as { event_id?: string };
    if (!result.event_id) {
      throw new Error(`FramePack generation returned no event_id: ${JSON.stringify(result)}`);
    }
    return result.event_id;
  }

  private async pollForVideo(eventId: string, signal?: AbortSignal): Promise<string> {
    const url = `${this.apiBase()}/call/process/${eventId}`;
    const maxDuration = 1_800_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxDuration) {
      try {
        const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(60_000) });
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        const text = await res.text();
        const events = this.parseSSE(text);

        for (const event of events) {
          if (event.type === "complete") {
            const videoData = event.data?.[0];
            if (videoData && typeof videoData === "object" && "path" in (videoData as Record<string, unknown>)) {
              return (videoData as Record<string, string>).path;
            }
            if (typeof videoData === "string") return videoData;
          }
        }
      } catch {
        // Timeout or network error, keep polling
      }

      await new Promise((r) => setTimeout(r, 3000));
    }

    throw new Error("FramePack generation timed out after 30 minutes");
  }

  private parseSSE(text: string): GradioEvent[] {
    const events: GradioEvent[] = [];
    const lines = text.split("\n");
    let currentEvent = "";
    let currentData = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        currentData = line.slice(6).trim();
        if (currentData === "[DONE]") continue;
        try {
          const parsed = JSON.parse(currentData);
          if (currentEvent === "data" || currentEvent === "complete") {
            events.push({ type: currentEvent, data: Array.isArray(parsed) ? parsed : [parsed] });
          } else if (currentEvent === "progress") {
            events.push({ type: "progress", data: parsed });
          }
        } catch {
          // skip unparseable
        }
      }
    }

    return events;
  }

  private async downloadVideo(
    eventId: string,
    videoRef: string,
  ): Promise<string> {
    let videoUrl: string;
    if (videoRef.startsWith("http")) {
      videoUrl = videoRef;
    } else if (videoRef.startsWith("/")) {
      videoUrl = `${this.baseUrl}${videoRef}`;
    } else {
      videoUrl = `${this.apiBase()}/file=${encodeURIComponent(videoRef)}`;
    }

    const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      throw new Error(`FramePack video download failed: ${res.status}`);
    }

    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(res.body! as any, createWriteStream(filepath));

    return filepath;
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const imagePath = "firstFrame" in params && params.firstFrame
      ? params.firstFrame
      : "initialImage" in params && params.initialImage
        ? params.initialImage
        : null;

    if (!imagePath) {
      throw new Error("FramePack requires an input image (firstFrame or initialImage)");
    }

    const duration = Math.min(60, Math.max(1, Math.round(params.duration || 5)));
    const seed = Math.floor(Math.random() * 2147483647);

    console.log(`[FramepackVideo] Uploading image: ${imagePath}`);
    const imageData = await this.uploadImage(imagePath);

    const data: unknown[] = [
      imageData,
      params.prompt,
      "",
      seed,
      duration,
      9,
      25,
      1.0,
      10.0,
      0.0,
      6,
      true,
      16,
    ];

    console.log(`[FramepackVideo] Starting generation, duration=${duration}s, seed=${seed}`);
    const eventId = await this.startGeneration(data);

    console.log(`[FramepackVideo] Polling for result, eventId=${eventId}`);
    const videoRef = await this.pollForVideo(eventId);

    console.log(`[FramepackVideo] Downloading video from: ${videoRef}`);
    const filePath = await this.downloadVideo(eventId, videoRef);

    console.log(`[FramepackVideo] Saved: ${filePath}`);
    return { filePath };
  }
}
