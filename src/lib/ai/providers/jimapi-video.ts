import type { VideoGenerateParams, VideoGenerateResult, VideoProvider } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";

type JsonRecord = Record<string, unknown>;

interface JimApiTaskResponse {
  id?: string;
  task_id?: string;
  status?: string;
  progress?: number;
  result?: {
    data?: Array<{ url?: string; format?: string }>;
  };
  output?: {
    video_url?: string;
    task_id?: string;
    task_status?: string;
  };
  error?: {
    message?: string;
    code?: string | number;
  } | string;
  message?: string;
  data?: unknown;
  url?: unknown;
  video_url?: unknown;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function fileMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function toDataUrl(filePath: string): string {
  const data = fs.readFileSync(filePath, { encoding: "base64" });
  return `data:${fileMime(filePath)};base64,${data}`;
}

function extractErrorMessage(payload: JimApiTaskResponse | JsonRecord): string {
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return typeof payload.message === "string" ? payload.message : "";
}

function sanitizeStatus(status: string | undefined): string {
  return String(status || "").toLowerCase();
}

export class JimApiVideoProvider implements VideoProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;
  private endpointPath: string;
  private uploadEndpointPath: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.apiKey = params?.apiKey || process.env.JIMAPI_API_KEY || "";
    this.baseUrl = (params?.baseUrl || process.env.JIMAPI_BASE_URL || "https://www.jimapi.com/v1").replace(/\/+$/, "");
    this.model = params?.model || process.env.JIMAPI_VIDEO_MODEL || "viduq3-turbo";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    this.endpointPath = process.env.JIMAPI_VIDEO_ENDPOINT || process.env.JIMAPI_VIDEO_ENDPOINT_PATH || "/videos/generations";
    this.uploadEndpointPath = process.env.JIMAPI_UPLOAD_IMAGE_ENDPOINT || process.env.JIMAPI_UPLOAD_IMAGE_ENDPOINT_PATH || "/uploads/images";
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    if (!this.apiKey) throw new Error("JimAPI video API key is not configured");

    const body = await this.buildRequestBody(params);
    console.log(
      `[JimAPI Video] Submitting task: model=${this.model}, duration=${params.duration}s, ratio=${params.ratio}`
    );

