import OpenAI from "openai";
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";

function toErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.message;
}

function summarizeError(err: unknown) {
  if (!(err instanceof Error)) {
    return { raw: String(err) };
  }

  const e = err as Error & {
    status?: number;
    code?: string;
    type?: string;
    param?: string;
    headers?: unknown;
    request_id?: string;
    error?: unknown;
    cause?: unknown;
  };

  return {
    name: e.name,
    message: e.message,
    status: e.status,
    code: e.code,
    type: e.type,
    param: e.param,
    request_id: e.request_id,
    headers: e.headers,
    error: e.error,
    cause: e.cause,
    stack: e.stack,
  };
}

function supportsVisionChat(baseURL?: string, model?: string): boolean {
  const url = (baseURL || "").toLowerCase();
  const modelId = (model || "").toLowerCase();

  if (url.includes("api.deepseek.com")) return false;
  if (url.includes("integrate.api.nvidia.com") && modelId.includes("kimi")) return false;

  // SenseNova image-generation models are not chat models.
  if (url.includes("sensenova.cn") && modelId.includes("u1-fast")) return false;

  return true;
}

function isSenseNova(baseURL?: string): boolean {
  return (baseURL || "").toLowerCase().includes("sensenova.cn");
}

function isSenseNovaImageModel(model?: string): boolean {
  const modelId = (model || "").toLowerCase();
  return modelId.includes("u1-fast");
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private imageClient: OpenAI;
  private defaultModel: string;
  private uploadDir: string;
  private baseURL: string;
  private isNvidia: boolean;

  constructor(params?: { apiKey?: string; baseURL?: string; model?: string; uploadDir?: string; }) {
    this.baseURL = params?.baseURL || process.env.OPENAI_BASE_URL || "";
    this.isNvidia = this.baseURL.includes("integrate.api.nvidia.com");
    const timeout = this.isNvidia ? 600_000 : 600_000;
    this.client = new OpenAI({
      apiKey: params?.apiKey || process.env.OPENAI_API_KEY,
      baseURL: this.baseURL,
      timeout,
      maxRetries: 0,
    });
    this.imageClient = new OpenAI({
      apiKey: params?.apiKey || process.env.IMAGEGEN_API_KEY || process.env.OPENAI_API_KEY,
      baseURL: params?.baseURL || process.env.IMAGEGEN_BASE_URL || this.baseURL,
      timeout,
      maxRetries: 0,
    });
    this.defaultModel = params?.model || process.env.OPENAI_MODEL || "gpt-4o";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  private saveImageBuffer(buffer: Buffer, ext = "png"): string {
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  private async fetchImageToFile(url: string): Promise<string> {
    console.log("[OpenAIProvider:image] downloading generated image", { url });
    const imageResponse = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!imageResponse.ok) {
      const body = await imageResponse.text().catch(() => "");
      throw new Error(`Failed to download generated image: ${imageResponse.status} ${body}`);
    }
    const contentType = imageResponse.headers.get("content-type") || "";
    const ext = contentType.includes("jpeg") ? "jpg" : "png";
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(imageResponse.body! as any, createWriteStream(filepath));
    return filepath;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const maxAttempts = this.isNvidia ? 5 : 1;
    let lastErr: unknown;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number })?.status;
        if (status === 429 && i < maxAttempts - 1) {
          const delay = Math.min(2000 * 2 ** i, 30_000);
          console.warn(`[OpenAIProvider] rate limited (429), retry ${i + 1}/${maxAttempts} after ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  async generateText(prompt: string, options?: TextOptions): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const model = options?.model || this.defaultModel;
    const canSendImages = supportsVisionChat(this.client.baseURL, model);
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }

    if (options?.images?.length && canSendImages) {
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
      let textPrompt = prompt;
      if (options?.images?.length && !canSendImages) {
        textPrompt = `${prompt}\n\n[System note: The current text model does not support image inputs. Ignore any image-index references and generate the best possible result from the text context only.]`;
      }
      messages.push({ role: "user", content: textPrompt });
    }

    return this.withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
      });
      return response.choices[0]?.message?.content || "";
    });
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const model = options?.model || this.defaultModel;

    // SenseNova image models use /v1/images/generations rather than Responses API.
    if (isSenseNova(this.imageClient.baseURL) && isSenseNovaImageModel(model)) {
      console.log("[OpenAIProvider:image] SenseNova image request", {
        baseUrl: String(this.imageClient.baseURL),
        model,
        promptLength: prompt.length,
        hasSize: Boolean(options?.size),
        size: options?.size,
        aspectRatio: options?.aspectRatio,
        quality: options?.quality,
      });
      try {
        const response = await ((this.imageClient.images.generate as unknown) as (params: Record<string, unknown>) => Promise<OpenAI.ImagesResponse>)({
          model,
          prompt,
          n: 1,
        });

        console.log("[OpenAIProvider:image] SenseNova image response summary", {
          dataLength: Array.isArray(response.data) ? response.data.length : -1,
          firstUrl: response.data?.[0]?.url,
          firstB64Length: response.data?.[0]?.b64_json?.length,
          revisedPrompt: (response.data?.[0] as { revised_prompt?: string } | undefined)?.revised_prompt,
        });

        const imageUrl = response.data?.[0]?.url;
        if (!imageUrl) {
          throw new Error(`No image URL returned from SenseNova images API: ${JSON.stringify(response)}`);
        }
        return await this.fetchImageToFile(imageUrl);
      } catch (err) {
        console.error("[OpenAIProvider:image] SenseNova image generation failed", summarizeError(err));
        throw err;
      }
    }

    // gpt-image-2: use standard Image API (/v1/images/generations)
    if (model === "gpt-image-2") {
      let lastError: unknown;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const resp = await this.imageClient.images.generate({
            model,
            prompt,
            n: 1,
            response_format: "b64_json",
          });

          const data = resp.data?.[0];
          if (data?.b64_json) {
            return this.saveImageBuffer(Buffer.from(data.b64_json, "base64"), "png");
          }
          if (data?.url) {
            return await this.fetchImageToFile(data.url);
          }

          throw new Error(`No image data returned from images/generations: ${JSON.stringify(resp)}`);
        } catch (err) {
          lastError = err;
          console.error(`[OpenAIProvider:gpt-image-2] attempt ${attempt} failed: ${toErrorMessage(err)}`);
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          }
        }
      }

      throw new Error(`gpt-image-2 generation failed after 3 attempts: ${toErrorMessage(lastError)}`);
    }

    const isDallE = model.startsWith("dall-e");
    const compatParams: Record<string, unknown> = {};
    if (!isDallE) {
      if (options?.size) compatParams.size = options.size;
      if (options?.aspectRatio) compatParams.aspect_ratio = options.aspectRatio;
      if (!options?.size && !options?.aspectRatio) compatParams.aspect_ratio = "16:9";
    }

    return this.withRetry(async () => {
      const response = await ((this.imageClient.images.generate as unknown) as (params: Record<string, unknown>) => Promise<OpenAI.ImagesResponse>)({
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
      });

      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) throw new Error("No image URL returned from OpenAI");

      return await this.fetchImageToFile(imageUrl);
    });
  }
}
