import type {
  AIProvider,
  ImageOptions,
  TextOptions,
  VideoProvider,
  VideoGenerateParams,
} from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { sanitizeImagePromptText } from "@/lib/ai/prompts/frame-context";
import { normalizeSeedanceBaseUrl } from "./seedance-url";

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

function compactJSON(value: unknown): string {
  return JSON.stringify(value, null, 2).slice(0, 1200);
}

function extractImagePayloadFromString(value: string): {
  url?: string;
  b64?: string;
} | null {
  const trimmed = value.trim();

  if (!trimmed) return null;

  if (trimmed.startsWith("data:image/")) {
    return {
      b64: trimmed.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, ""),
    };
  }

  const directUrlMatch = trimmed.match(/https?:\/\/[^\s)]+/);
  if (directUrlMatch) {
    return { url: directUrlMatch[0] };
  }

  return null;
}

function normalizeSeedanceImageSize(size?: string): string | null {
  if (!size) return "2K";

  const normalized = size.trim().toUpperCase();
  if (!normalized) return "2K";
  if (/^\d+K$/.test(normalized)) return normalized;

  const match = normalized.match(/^(\d+)X(\d+)$/);
  if (!match) return normalized;

  const width = Number(match[1]);
  const height = Number(match[2]);
  const maxDimension = Math.max(width, height);

  if (maxDimension <= 1024) return "1K";
  if (maxDimension <= 2048) return "2K";
  return "4K";
}

