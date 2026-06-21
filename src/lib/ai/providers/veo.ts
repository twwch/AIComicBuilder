// src/lib/ai/providers/veo.ts
import { GoogleGenAI } from "@google/genai";
import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";

const VALID_DURATIONS = [4, 6, 8] as const;

function clampDuration(duration: number): number {
  return VALID_DURATIONS.reduce((prev, curr) =>
    Math.abs(curr - duration) < Math.abs(prev - duration) ? curr : prev
  );
}

function toAspectRatio(ratio?: string): "16:9" | "9:16" {
  if (ratio === "9:16") return "9:16";
  return "16:9";
}

function readImageData(filePath: string): { imageBytes: string; mimeType: string } {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === ".png" ? "image/png" :
    ext === ".webp" ? "image/webp" :
    "image/jpeg";
  const imageBytes = fs.readFileSync(filePath, { encoding: "base64" });
  return { imageBytes, mimeType };
}

export class VeoProvider implements VideoProvider {
  private client: GoogleGenAI;
  private model: string;
  private uploadDir: string;

  constructor(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
    const options: ConstructorParameters<typeof GoogleGenAI>[0] = {
      apiKey: params?.apiKey || process.env.GEMINI_API_KEY || "",
    };
    if (params?.baseUrl) {
      const baseUrl = params.baseUrl.replace(/\/+$/, "").replace(/\/v\d[^/]*$/, "");
      options.httpOptions = { baseUrl };
    }
    this.client = new GoogleGenAI(options);
    this.model = params?.model || "veo-2.0-generate-001";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  private isVeo31(): boolean {
    return this.model.includes("3.1") || this.model.includes("3-1");
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const durationSeconds = clampDuration(params.duration);
    const aspectRatio = toAspectRatio(params.ratio);

    const isKeyframe = "firstFrame" in params && !!params.firstFrame;
    const isReference = "initialImage" in params && !!params.initialImage;
    const hasCharRefImages = params.referenceImages && params.referenceImages.length > 0;
    const canUseReferenceImages = this.isVeo31() && hasCharRefImages;

    // Reference mode + Veo 3.1: use referenceImages API (no image/firstFrame)
    // Reference mode + non-3.1: fall back to image-to-video (initialImage as firstFrame)
    // Keyframe mode: always use image + optional lastFrame
    if (isReference && canUseReferenceImages) {
      return this.generateWithReferenceImages(params, durationSeconds, aspectRatio);
    }

    // image-to-video mode
    if (!isKeyframe && !isReference) {
      throw new Error("Veo requires an image input (firstFrame or initialImage)");
    }

    const imageSource = isKeyframe ? params.firstFrame! : (params as { initialImage: string }).initialImage;
    const imageData = readImageData(imageSource);

    const config: Record<string, unknown> = {
      durationSeconds,
      aspectRatio,
    };

    // lastFrame only supported by Veo 2.x and 3.1+, NOT Veo 3.0
    const isVeo30 = this.model.includes("3.0") || this.model.includes("3-0");
    if (isKeyframe && params.lastFrame && !isVeo30) {
      config.lastFrame = readImageData(params.lastFrame);
    }

    const modeLabel = isKeyframe ? "keyframe" : "image2video";
    console.log(`[Veo] mode=${modeLabel}, model=${this.model}, duration=${durationSeconds}s, ratio=${aspectRatio}`);

    const operation = await this.client.models.generateVideos({
      model: this.model,
      prompt: params.prompt,
      image: imageData,
      config,
    });

    return this.finishGeneration(operation);
  }

  /**
   * Veo 3.1 referenceImages mode:
   * - No `image` param (not image-to-video)
   * - Character ref images go in config.referenceImages
   * - Scene ref frame also goes as a referenceImage (to guide composition)
   * - Duration locked to 8s
   */
  private async generateWithReferenceImages(
    params: VideoGenerateParams,
    durationSeconds: number,
    aspectRatio: "16:9" | "9:16"
  ): Promise<VideoGenerateResult> {
    const initialImage = (params as { initialImage: string }).initialImage;

    // Build reference images: scene frame + character refs (max 3 total)
    const allRefPaths = [initialImage, ...(params.referenceImages ?? [])].slice(0, 3);
    const referenceImages = allRefPaths.map((imgPath) => ({
      image: readImageData(imgPath),
      referenceType: "asset" as const,
    }));

    // referenceImages requires duration=8
    const config: Record<string, unknown> = {
      durationSeconds: 8,
      aspectRatio,
      referenceImages,
    };

    console.log(`[Veo] mode=referenceImages, model=${this.model}, refCount=${referenceImages.length}, ratio=${aspectRatio}`);

    const operation = await this.client.models.generateVideos({
      model: this.model,
      prompt: params.prompt,
      config,
    });

    return this.finishGeneration(operation);
  }

  private async finishGeneration(
    operation: Awaited<ReturnType<GoogleGenAI["models"]["generateVideos"]>>
  ): Promise<VideoGenerateResult> {
    operation = await this.pollForResult(operation);

    const response = operation.response;

    if ((response?.raiMediaFilteredCount ?? 0) > 0) {
      throw new Error(
        `Veo generation blocked by safety filter: ${JSON.stringify(response?.raiMediaFilteredReasons)}`
      );
    }

    if (!response?.generatedVideos?.[0]) {
      throw new Error("No video returned from Veo");
    }
    const videoFile = response.generatedVideos[0].video;
    if (!videoFile) {
      throw new Error("No video URI returned from Veo");
    }

    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const downloadPath = path.join(dir, `${genId()}.mp4`);

    await this.client.files.download({ file: videoFile, downloadPath });

    console.log(`[Veo] Video saved to ${downloadPath}`);
    return { filePath: downloadPath };
  }

  private async pollForResult(
    initial: Awaited<ReturnType<GoogleGenAI["models"]["generateVideos"]>>
  ): Promise<typeof initial> {
    const maxAttempts = 60;
    let operation = initial;

    for (let i = 0; i < maxAttempts; i++) {
      console.log(`[Veo] Poll ${i + 1}: done=${operation.done}`);

      if (operation.done) {
        if (operation.error) {
          throw new Error(`Veo generation failed: ${JSON.stringify(operation.error)}`);
        }
        return operation;
      }

      await new Promise((resolve) => setTimeout(resolve, 10_000));
      operation = await this.client.operations.getVideosOperation({ operation });
    }

    throw new Error("Veo generation timed out after 10 minutes");
  }
}
