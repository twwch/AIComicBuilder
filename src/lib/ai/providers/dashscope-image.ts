import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";

// ── Model family detection ──────────────────────────────────────────────────

export type ModelFamily = "wan" | "qwen" | "zimage";

export function getModelFamily(model: string): ModelFamily {
  if (model.startsWith("wan")) return "wan";
  if (model.startsWith("z-image")) return "zimage";
  return "qwen"; // qwen-image-*
}

// ── Aspect-ratio → pixel size mappings ──────────────────────────────────────

const WAN_ASPECT_RATIO_MAP: Record<string, string> = {
  "1:1": "1024*1024",
  "16:9": "1280*720",
  "9:16": "720*1280",
  "4:3": "1024*768",
  "3:4": "768*1024",
  "3:2": "1080*720",
  "2:3": "720*1080",
};

const QWEN_ASPECT_RATIO_MAP: Record<string, string> = {
  "1:1": "2048*2048",
  "16:9": "2048*1152",
  "9:16": "1152*2048",
  "4:3": "2048*1536",
  "3:4": "1536*2048",
  "3:2": "2048*1365",
  "2:3": "1365*2048",
};

const ZIMAGE_ASPECT_RATIO_MAP: Record<string, string> = {
  "1:1": "1024*1024",
  "16:9": "1536*1024",
  "9:16": "1024*1536",
  "4:3": "1024*768",
  "3:4": "768*1024",
  "3:2": "1536*1024",
  "2:3": "1024*1536",
};

export function resolveSize(
  family: ModelFamily,
  size?: string,
  aspectRatio?: string,
): string | undefined {
  // If explicit size is given, pass through (caller knows best)
  if (size) return size;

  if (aspectRatio) {
    switch (family) {
      case "wan":
        return WAN_ASPECT_RATIO_MAP[aspectRatio];
      case "qwen":
        return QWEN_ASPECT_RATIO_MAP[aspectRatio];
      case "zimage":
        return ZIMAGE_ASPECT_RATIO_MAP[aspectRatio];
    }
  }

  // Return family-specific defaults
  switch (family) {
    case "wan":
      return "1024*1024";
    case "qwen":
      return "2048*2048";
    case "zimage":
      return "1024*1536";
  }
}

// ── DashScope response types ────────────────────────────────────────────────

interface DashScopeImageResponse {
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{ image?: string }>;
      };
    }>;
  };
  code?: string;
  message?: string;
}

// ── Provider ────────────────────────────────────────────────────────────────

export class DashScopeImageProvider implements AIProvider {
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
    this.apiKey =
      params?.apiKey || process.env.DASHSCOPE_API_KEY || "";
    this.baseUrl = (
      params?.baseUrl ||
      process.env.DASHSCOPE_BASE_URL ||
      "https://dashscope.aliyuncs.com/api/v1"
    ).replace(/\/+$/, "");
    this.model =
      params?.model || process.env.DASHSCOPE_IMAGE_MODEL || "qwen-image-2.0-pro";
    this.uploadDir =
      params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(
    _prompt: string,
    _options?: TextOptions,
  ): Promise<string> {
    throw new Error("DashScope image models do not support text generation");
  }

  async generateImage(
    prompt: string,
    options?: ImageOptions,
  ): Promise<string> {
    const model = options?.model || this.model;
    const family = getModelFamily(model);
    const size = resolveSize(family, options?.size, options?.aspectRatio);

    // Build parameters object based on model family
    const parameters: Record<string, unknown> = {};
    if (size) parameters.size = size;

    switch (family) {
      case "wan":
        parameters.n = 1;
        break;
      case "qwen":
        parameters.n = 1;
        break;
      case "zimage":
        // z-image-turbo does not support n parameter
        break;
    }

    const body = {
      model,
      input: {
        messages: [
          {
            role: "user",
            content: [{ text: prompt }],
          },
        ],
      },
      parameters,
    };

    console.log(
      `[DashScopeImage] Generating: model=${model}, family=${family}, size=${size}`,
    );

    const res = await fetch(
      `${this.baseUrl}/services/aigc/multimodal-generation/generation`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `DashScope image request failed: ${res.status} ${errText}`,
      );
    }

    const json = (await res.json()) as DashScopeImageResponse;

    // Check for API-level error
    if (json.code) {
      throw new Error(
        `DashScope image error [${json.code}]: ${json.message ?? "unknown"}`,
      );
    }

    const imageUrl =
      json.output?.choices?.[0]?.message?.content?.[0]?.image;
    if (!imageUrl) {
      throw new Error(
        `DashScope image: no image URL in response: ${JSON.stringify(json)}`,
      );
    }

    // Download and save to local storage
    const imageRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
    if (!imageRes.ok) {
      throw new Error(
        `DashScope image: failed to download image (${imageRes.status})`,
      );
    }
    const ext = imageUrl.split("?")[0].split(".").pop() || "png";
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(imageRes.body! as any, createWriteStream(filepath));

    console.log(`[DashScopeImage] Saved to ${filepath}`);
    return filepath;
  }
}