export class SeedanceProvider implements AIProvider, VideoProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultImageModel: string;
  private defaultVideoModel: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.apiKey = params?.apiKey || process.env.SEEDANCE_API_KEY || "";
    this.baseUrl = normalizeSeedanceBaseUrl(
      params?.baseUrl || process.env.SEEDANCE_BASE_URL
    );
    this.defaultImageModel =
      params?.model ||
      process.env.SEEDANCE_IMAGE_MODEL ||
      "doubao-seedream-5-0-260128";
    this.defaultVideoModel =
      params?.model ||
      process.env.SEEDANCE_MODEL ||
      "doubao-seedance-1-5-pro-250528";
    this.uploadDir =
      params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(_prompt: string, _options?: TextOptions): Promise<string> {
    throw new Error("Seedance does not support text generation in this project");
  }

  private buildImageAttempts(
    model: string,
    prompt: string,
    size?: string
  ): Array<Record<string, unknown>> {
    const normalizedSize = normalizeSeedanceImageSize(size);
    const baseBody: Record<string, unknown> = {
      model,
      prompt,
      sequential_image_generation: "disabled",
      response_format: "url",
      stream: false,
      watermark: true,
    };

    return [
      normalizedSize ? { ...baseBody, size: normalizedSize } : baseBody,
      baseBody,
      normalizedSize
        ? { ...baseBody, size: normalizedSize, response_format: "b64_json" }
        : { ...baseBody, response_format: "b64_json" },
      normalizedSize
        ? { ...baseBody, size: normalizedSize, watermark: false }
        : { ...baseBody, watermark: false },
    ].filter(
      (attempt, index, all) =>
        all.findIndex((candidate) => compactJSON(candidate) === compactJSON(attempt)) === index
    );
  }

  private async requestImageGeneration(
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const rawText = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      if (!response.ok) {
        throw new Error(
          `Seedance image generation failed (${response.status}): ${rawText.slice(0, 400)}`
        );
      }
      throw new Error(
        `Seedance image generation returned non-JSON response: ${rawText.slice(0, 400)}`
      );
    }

    if (!response.ok) {
      const errorMessage =
        typeof json?.error === "object" &&
        json.error &&
        "message" in json.error &&
        typeof json.error.message === "string"
          ? json.error.message
          : compactJSON(json);
      throw new Error(
        `Seedance image generation failed (${response.status}): ${errorMessage}`
      );
    }

    return json;
  }

  private extractImagePayload(result: Record<string, unknown>): {
    url?: string;
    b64?: string;
  } | null {
    const candidates: unknown[] = [
      result,
      result.data,
      Array.isArray(result.data) ? result.data[0] : null,
      result.output,
      Array.isArray(result.output) ? result.output[0] : null,
      result.result,
      typeof result.result === "object" && result.result !== null
        ? (result.result as Record<string, unknown>).data
        : null,
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;

      if (typeof candidate === "string") {
        const parsed = extractImagePayloadFromString(candidate);
        if (parsed) return parsed;
        continue;
      }

      if (Array.isArray(candidate)) {
        for (const nested of candidate) {
          if (typeof nested !== "object" || nested === null) continue;
          const nestedPayload = this.extractImagePayload(
            nested as Record<string, unknown>
          );
          if (nestedPayload) return nestedPayload;
        }
        continue;
      }

      if (typeof candidate !== "object") continue;
      const record = candidate as Record<string, unknown>;

      for (const key of ["url", "image_url"]) {
        const value = record[key];
        if (typeof value === "string" && value) {
          return extractImagePayloadFromString(value) || { url: value };
        }
        if (typeof value === "object" && value !== null) {
          const nestedUrl = (value as Record<string, unknown>).url;
          if (typeof nestedUrl === "string" && nestedUrl) {
            return extractImagePayloadFromString(nestedUrl) || { url: nestedUrl };
          }
        }
      }

      for (const key of ["b64_json", "base64", "image_base64", "data"]) {
        const value = record[key];
        if (typeof value === "string" && value) {
          const parsed = extractImagePayloadFromString(value);
          if (parsed) return parsed;
          return { b64: value };
        }
      }
    }

    return null;
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const sanitizedPrompt = sanitizeImagePromptText(prompt);
    const filename = `${ulid()}.png`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    const errors: string[] = [];

    for (const body of this.buildImageAttempts(
      options?.model || this.defaultImageModel,
      sanitizedPrompt,
      options?.size
    )) {
      try {
        const response = await this.requestImageGeneration(body);
        const payload = this.extractImagePayload(response);

        if (payload?.url) {
          const imageResponse = await fetch(payload.url);
          if (!imageResponse.ok) {
            throw new Error(
              `Seedance image download failed (${imageResponse.status})`
            );
          }
          const buffer = Buffer.from(await imageResponse.arrayBuffer());
          fs.writeFileSync(filepath, buffer);
          return filepath;
        }

        if (payload?.b64) {
          const buffer = Buffer.from(payload.b64, "base64");
          fs.writeFileSync(filepath, buffer);
          return filepath;
        }

        errors.push(
          `Request returned no image payload. Request: ${compactJSON(body)} Response: ${compactJSON(response)}`
        );
      } catch (error) {
        errors.push(
          `Request failed. Request: ${compactJSON(body)} Error: ${String(error)}`
        );
      }
    }

    throw new Error(
      `No usable image payload returned from Seedance image API.\n${errors.join("\n")}`
    );
  }

  async generateVideo(params: VideoGenerateParams): Promise<string> {
    const firstFrameUrl = toDataUrl(params.firstFrame);
    const lastFrameUrl = toDataUrl(params.lastFrame);

    // Build content array per Seedance API spec
    const content: Record<string, unknown>[] = [
      {
        type: "text",
        text: params.prompt,
      },
      {
        type: "image_url",
        image_url: { url: firstFrameUrl },
        role: "first_frame",
      },
      {
        type: "image_url",
        image_url: { url: lastFrameUrl },
        role: "last_frame",
      },
    ];

    const body: Record<string, unknown> = {
      model: this.defaultVideoModel,
      content,
      duration: params.duration || 5,
      ratio: params.ratio || "16:9",
      watermark: false,
    };

    console.log(
      `[Seedance] Submitting task: model=${this.defaultVideoModel}, duration=${body.duration}, ratio=${body.ratio}`
    );

    const submitResponse = await fetch(
      `${this.baseUrl}/contents/generations/tasks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!submitResponse.ok) {
      const errText = await submitResponse.text();
      throw new Error(
        `Seedance submit failed: ${submitResponse.status} ${errText}`
      );
    }

    const submitResult = (await submitResponse.json()) as { id: string };
    console.log(`[Seedance] Task submitted: ${submitResult.id}`);

    const videoUrl = await this.pollForResult(submitResult.id);

    // Download video to local storage
    const videoResponse = await fetch(videoUrl);
    const buffer = Buffer.from(await videoResponse.arrayBuffer());
    const filename = `${ulid()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    return filepath;
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 120;
    const interval = 5000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, interval));

      const response = await fetch(
        `${this.baseUrl}/contents/generations/tasks/${taskId}`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        }
      );

      if (!response.ok) continue;

      const result = (await response.json()) as {
        status: string;
        content?: { video_url?: string };
        error?: { message?: string };
      };

      console.log(`[Seedance] Poll ${i + 1}: status=${result.status}`);

      if (result.status === "succeeded" && result.content?.video_url) {
        return result.content.video_url;
      }
      if (result.status === "failed") {
        throw new Error(
          `Seedance generation failed: ${result.error?.message || "unknown"}`
        );
      }
    }

    throw new Error("Seedance generation timed out after 10 minutes");
  }
}
