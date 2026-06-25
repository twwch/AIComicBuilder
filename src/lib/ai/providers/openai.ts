import OpenAI from "openai";
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";

const IMAGE_GENERATION_TIMEOUT_MS = 180_000;
const AIAPI_IMAGE_MODELS = new Set(["gpt-image-2", "gpt-image-2-2k", "gpt-image-2-4k"]);

type ImageItem = { url: string } | { b64Json: string };

function extractCauseMessage(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) return cause.message;
  if (cause) return String(cause);
  return undefined;
}

function normalizeOpenAIImageSize(model: string, size?: string): string | undefined {
  if (!size || !model.startsWith("gpt-image")) return size;
  if (size === "1024x1024" || size === "1536x1024" || size === "1024x1536" || size === "auto") {
    return size;
  }
  const [width, height] = size.split("x").map((part) => Number.parseInt(part, 10));
  if (Number.isFinite(width) && Number.isFinite(height)) {
    if (width > height) return "1536x1024";
    if (height > width) return "1024x1536";
  }
  return "1024x1024";
}

function isAIAPIImageEndpoint(baseURL: string | null | undefined, model: string): boolean {
  return AIAPI_IMAGE_MODELS.has(model) && Boolean(baseURL?.includes("aiapi.up.railway.app"));
}

function walkValues(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => walkValues(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => walkValues(item));
  }
  return [value];
}

