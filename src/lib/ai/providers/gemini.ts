import { GoogleGenAI } from "@google/genai";
import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";

export class GeminiProvider implements AIProvider {
  private client: GoogleGenAI;
  private defaultModel: string;
  private uploadDir: string;

  constructor(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string; }) {
    const options: ConstructorParameters<typeof GoogleGenAI>[0] = {
      apiKey: params?.apiKey || process.env.GEMINI_API_KEY || "",
    };
    if (params?.baseUrl) {
      // Strip trailing path segments like /v1, /v1beta — SDK appends /v1beta automatically
      const baseUrl = params.baseUrl.replace(/\/+$/, "").replace(/\/v\d[^/]*$/, "");
      options.httpOptions = { baseUrl };
    }
    this.client = new GoogleGenAI(options);
    this.defaultModel = params?.model || "gemini-2.0-flash";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(prompt: string, options?: TextOptions): Promise<string> {
    const model = options?.model || this.defaultModel;

    type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
    const parts: Part[] = [];

    if (options?.images?.length) {
      for (const imgPath of options.images) {
        try {
          const resolved = path.resolve(imgPath);
          if (fs.existsSync(resolved)) {
            const data = fs.readFileSync(resolved).toString("base64");
            const ext = path.extname(resolved).toLowerCase();
            const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
            parts.push({ inlineData: { mimeType, data } });
          }
        } catch { /* skip */ }
      }
    }
    parts.push({ text: prompt });

    const response = await this.client.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens,
        systemInstruction: options?.systemPrompt,
      },
    });
    return response.text || "";
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const model = options?.model || this.defaultModel;

    // Build multimodal parts: reference images + text prompt
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    // Attach reference images (character sheets, first frame, etc.)
    const geminiRefs = (options?.referenceImages ?? []).slice(0, 6);
    const geminiLabels = (options?.referenceLabels ?? []).slice(0, 6);
    if (geminiRefs.length > 0) {
      let imgIndex = 0;
      for (let ri = 0; ri < geminiRefs.length; ri++) {
        const imgPath = geminiRefs[ri];
        try {
          const resolved = path.resolve(imgPath);
          if (fs.existsSync(resolved)) {
            const data = fs.readFileSync(resolved).toString("base64");
            const ext = path.extname(resolved).toLowerCase();
            const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
            imgIndex++;
            const label = geminiLabels[ri]
              ? `[Character Reference: ${geminiLabels[ri]}]`
              : `[Reference Image ${imgIndex}]`;
            parts.push({ text: label });
            parts.push({ inlineData: { mimeType, data } });
          }
        } catch {
          // Skip unreadable images
        }
      }
      if (imgIndex > 0) {
        parts.push({ text: `\n[END OF REFERENCE IMAGES — ${imgIndex} character sheets total]
CRITICAL CHARACTER CONSISTENCY RULES:
- Each reference image is a CHARACTER SHEET (turnaround view) showing FRONT, THREE-QUARTER, SIDE PROFILE, and BACK views
- The character's NAME is printed at the bottom of each reference sheet — use it to match characters in the scene
- You MUST reproduce EXACTLY: face shape, hairstyle, hair color, clothing design, clothing colors, accessories, body proportions
- CLOTHING MUST NOT CHANGE — if the reference shows 深青色交领常服, the character MUST wear 深青色交领常服 in the generated frame, NOT 龙袍 or any other outfit
- If a character's reference shows specific accessories (帽子, 佩刀, 发簪), they MUST appear in the generated frame
- Art style must match the reference images exactly

` + prompt });
      } else {
        parts.push({ text: prompt });
      }
    } else {
      parts.push({ text: prompt });
    }

    const response = await this.client.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: { responseModalities: ["image", "text"] },
    });

    const responseParts = response.candidates?.[0]?.content?.parts;
    if (!responseParts) throw new Error("No image returned from Gemini");

    for (const part of responseParts) {
      if (part.inlineData?.data) {
        const buffer = Buffer.from(part.inlineData.data, "base64");
        const ext = part.inlineData.mimeType?.includes("png") ? "png" : "jpg";
        const filename = `${genId()}.${ext}`;
        const dir = path.join(this.uploadDir, "frames");
        fs.mkdirSync(dir, { recursive: true });
        const filepath = path.join(dir, filename);
        fs.writeFileSync(filepath, buffer);
        return filepath;
      }
    }
    throw new Error("No image data found in Gemini response");
  }
}
