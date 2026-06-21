import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import crypto from "node:crypto";
import { id as genId } from "@/lib/id";

function generateKlingToken(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

interface KlingResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface KlingTaskData {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg: string;
  task_result: {
    images?: { url: string }[];
  };
}

export class KlingImageProvider implements AIProvider {
  private apiKey: string;
  private secretKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    secretKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.apiKey = params?.apiKey || process.env.KLING_ACCESS_KEY || "";
    this.secretKey = params?.secretKey || process.env.KLING_SECRET_KEY || "";
    this.baseUrl = (params?.baseUrl || "https://api.klingai.com").replace(/\/+$/, "");
    this.model = params?.model || "kling-v1";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  private getAuthHeader(): string {
    if (this.secretKey) {
      return `Bearer ${generateKlingToken(this.apiKey, this.secretKey)}`;
    }
    return `Bearer ${this.apiKey}`;
  }

  async generateText(_prompt: string, _options?: TextOptions): Promise<string> {
    throw new Error("Kling does not support text generation");
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    // Submit task
    const submitRes = await fetch(`${this.baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        n: 1,
        aspect_ratio: options?.aspectRatio || "16:9",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitRes.ok) {
      throw new Error(`Kling image submit failed: ${submitRes.status}`);
    }

    const submitJson = (await submitRes.json()) as KlingResponse<{ task_id: string }>;
    if (submitJson.code !== 0) {
      throw new Error(`Kling image error: ${submitJson.message}`);
    }

    const taskId = submitJson.data.task_id;
    console.log(`[Kling Image] Task submitted: ${taskId}`);

    // Poll for result
    const imageUrl = await this.pollForResult(taskId);

    // Download to local storage
    const imageRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
    const ext = imageUrl.split("?")[0].split(".").pop() || "png";
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(imageRes.body! as any, createWriteStream(filepath));

    console.log(`[Kling Image] Saved to ${filepath}`);
    return filepath;
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 60;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      const res = await fetch(`${this.baseUrl}/v1/images/generations/${taskId}`, {
        headers: { Authorization: this.getAuthHeader() },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        throw new Error(`Kling image poll failed: ${res.status}`);
      }

      const json = (await res.json()) as KlingResponse<KlingTaskData>;

      if (json.code !== 0) {
        throw new Error(`Kling image poll error: ${json.message}`);
      }

      const { task_status, task_status_msg, task_result } = json.data;
      console.log(`[Kling Image] Poll ${i + 1}: status=${task_status}`);

      if (task_status === "succeed") {
        const url = task_result.images?.[0]?.url;
        if (!url) throw new Error("Kling image: no URL in result");
        return url;
      }

      if (task_status === "failed") {
        throw new Error(`Kling image generation failed: ${task_status_msg}`);
      }
    }

    throw new Error("Kling image generation timed out after 5 minutes");
  }
}