function extractImageItems(result: unknown): ImageItem[] {
  const items: ImageItem[] = [];
  for (const value of walkValues(result)) {
    if (typeof value !== "string") continue;
    const text = value.trim();

    for (const match of text.matchAll(/data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=_\-\s]+/g)) {
      items.push({ b64Json: match[0] });
    }

    for (const match of text.matchAll(/https?:\/\/[^\s)'"<>]+/g)) {
      const url = match[0].replace(/[.,]+$/, "");
      if (/\.(png|jpe?g|webp)(\?|$)/i.test(url)) {
        items.push({ url });
      }
    }

    const maybeBase64 = text.startsWith("data:image/") && text.includes(",")
      ? text.split(",", 2)[1]
      : text;
    if (maybeBase64.length > 1000 && /^[A-Za-z0-9+/=_\-\s]+$/.test(maybeBase64)) {
      items.push({ b64Json: maybeBase64 });
    }
  }

  const deduped: ImageItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = "url" in item ? `url:${item.url}` : `b64:${item.b64Json.slice(0, 64)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function decodeBase64Image(data: string): Buffer {
  if (data.startsWith("data:image/") && data.includes(",")) {
    data = data.split(",", 2)[1];
  }
  data = data.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const remainder = data.length % 4;
  if (remainder) {
    data += "=".repeat(4 - remainder);
  }
  return Buffer.from(data, "base64");
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private defaultModel: string;
  private uploadDir: string;
  private apiKey: string;
  private baseURL?: string;

  constructor(params?: { apiKey?: string; baseURL?: string; model?: string; uploadDir?: string; }) {
    this.apiKey = params?.apiKey || process.env.OPENAI_API_KEY || "";
    this.baseURL = params?.baseURL || process.env.OPENAI_BASE_URL;
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    });
    this.defaultModel = params?.model || process.env.OPENAI_MODEL || "gpt-4o";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

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
        } catch { /* skip unreadable */ }
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

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const model = options?.model || this.defaultModel;
    if (isAIAPIImageEndpoint(this.baseURL, model)) {
      return this.generateAIAPIChatImage(prompt, model, options);
    }

    const isDallE = model.startsWith("dall-e");
    const isGptImage = model.startsWith("gpt-image");
    const normalizedSize = normalizeOpenAIImageSize(model, options?.size);

    // Build extra params for non-DALL-E OpenAI-compatible providers (e.g. seedream, doubao).
    // These APIs typically accept `size` as "WxH" and/or `aspect_ratio` as "W:H".
    const compatParams: Record<string, unknown> = {};
    if (!isDallE) {
      if (normalizedSize) compatParams.size = normalizedSize;
      if (options?.aspectRatio) compatParams.aspect_ratio = options.aspectRatio;
      if (!options?.size && !options?.aspectRatio) compatParams.aspect_ratio = "16:9";
      if (isGptImage) compatParams.response_format = "b64_json";
    }

    let response: OpenAI.ImagesResponse;
    try {
      response = await ((this.client.images.generate as unknown) as (
        params: Record<string, unknown>,
        requestOptions?: { maxRetries?: number; timeout?: number },
      ) => Promise<OpenAI.ImagesResponse>)(
        {
          model,
          prompt,
          ...(isDallE && {
            size: (["1024x1024", "1792x1024", "1024x1792"].includes(options?.size ?? "")
              ? options!.size
              : "1792x1024") as "1024x1024" | "1792x1024" | "1024x1792",
            quality: (options?.quality as "standard" | "hd") || "standard",
          }),
          ...compatParams,
          n: 1,
        },
        {
          maxRetries: 0,
          timeout: IMAGE_GENERATION_TIMEOUT_MS,
        },
      );
    } catch (err) {
      const cause = extractCauseMessage(err);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `OpenAI image request failed: ${message}${cause ? `; cause: ${cause}` : ""}`,
      );
    }

    const image = response.data?.[0];
    if (!image) {
      throw new Error(`No image returned from OpenAI: ${JSON.stringify(response)}`);
    }

    let buffer: Buffer;
    let ext: string = response.output_format || "png";
    if (image.b64_json) {
      buffer = Buffer.from(image.b64_json, "base64");
      ext = response.output_format || "png";
    } else if (image.url) {
      const imageResponse = await fetch(image.url);
      if (!imageResponse.ok) {
        throw new Error(`OpenAI image download failed: ${imageResponse.status}`);
      }
      buffer = Buffer.from(await imageResponse.arrayBuffer());
      ext = image.url.split("?")[0].split(".").pop() || ext;
    } else {
      throw new Error(`OpenAI image response has no URL or b64_json: ${JSON.stringify(response)}`);
    }

    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    return filepath;
  }

  private async generateAIAPIChatImage(
    prompt: string,
    model: string,
    options?: ImageOptions,
  ): Promise<string> {
    const baseURL = (this.baseURL || "https://aiapi.up.railway.app/v1").replace(/\/+$/, "");
    const normalizedSize = normalizeOpenAIImageSize(model, options?.size);
    const promptParts = [prompt];
    if (normalizedSize && normalizedSize !== "auto") {
      promptParts.push(`Required output canvas: ${normalizedSize} pixels.`);
    }
    if (options?.quality) {
      promptParts.push(`Quality target: ${options.quality}.`);
    }
    promptParts.push(
      "Return only a direct image URL in markdown or plain text. Do not return base64, data URLs, or inline image bytes.",
    );

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        n: 1,
        messages: [{ role: "user", content: promptParts.join("\n") }],
      }),
      signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS),
    }).catch((err: unknown) => {
      const cause = extractCauseMessage(err);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`AIAPI image chat request failed: ${message}${cause ? `; cause: ${cause}` : ""}`);
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`AIAPI image chat request failed: HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
    }

    const json = await response.json() as unknown;
    const image = extractImageItems(json)[0];
    if (!image) {
      throw new Error(`No image URL or base64 data found in AIAPI response: ${JSON.stringify(json)}`);
    }

    let buffer: Buffer;
    let ext = "png";
    if ("b64Json" in image) {
      buffer = decodeBase64Image(image.b64Json);
    } else {
      const imageResponse = await fetch(image.url, {
        signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS),
      });
      if (!imageResponse.ok) {
        throw new Error(`AIAPI image download failed: ${imageResponse.status}`);
      }
      buffer = Buffer.from(await imageResponse.arrayBuffer());
      ext = image.url.split("?")[0].split(".").pop() || ext;
    }

    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    return filepath;
  }
}