    const submitResponse = await fetch(this.url(this.endpointPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const submitJson = await this.readJson(submitResponse);
    if (!submitResponse.ok) {
      throw new Error(
        `JimAPI video submit failed: ${submitResponse.status} ${extractErrorMessage(submitJson) || JSON.stringify(submitJson)}`
      );
    }

    const taskId = this.extractTaskId(submitJson);
    if (!taskId) {
      const directVideo = this.extractVideoUrl(submitJson);
      if (directVideo) return this.downloadResult(directVideo);
      throw new Error(`JimAPI video: no task id in response: ${JSON.stringify(submitJson)}`);
    }

    console.log(`[JimAPI Video] Task submitted: ${taskId}`);
    const videoUrl = await this.pollForResult(taskId);
    return this.downloadResult(videoUrl);
  }

  private async buildRequestBody(params: VideoGenerateParams): Promise<JsonRecord> {
    const imageUrls: string[] = [];
    const imageWithRoles: Array<{ url: string; role: string }> = [];

    if ("firstFrame" in params) {
      const firstFrame = params.firstFrame;
      const lastFrame = params.lastFrame;
      if (!firstFrame || !lastFrame) {
        throw new Error("JimAPI video requires both firstFrame and lastFrame in keyframe mode");
      }
      const firstFrameUrl = await this.prepareImage(firstFrame);
      const lastFrameUrl = await this.prepareImage(lastFrame);
      imageUrls.push(firstFrameUrl, lastFrameUrl);
      imageWithRoles.push(
        { url: firstFrameUrl, role: "first_frame" },
        { url: lastFrameUrl, role: "last_frame" },
      );
    } else {
      const initialImageUrl = await this.prepareImage(params.initialImage);
      imageUrls.push(initialImageUrl);
      imageWithRoles.push({ url: initialImageUrl, role: "first_frame" });
      for (const refImage of params.referenceImages ?? []) {
        const refUrl = await this.prepareImage(refImage);
        imageWithRoles.push({ url: refUrl, role: "reference_image" });
      }
    }

    const base: JsonRecord = {
      model: this.model,
      prompt: params.prompt,
      duration: this.normalizeDuration(params.duration),
      resolution: process.env.JIMAPI_VIDEO_RESOLUTION || this.defaultResolution(),
      aspect_ratio: params.ratio || "16:9",
      watermark: false,
      client_business_id: `aicomic_${genId()}`,
    };

    if (this.supportsRoleImages()) {
      base.image_with_roles = imageWithRoles;
    } else {
      base.image_urls = imageUrls;
    }

    if (this.model.toLowerCase().includes("vidu")) {
      base.audio = process.env.JIMAPI_VIDEO_AUDIO !== "false";
    }

    if (this.model.toLowerCase().includes("kling")) {
      base.mode = process.env.JIMAPI_VIDEO_MODE || "std";
      base.audio = process.env.JIMAPI_VIDEO_AUDIO === "true";
      base.metadata = { watermark: false };
    }

    if (this.model.toLowerCase().includes("minimax")) {
      base.metadata = {
        ...(base.metadata as JsonRecord | undefined),
        prompt_optimizer: true,
        aigc_watermark: false,
      };
    }

    return base;
  }

  private async prepareImage(pathOrUrl: string): Promise<string> {
    if (isHttpUrl(pathOrUrl) || pathOrUrl.startsWith("data:image/")) return pathOrUrl;

    const uploaded = await this.tryUploadImage(pathOrUrl);
    if (uploaded) return uploaded;

    console.warn(
      "[JimAPI Video] Image upload endpoint unavailable; falling back to data URL. If generation rejects it, configure JIMAPI_UPLOAD_IMAGE_ENDPOINT_PATH or provide public image URLs."
    );
    return toDataUrl(pathOrUrl);
  }

  private async tryUploadImage(filePath: string): Promise<string | null> {
    if (!fs.existsSync(filePath)) throw new Error(`JimAPI video: image file not found: ${filePath}`);

    try {
      const file = new File([fs.readFileSync(filePath)], path.basename(filePath), {
        type: fileMime(filePath),
      });
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "generation");

      const response = await fetch(this.url(this.uploadEndpointPath), {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (response.status === 404) return null;

      const json = await this.readJson(response);
      if (!response.ok) {
        console.warn(
          `[JimAPI Video] Image upload failed: ${response.status} ${extractErrorMessage(json) || JSON.stringify(json)}`
        );
        return null;
      }

      const url =
        typeof json.data === "object" && json.data && "url" in json.data
          ? (json.data as { url?: unknown }).url
          : json.url;
      return typeof url === "string" && url ? url : null;
    } catch (error) {
      console.warn("[JimAPI Video] Image upload skipped:", error);
      return null;
    }
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = Number(process.env.JIMAPI_VIDEO_MAX_ATTEMPTS || 90);
    const intervalMs = Number(process.env.JIMAPI_VIDEO_POLL_INTERVAL_MS || 10_000);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));

      const response = await fetch(this.url(`${this.endpointPath}/${encodeURIComponent(taskId)}`), {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      const json = await this.readJson(response);
      if (!response.ok) {
        console.warn(
          `[JimAPI Video] Poll ${attempt}: HTTP ${response.status} ${extractErrorMessage(json)}`
        );
        continue;
      }

      const status = sanitizeStatus(json.status || json.output?.task_status);
      const progress = typeof json.progress === "number" ? `, progress=${json.progress}%` : "";
      console.log(`[JimAPI Video] Poll ${attempt}: status=${status || "unknown"}${progress}`);

      const videoUrl = this.extractVideoUrl(json);
      if ((status === "completed" || status === "succeeded" || status === "success") && videoUrl) {
        return videoUrl;
      }
      if (videoUrl && !status) return videoUrl;
      if (status === "failed" || status === "error" || status === "cancelled") {
        throw new Error(`JimAPI video generation failed: ${extractErrorMessage(json) || JSON.stringify(json)}`);
      }
    }

    throw new Error(`JimAPI video generation timed out after ${Math.round((maxAttempts * intervalMs) / 60000)} minutes`);
  }

  private async downloadResult(videoUrl: string): Promise<VideoGenerateResult> {
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`JimAPI video: failed to download result (${response.status})`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    console.log(`[JimAPI Video] Saved to ${filepath}`);
    return { filePath: filepath };
  }

  private extractTaskId(json: JimApiTaskResponse): string {
    const outputTaskId = json.output?.task_id;
    return String(json.id || json.task_id || outputTaskId || "");
  }

  private extractVideoUrl(json: JimApiTaskResponse): string {
    const candidates = [
      json.result?.data?.[0]?.url,
      json.output?.video_url,
      json.video_url,
      json.url,
    ];
    const url = candidates.find((item): item is string => typeof item === "string" && item.length > 0);
    return url || "";
  }

  private async readJson(response: Response): Promise<JimApiTaskResponse> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as JimApiTaskResponse;
    } catch {
      return { message: text };
    }
  }

  private url(pathname: string): string {
    if (isHttpUrl(pathname)) return pathname;
    const cleanPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return `${this.baseUrl}${cleanPath}`;
  }

  private supportsRoleImages(): boolean {
    const model = this.model.toLowerCase();
    return model.includes("kling") || model.includes("seedance");
  }

  private defaultResolution(): string {
    const model = this.model.toLowerCase();
    if (model.includes("minimax")) return "768P";
    return "720p";
  }

  private normalizeDuration(duration: number): number {
    const model = this.model.toLowerCase();
    if (model.includes("minimax")) return duration <= 6 ? 6 : 10;
    if (model.includes("wan")) return duration <= 5 ? 5 : duration <= 10 ? 10 : 15;
    if (model.includes("kling-video")) return duration <= 5 ? 5 : duration <= 10 ? 10 : 15;
    return Math.max(1, Math.min(16, Math.round(duration || 5)));
  }
}
