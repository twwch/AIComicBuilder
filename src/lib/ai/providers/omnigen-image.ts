import type { AIProvider, TextOptions, ImageOptions } from "../types";
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

export class OmnigenImageProvider implements AIProvider {
  private baseUrl: string;
  private model: string;
  private uploadDir: string;
  private fnName: string;

  constructor(params?: {
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
    fnName?: string;
  }) {
    this.baseUrl = (
      params?.baseUrl ||
      process.env.OMNIGEN_BASE_URL ||
      "http://localhost:7860"
    ).replace(/\/+$/, "");
    this.model = params?.model || "OmniGen-v1";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    this.fnName = params?.fnName || "generate";
  }

  async generateText(_prompt: string, _options?: TextOptions): Promise<string> {
    throw new Error("OmniGen does not support text generation");
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
      throw new Error(`OmniGen image upload failed: ${res.status}`);
    }
    const result = (await res.json()) as Array<{ name: string; data: string }>;
    if (!result?.[0]?.data) {
      throw new Error(`OmniGen upload returned no data: ${JSON.stringify(result)}`);
    }
    return result[0].data;
  }

  buildOmnigenPrompt(
    prompt: string,
    options?: ImageOptions,
  ): string {
    const refs = (options?.referenceImages ?? []).slice(0, 6);
    const labels = (options?.referenceLabels ?? []).slice(0, 6);
    const roles = (options?.referenceRoles ?? []).slice(0, 6);

    // No references — pure txt2img
    if (refs.length === 0) return prompt;

    // Single editBaseImage + optional extra refs
    const baseImage = options?.editBaseImage;
    const isEdit = !!baseImage;

    // Build <img> token mappings
    let imgTokens = "";
    const refParts: string[] = [];

    if (isEdit) {
      // image_1 = base image for editing
      imgTokens = "<img><|image_1|></img>";
      refParts.push("base image");
    }

    let refIndex = isEdit ? 2 : 1; // OmniGen 1-indexed
    for (let i = 0; i < refs.length; i++) {
      // editBaseImage is also in referenceImages — deduplicate
      const isBase = baseImage && refs[i] === baseImage;
      if (isBase) continue;

      const token = `<img><|image_${refIndex}|></img>`;
      const label = labels[i] ? ` (${labels[i]})` : "";
      const role = roles[i] ? `[${roles[i]}]` : "";
      imgTokens += ` ${token}`;
      refParts.push(`${role}reference ${refIndex}${label}`);
      refIndex++;
    }

    if (isEdit) {
      return [
        prompt,
        imgTokens,
        ...(refParts.length > 0 ? [`References: ${refParts.join(", ")}.`] : []),
        "Edit the base image according to the instruction while preserving the identity and style of the references.",
      ].join("\n");
    }

    return [
      prompt,
      imgTokens,
      `References: ${refParts.join(", ")}.`,
      "Generate a coherent scene that integrates all reference elements naturally.",
    ].join("\n");
  }

  private async startGeneration(data: unknown[]): Promise<string> {
    const res = await fetch(`${this.apiBase()}/call/${this.fnName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OmniGen generation start failed: ${res.status} ${text}`);
    }
    const result = (await res.json()) as { event_id?: string };
    if (!result.event_id) {
      throw new Error(`OmniGen returned no event_id: ${JSON.stringify(result)}`);
    }
    return result.event_id;
  }

  parseSSE(text: string, eventId: string): GradioEvent[] {
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

  private async pollForImage(eventId: string): Promise<string> {
    const url = `${this.apiBase()}/call/${this.fnName}/${eventId}`;
    const maxDuration = 300_000; // 5 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxDuration) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        const text = await res.text();
        const events = this.parseSSE(text, eventId);

        for (const event of events) {
          if (event.type === "complete") {
            const imageData = event.data?.[0];
            if (imageData && typeof imageData === "object" && !Array.isArray(imageData)) {
              const obj = imageData as Record<string, unknown>;
              if (typeof obj.path === "string") return obj.path;
            }
            if (typeof imageData === "string") return imageData;
          }
        }
      } catch {
        // network error, retry
      }

      await new Promise((r) => setTimeout(r, 3000));
    }

    throw new Error("OmniGen generation timed out after 5 minutes");
  }

  private async downloadImage(imageRef: string): Promise<string> {
    let imageUrl: string;
    if (imageRef.startsWith("http")) {
      imageUrl = imageRef;
    } else if (imageRef.startsWith("/")) {
      imageUrl = `${this.baseUrl}${imageRef}`;
    } else {
      imageUrl = `${this.apiBase()}/file=${encodeURIComponent(imageRef)}`;
    }

    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      throw new Error(`OmniGen image download failed: ${res.status}`);
    }

    const filename = `${genId()}.png`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(res.body! as any, createWriteStream(filepath));

    return filepath;
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const refs = options?.referenceImages ?? [];
    const baseImage = options?.editBaseImage;

    // Upload all reference images
    const uploadedData: string[] = [];
    const uploadedPaths: string[] = [];

    if (baseImage && fs.existsSync(path.resolve(baseImage))) {
      const data = await this.uploadImage(baseImage);
      uploadedData.push(data);
      uploadedPaths.push(baseImage);
    }

    for (const ref of refs.slice(0, 6)) {
      const isBase = baseImage && ref === baseImage;
      if (isBase) continue;
      if (fs.existsSync(path.resolve(ref))) {
        const data = await this.uploadImage(ref);
        uploadedData.push(data);
        uploadedPaths.push(ref);
      }
    }

    const omnigenPrompt = this.buildOmnigenPrompt(prompt, options);

    const steps = 50;
    const guidanceScale = 2.5;
    const seed = -1;

    // Gradio function args: [prompt, input_image, ref1, ref2, ref3, steps, guidance, seed]
    const maxRefs = 3;
    const data: unknown[] = [omnigenPrompt];
    data.push(uploadedData[0] ?? null); // input image (null for txt2img)
    for (let i = 1; i <= maxRefs; i++) {
      data.push(uploadedData[i] ?? null);
    }
    data.push(steps, guidanceScale, seed);

    const eventId = await this.startGeneration(data);

    const imageRef = await this.pollForImage(eventId);

    const filepath = await this.downloadImage(imageRef);

    console.log(`[OmniGen] Saved: ${filepath} (refs=${refs.length}, prompt_len=${prompt.length})`);
    return filepath;
  }
}
