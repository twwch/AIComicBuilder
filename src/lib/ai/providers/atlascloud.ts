import OpenAI from "openai";
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";

/**
 * Atlas Cloud provider — image + text.
 *
 * Atlas Cloud exposes two independent APIs behind a single API key:
 *   • LLM (OpenAI-compatible):  https://api.atlascloud.ai/v1
 *   • Image / Video (async):    https://api.atlascloud.ai/api/v1/model
 *
 * `generateText` uses the OpenAI-compatible chat endpoint; `generateImage`
 * uses the async media endpoint (submit task → poll → download).
 *
 * Docs: https://www.atlascloud.ai/docs
 */

const DEFAULT_LLM_BASE_URL = "https://api.atlascloud.ai/v1";
const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2/text-to-image";
const DEFAULT_TEXT_MODEL = "deepseek-ai/DeepSeek-V3-0324";

// Derive the async media base URL ("…/api/v1/model") from the LLM base URL ("…/v1").
function mediaBaseFromLlmBase(llmBase: string): string {
  const trimmed = llmBase.replace(/\/+$/, "");
  // Replace a trailing "/v1" with "/api/v1/model"; otherwise append it.
  if (/\/v1$/.test(trimmed)) {
    return trimmed.replace(/\/v1$/, "/api/v1/model");
  }
  return `${trimmed}/api/v1/model`;
}

// Atlas Cloud expects `size` as "W*H" (star separated), e.g. "1024*1024".
function toAtlasSize(size?: string, aspectRatio?: string): string | undefined {
  if (size) {
    // Accept "1024x1024" or "1024*1024"; normalise to star form.
    return size.replace(/x/i, "*");
  }
  if (aspectRatio) {
    const map: Record<string, string> = {
      "16:9": "1280*720",
      "9:16": "720*1280",
      "1:1": "1024*1024",
      "4:3": "1152*896",
      "3:4": "896*1152",
    };
    return map[aspectRatio];
  }
  return undefined;
}

interface AtlasPredictionResponse {
  code: number;
  data?: {
    id?: string;
    status?: string;
    outputs?: string[];
    error?: string;
    urls?: { get?: string };
  };
  message?: string;
}

export class AtlasCloudProvider implements AIProvider {
  private client: OpenAI;
  private apiKey: string;
  private mediaBaseUrl: string;
  private defaultModel: string;
  private uploadDir: string;

  constructor(params?: { apiKey?: string; baseURL?: string; model?: string; uploadDir?: string }) {
    this.apiKey =
      params?.apiKey || process.env.ATLASCLOUD_API_KEY || process.env.ATLAS_CLOUD_API_KEY || "";
    const llmBaseUrl = (params?.baseURL || process.env.ATLASCLOUD_BASE_URL || DEFAULT_LLM_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.client = new OpenAI({ apiKey: this.apiKey, baseURL: llmBaseUrl });
    this.mediaBaseUrl = mediaBaseFromLlmBase(llmBaseUrl);
    this.defaultModel = params?.model || process.env.ATLASCLOUD_MODEL || DEFAULT_TEXT_MODEL;
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  // ── Text (OpenAI-compatible) ────────────────────────────────────────────────
  async generateText(prompt: string, options?: TextOptions): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }

    if (options?.images?.length) {
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [];
      for (const imgPath of options.images) {
        try {
          const resolved = path.resolve(imgPath);
          if (fs.existsSync(resolved)) {
            const data = fs.readFileSync(resolved).toString("base64");
            const ext = path.extname(resolved).toLowerCase();
            const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
            content.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } });
          }
        } catch {
          /* skip unreadable */
        }
      }
      content.push({ type: "text", text: prompt });
      messages.push({ role: "user", content });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    const response = await this.client.chat.completions.create({
      model: options?.model || this.defaultModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    });
    return response.choices[0]?.message?.content || "";
  }

  // ── Image (async media API) ──────────────────────────────────────────────────
  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const model = options?.model || DEFAULT_IMAGE_MODEL;
    const size = toAtlasSize(options?.size, options?.aspectRatio);

    // Reference images (e.g. character refs) go in `images`, newline-separated.
    const referenceImages = options?.referenceImages?.length
      ? options.referenceImages.map(toImageUrl).join("\n")
      : undefined;

    const body: Record<string, unknown> = {
      model,
      prompt,
      ...(size && { size }),
      ...(referenceImages && { images: referenceImages }),
    };

    console.log(`[AtlasCloud] Submitting image task: model=${model}, size=${size ?? "default"}`);

    const submitRes = await fetch(`${this.mediaBaseUrl}/generateImage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(`AtlasCloud image submit failed: ${submitRes.status} ${errText}`);
    }

    const submit = (await submitRes.json()) as AtlasPredictionResponse;
    const taskId = submit.data?.id;
    if (!taskId) {
      throw new Error(`AtlasCloud: no task id in response: ${JSON.stringify(submit)}`);
    }
    console.log(`[AtlasCloud] Image task submitted: ${taskId}`);

    const outputs = await pollPrediction(this.mediaBaseUrl, this.apiKey, taskId, {
      maxAttempts: 60,
      interval: 4000,
      label: "image",
    });

    const imageUrl = outputs[0];
    if (!imageUrl) throw new Error("AtlasCloud: no image URL in completed result");

    const imageRes = await fetch(imageUrl);
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const filename = `${genId()}.png`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    return filepath;
  }
}

// ── Shared helpers (used by the video provider too) ────────────────────────────

// Accepts either a local file path or an http(s) URL; local paths become data URLs.
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

/**
 * Poll an Atlas Cloud prediction until it completes; returns the `outputs` array.
 * Used for both image and video generation (same async contract).
 */
export async function pollPrediction(
  mediaBaseUrl: string,
  apiKey: string,
  taskId: string,
  opts: { maxAttempts: number; interval: number; label: string },
): Promise<string[]> {
  for (let i = 0; i < opts.maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, opts.interval));

    const res = await fetch(`${mediaBaseUrl}/prediction/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      console.warn(`[AtlasCloud] Poll ${i + 1} (${opts.label}): HTTP ${res.status}, retrying…`);
      continue;
    }

    const result = (await res.json()) as AtlasPredictionResponse;
    const status = result.data?.status ?? "unknown";
    console.log(`[AtlasCloud] Poll ${i + 1} (${opts.label}): status=${status}`);

    if (status === "completed") {
      const outputs = result.data?.outputs ?? [];
      if (outputs.length === 0) {
        throw new Error(`AtlasCloud: completed but no outputs: ${JSON.stringify(result)}`);
      }
      return outputs;
    }
    if (status === "failed") {
      throw new Error(`AtlasCloud ${opts.label} generation failed: ${result.data?.error || "unknown"}`);
    }
    // processing → keep polling
  }

  throw new Error(`AtlasCloud ${opts.label} generation timed out`);
}
