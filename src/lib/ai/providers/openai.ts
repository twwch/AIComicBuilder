import OpenAI from "openai";
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { sanitizeImagePromptText } from "@/lib/ai/prompts/frame-context";

function normalizeBaseUrl(url?: string): string {
  const cleaned = (url || "https://api.openai.com/v1").replace(/\/+$/, "");
  if (cleaned.endsWith("/v1")) return cleaned;
  return `${cleaned}/v1`;
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

  const markdownMatch = trimmed.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/);
  if (markdownMatch) {
    return { url: markdownMatch[1] };
  }

  const directUrlMatch = trimmed.match(/https?:\/\/[^\s)]+/);
  if (directUrlMatch) {
    return { url: directUrlMatch[0] };
  }

  return null;
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private apiKey: string;
  private baseURL: string;
  private defaultTextModel: string;
  private defaultImageModel: string;
  private fallbackImageModel: string;
  private uploadDir: string;

  constructor(params?: { apiKey?: string; baseURL?: string; model?: string; uploadDir?: string; }) {
    this.apiKey = params?.apiKey || process.env.OPENAI_API_KEY || "";
    this.baseURL = normalizeBaseUrl(params?.baseURL || process.env.OPENAI_BASE_URL);
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    });
    this.defaultTextModel = params?.model || process.env.OPENAI_MODEL || "gpt-4o";
    this.defaultImageModel = params?.model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
    this.fallbackImageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(prompt: string, options?: TextOptions): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await this.client.chat.completions.create({
      model: options?.model || this.defaultTextModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    });

    return response.choices[0]?.message?.content || "";
  }

  private getCandidateModels(model: string): string[] {
    return [model, this.fallbackImageModel].filter(
      (candidate, index, all) => candidate && all.indexOf(candidate) === index
    );
  }

  private dedupeAttempts(attempts: Array<Record<string, unknown>>) {
    return attempts.filter(
      (attempt, index, all) =>
        all.findIndex((candidate) => compactJSON(candidate) === compactJSON(attempt)) === index
    );
  }

  private buildImageAttempts(
    model: string,
    prompt: string,
    size: string,
    quality: string
  ): Array<Record<string, unknown>> {
    return this.dedupeAttempts([
      { model, prompt, n: 1, size, quality },
      { model, prompt, n: 1, response_format: "b64_json" },
      { model, prompt, n: 1 },
      { model, prompt },
    ]);
  }

  private buildChatImageAttempts(model: string, prompt: string): Array<Record<string, unknown>> {
    const systemPrompt =
      "Generate the requested image. Return the image using your native image output format. If your implementation cannot embed image output directly, return only the final image URL or base64 image data without extra commentary.";

    return this.dedupeAttempts([
      {
        model,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      },
      {
        model,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
          },
        ],
      },
      {
        model,
        stream: false,
        messages: [{ role: "user", content: prompt }],
      },
      {
        model,
        stream: false,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
          },
        ],
      },
    ]);
  }

  private async requestImageGeneration(
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseURL}/images/generations`, {
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
          `Image generation failed (${response.status}): ${rawText.slice(0, 400)}`
        );
      }
      throw new Error(`Image generation returned non-JSON response: ${rawText.slice(0, 400)}`);
    }

    if (!response.ok) {
      const errorMessage =
        typeof json?.error === "object" &&
        json.error &&
        "message" in json.error &&
        typeof json.error.message === "string"
          ? json.error.message
          : compactJSON(json);
      throw new Error(`Image generation failed (${response.status}): ${errorMessage}`);
    }

    return json;
  }

  private async requestChatImageGeneration(
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
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
          `Chat image generation failed (${response.status}): ${rawText.slice(0, 400)}`
        );
      }
      throw new Error(
        `Chat image generation returned non-JSON response: ${rawText.slice(0, 400)}`
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
      throw new Error(`Chat image generation failed (${response.status}): ${errorMessage}`);
    }

    return json;
  }

  private extractImagePayload(result: Record<string, unknown>): {
    url?: string;
    b64?: string;
  } | null {
    const choices = Array.isArray(result.choices) ? (result.choices as unknown[]) : null;
    const firstChoice =
      choices && choices.length > 0 && typeof choices[0] === "object" && choices[0] !== null
        ? (choices[0] as Record<string, unknown>)
        : null;
    const message =
      typeof firstChoice?.message === "object" && firstChoice.message !== null
        ? (firstChoice.message as Record<string, unknown>)
        : null;
    const messageContent = Array.isArray(message?.content)
      ? (message.content as unknown[])
      : null;
    const messageContentParts = Array.isArray(message?.content_parts)
      ? (message.content_parts as unknown[])
      : null;
    const messageImages = Array.isArray(message?.images)
      ? (message.images as unknown[])
      : null;
    const nestedResult =
      typeof result.result === "object" && result.result !== null
        ? (result.result as Record<string, unknown>)
        : null;
    const nestedResultData = Array.isArray(nestedResult?.data)
      ? (nestedResult.data as unknown[])
      : null;

    const candidates: unknown[] = [
      result,
      result.data,
      Array.isArray(result.data) ? result.data[0] : null,
      result.choices,
      firstChoice,
      message,
      message?.content ?? null,
      messageContent,
      messageContent ? messageContent[0] : null,
      message?.content_parts ?? null,
      messageContentParts,
      messageContentParts ? messageContentParts[0] : null,
      message?.images ?? null,
      messageImages,
      messageImages ? messageImages[0] : null,
      message?.image_url ?? null,
      result.result,
      nestedResult?.data ?? null,
      nestedResultData ? nestedResultData[0] : null,
      result.output,
      Array.isArray(result.output) ? result.output[0] : null,
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;

      if (typeof candidate === "string") {
        const parsed = extractImagePayloadFromString(candidate);
        if (parsed) {
          return parsed;
        }
        try {
          const parsedJSON = JSON.parse(candidate) as Record<string, unknown>;
          const nestedPayload = this.extractImagePayload(parsedJSON);
          if (nestedPayload) return nestedPayload;
        } catch {
          // Ignore plain text that is not JSON.
        }
      }

      if (typeof candidate !== "object") continue;
      const record = candidate as Record<string, unknown>;

      const url = record.url;
      if (typeof url === "string" && url) {
        return extractImagePayloadFromString(url) || { url };
      }

      const nestedImageUrl = record.image_url;
      if (typeof nestedImageUrl === "string" && nestedImageUrl) {
        return extractImagePayloadFromString(nestedImageUrl) || { url: nestedImageUrl };
      }

      if (typeof nestedImageUrl === "object" && nestedImageUrl !== null) {
        const nestedUrl = (nestedImageUrl as Record<string, unknown>).url;
        if (typeof nestedUrl === "string" && nestedUrl) {
          return extractImagePayloadFromString(nestedUrl) || { url: nestedUrl };
        }
      }

      for (const key of ["b64_json", "base64", "image_base64", "image", "data"]) {
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
    const model = options?.model || this.defaultImageModel;
    const isGptImageModel = model.startsWith("gpt-image");
    const requestedSize = options?.size || "1024x1024";
    const requestedQuality = options?.quality || "standard";

    const size = isGptImageModel
      ? requestedSize === "1792x1024"
        ? "1536x1024"
        : requestedSize === "1024x1792"
          ? "1024x1536"
          : requestedSize
      : requestedSize;

    const quality = isGptImageModel
      ? requestedQuality === "hd"
        ? "high"
        : "medium"
      : requestedQuality;

    const filename = `${ulid()}.png`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);

    const errors: string[] = [];

    for (const currentModel of this.getCandidateModels(model)) {
      const endpointAttempts = [
        ...this.buildImageAttempts(currentModel, sanitizedPrompt, size, quality).map((body) => ({
          endpoint: "images",
          body,
        })),
        ...this.buildChatImageAttempts(currentModel, sanitizedPrompt).map((body) => ({
          endpoint: "chat",
          body,
        })),
      ];

      for (const attempt of endpointAttempts) {
        try {
          const response =
            attempt.endpoint === "images"
              ? await this.requestImageGeneration(attempt.body)
              : await this.requestChatImageGeneration(attempt.body);
          const payload = this.extractImagePayload(response);

          if (payload?.url) {
            const imageResponse = await fetch(payload.url);
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
            `Attempt ${errors.length + 1} [${attempt.endpoint}] returned no image payload. Request: ${compactJSON(attempt.body)} Response: ${compactJSON(response)}`
          );
        } catch (error) {
          errors.push(
            `Attempt ${errors.length + 1} [${attempt.endpoint}] failed. Request: ${compactJSON(attempt.body)} Error: ${String(error)}`
          );
        }
      }
    }

    throw new Error(`No usable image payload returned from OpenAI-compatible image API.\n${errors.join("\n")}`);
  }
}
