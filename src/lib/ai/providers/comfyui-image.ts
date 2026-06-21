import type { AIProvider, TextOptions, ImageOptions, WorkflowFamily } from "../types";
import fs, { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { id as genId } from "@/lib/id";
import { preflightWorkflow } from "@/lib/comfyui/preflight";
import { ErrorCodes } from "@/lib/comfyui/errors";
import { ERNIE_IMAGE_API_PROMPT } from "./_workflows/ernie-image-api";

type ComfyPromptResponse = {
  prompt_id?: string;
  error?: string;
};

type ComfyHistoryRecord = {
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>;
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: Array<[string, { message?: string }]>;
  };
};

type UploadedImageInfo = {
  name: string;
};

function ratioToImageSize(ratio?: string): { width: number; height: number } {
  switch (ratio) {
    case "16:9":
      return { width: 1536, height: 1024 };
    case "9:16":
      return { width: 1024, height: 1536 };
    case "4:3":
      return { width: 1024, height: 768 };
    case "3:4":
      return { width: 768, height: 1024 };
    case "1:1":
    default:
      return { width: 1024, height: 1024 };
  }
}

function ratioToHiDreamO1Size(ratio?: string): { width: number; height: number } {
  switch (ratio) {
    case "16:9":
      return { width: 2560, height: 1440 };
    case "9:16":
      return { width: 1440, height: 2560 };
    case "4:3":
      return { width: 2304, height: 1728 };
    case "3:4":
      return { width: 1728, height: 2304 };
    case "3:2":
      return { width: 2496, height: 1664 };
    case "2:3":
      return { width: 1664, height: 2496 };
    case "1:1":
    default:
      return { width: 2048, height: 2048 };
  }
}

function ratioToErnieImageSize(ratio?: string): { width: number; height: number } {
  switch (ratio) {
    case "16:9":
      return { width: 1376, height: 768 };
    case "9:16":
      return { width: 768, height: 1376 };
    case "4:3":
      return { width: 1200, height: 896 };
    case "3:4":
      return { width: 896, height: 1200 };
    case "3:2":
      return { width: 1264, height: 848 };
    case "2:3":
      return { width: 848, height: 1264 };
    case "1:1":
    default:
      return { width: 1024, height: 1024 };
  }
}

function isErnieTurboModel(modelId: string): boolean {
  return /ernie[-_]?image[-_]?turbo/i.test(modelId);
}

export class ComfyUIImageProvider implements AIProvider {
  private baseUrl: string;
  private model: string;
  private uploadDir: string;
  private authToken?: string;
  private authCookie?: string;
  private _workflowFamilyCache?: WorkflowFamily;

  constructor(params?: { baseUrl?: string; model?: string; uploadDir?: string; authToken?: string; authCookie?: string }) {
    this.baseUrl = (params?.baseUrl || process.env.COMFYUI_BASE_URL || "https://2wdf3izjfh-8188.cnb.run/").replace(/\/+$/, "");
    this.model = params?.model || process.env.COMFYUI_MODEL || "hidream-o1-comfyui";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    this.authToken = params?.authToken || process.env.COMFYUI_AUTH_TOKEN;
    this.authCookie = params?.authCookie || process.env.COMFYUI_AUTH_COOKIE;
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.authToken) headers["Authorization"] = `Bearer ${this.authToken}`;
    if (this.authCookie) headers["Cookie"] = this.authCookie;
    return headers;
  }

  async generateText(_prompt: string, _options?: TextOptions): Promise<string> {
    throw new Error("ComfyUI image provider does not support text generation");
  }

  private async uploadImage(imagePath: string): Promise<UploadedImageInfo> {
    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
    const form = new FormData();
    const filename = path.basename(imagePath);
    form.append("image", new Blob([fs.readFileSync(imagePath)], { type: mime }), filename);
    form.append("type", "input");
    form.append("overwrite", "true");

    const res = await fetch(`${this.baseUrl}/upload/image`, {
      method: "POST",
      body: form,
      headers: this.getAuthHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ComfyUI image upload failed: ${res.status} ${text}`);
    }

    return { name: filename };
  }

  private buildReferenceBoardPrompt(
    prompt: string,
    labels: string[],
    roles: string[],
  ): string {
    if (labels.length === 0) return prompt;

    const lines = labels.map((label, index) => {
      const role = roles[index] || "reference";
      return `Reference ${index + 1} (${role}): ${label}`;
    });

    return [
      prompt,
      "",
      "Use the uploaded multi-reference images as strict visual anchors.",
      ...lines,
      "Preserve identity, costume, pose intent, scene style, and lighting where those reference roles apply.",
    ].join("\n");
  }

  private buildQwenEditWorkflow(
    prompt: string,
    options: ImageOptions | undefined,
    uploadedBaseImage: UploadedImageInfo,
    uploadedReferences: UploadedImageInfo[],
  ): Record<string, unknown> {
    const size = ratioToImageSize(options?.aspectRatio);
    const labels = options?.referenceLabels ?? [];
    const roles = options?.referenceRoles ?? [];
    const finalPrompt = this.buildReferenceBoardPrompt(prompt, labels, roles);
    const secondaryReference = uploadedReferences[0]?.name ?? uploadedBaseImage.name;

    return {
      "36": {
        inputs: {
          prompt: "Describe the key features of the input image and apply the requested edit while preserving the identity and reference consistency.",
          clip: ["223", 0],
          vae: ["221", 2],
        },
        class_type: "TextEncodeQwenImageEditPlus",
      },
      "37": {
        inputs: {
          prompt: finalPrompt,
          clip: ["223", 0],
          vae: ["221", 2],
          image1: ["50", 0],
          image2: ["54", 0],
        },
        class_type: "TextEncodeQwenImageEditPlus",
      },
      "38": {
        inputs: {
          samples: ["46", 0],
          vae: ["221", 2],
        },
        class_type: "VAEDecode",
      },
      "46": {
        inputs: {
          seed: Math.floor(Math.random() * 1_000_000_000_000_000),
          steps: 6,
          cfg: 1,
          sampler_name: "euler_ancestral",
          scheduler: "beta57",
          denoise: 1,
          model: ["222", 0],
          positive: ["37", 0],
          negative: ["36", 0],
          latent_image: ["248", 2],
        },
        class_type: "KSampler",
      },
      "49": {
        inputs: { image: uploadedBaseImage.name },
        class_type: "LoadImage",
      },
      "50": {
        inputs: {
          upscale_method: "lanczos",
          megapixels: 2,
          resolution_steps: 1,
          image: ["49", 0],
        },
        class_type: "ImageScaleToTotalPixels",
      },
      "54": {
        inputs: {
          upscale_method: "lanczos",
          megapixels: 1,
          resolution_steps: 1,
          image: ["246", 0],
        },
        class_type: "ImageScaleToTotalPixels",
      },
      "102": {
        inputs: {
          filename_prefix: "qwen-edit-storyboard",
          images: ["252", 0],
        },
        class_type: "SaveImage",
      },
      "221": {
        inputs: { ckpt_name: "Qwen-Rapid-AIO-NSFW-v19.safetensors" },
        class_type: "CheckpointLoaderSimple",
      },
      "222": {
        inputs: {
          lora_name: "Qwen-Image-Edit-F2P 人脸生成.safetensors",
          strength_model: 0.25,
          model: ["221", 0],
        },
        class_type: "LoraLoaderModelOnly",
      },
      "223": {
        inputs: {
          clip_name: "qwen_2.5_vl_7b.safetensors",
          type: "lumina2",
          device: "default",
        },
        class_type: "CLIPLoader",
      },
      "246": {
        inputs: { image: secondaryReference },
        class_type: "LoadImage",
      },
      "247": {
        inputs: { image: ["50", 0] },
        class_type: "GetImageSize",
      },
      "248": {
        inputs: {
          预设: "自定义",
          互换宽高: false,
          随机模式: false,
          自定义宽: size.width,
          自定义高: size.height,
          批次数量: 1,
          管理预设: null,
        },
        class_type: "ZML_PresetResolutionV2",
      },
      "252": {
        inputs: { anything: ["38", 0] },
        class_type: "easy cleanGpuUsed",
      },
    };
  }

  private buildWorkflow(prompt: string, options?: ImageOptions): Record<string, unknown> {
    const size = ratioToImageSize(options?.aspectRatio);
    const negativePrompt = options?.negativePrompt?.trim();

    return {
      "9": {
        inputs: {
          filename_prefix: "z-image-turbo",
          images: ["57:8", 0],
        },
        class_type: "SaveImage",
      },
      "57:30": {
        inputs: {
          clip_name: "qwen_3_4b.safetensors",
          type: "lumina2",
          device: "default",
        },
        class_type: "CLIPLoader",
      },
      "57:29": {
        inputs: { vae_name: "ae.safetensors" },
        class_type: "VAELoader",
      },
      "57:28": {
        inputs: {
          unet_name: "ZImage\\z_image_turbo_bf16.safetensors",
          weight_dtype: "default",
        },
        class_type: "UNETLoader",
      },
      "57:13": {
        inputs: {
          width: size.width,
          height: size.height,
          batch_size: 1,
        },
        class_type: "EmptySD3LatentImage",
      },
      "57:27": {
        inputs: {
          text: prompt,
          clip: ["57:30", 0],
        },
        class_type: "CLIPTextEncode",
      },
      "57:11": {
        inputs: {
          shift: 3,
          model: ["57:28", 0],
        },
        class_type: "ModelSamplingAuraFlow",
      },
      "57:33": {
        inputs: negativePrompt
          ? { text: negativePrompt, clip: ["57:30", 0] }
          : { conditioning: ["57:27", 0] },
        class_type: negativePrompt ? "CLIPTextEncode" : "ConditioningZeroOut",
      },
      "57:3": {
        inputs: {
          seed: Math.floor(Math.random() * 1_000_000_000_000_000),
          steps: 8,
          cfg: 1,
          sampler_name: "res_multistep",
          scheduler: "simple",
          denoise: 1,
          model: ["57:11", 0],
          positive: ["57:27", 0],
          negative: ["57:33", 0],
          latent_image: ["57:13", 0],
        },
        class_type: "KSampler",
      },
      "57:8": {
        inputs: {
          samples: ["57:3", 0],
          vae: ["57:29", 0],
        },
        class_type: "VAEDecode",
      },
    };
  }

  private buildIdeogram4Workflow(prompt: string, options?: ImageOptions): Record<string, unknown> {
    const size = ratioToImageSize(options?.aspectRatio);
    const seed = Math.floor(Math.random() * 2_147_483_647);
    const steps = options?.quality === "hd" ? 28 : options?.quality === "default" ? 20 : 16;

    const mu = options?.quality === "quality" ? 0 : options?.quality === "default" ? 0 : 0;
    const std = options?.quality === "quality" ? 1.5 : 1.5;

    return {
      "14": {
        class_type: "CLIPLoader",
        inputs: { clip_name: "qwen3vl_8b_fp8_scaled.safetensors", type: "ideogram4", device: "default" },
      },
      "9": {
        class_type: "VAELoader",
        inputs: { vae_name: "flux2-vae.safetensors" },
      },
      "23": {
        class_type: "UNETLoader",
        inputs: { unet_name: "ideogram4_nvfp4_mixed.safetensors", weight_dtype: "default" },
      },
      "154": {
        class_type: "UNETLoader",
        inputs: { unet_name: "ideogram4_unconditional_nvfp4_mixed.safetensors", weight_dtype: "default" },
      },
      "24": {
        class_type: "CLIPTextEncode",
        inputs: { text: prompt, clip: ["14", 0] },
      },
      "10": {
        class_type: "ConditioningZeroOut",
        inputs: { conditioning: ["24", 0] },
      },
      "11": {
        class_type: "EmptyFlux2LatentImage",
        inputs: { width: size.width, height: size.height, batch_size: 1 },
      },
      "18": {
        class_type: "RandomNoise",
        inputs: { noise_seed: seed },
      },
      "16": {
        class_type: "KSamplerSelect",
        inputs: { sampler_name: "euler" },
      },
      "17": {
        class_type: "Ideogram4Scheduler",
        inputs: { steps, width: size.width, height: size.height, mu, std },
      },
      "157": {
        class_type: "CFGOverride",
        inputs: { model: ["23", 0], cfg: 3, start_percent: 0.9, end_percent: 1.0 },
      },
      "155": {
        class_type: "DualModelGuider",
        inputs: { model: ["157", 0], positive: ["24", 0], model_negative: ["154", 0], negative: ["10", 0], cfg: 7 },
      },
      "12": {
        class_type: "SamplerCustomAdvanced",
        inputs: { noise: ["18", 0], guider: ["155", 0], sampler: ["16", 0], sigmas: ["17", 0], latent_image: ["11", 0] },
      },
      "13": {
        class_type: "VAEDecode",
        inputs: { samples: ["12", 0], vae: ["9", 0] },
      },
      "15": {
        class_type: "SaveImage",
        inputs: { filename_prefix: "Ideogram_4.0", images: ["13", 0] },
      },
    };
  }

  private buildHiDreamO1Workflow(
    prompt: string,
    options?: ImageOptions,
    uploadedReferences?: UploadedImageInfo[],
  ): Record<string, unknown> {
    const size = ratioToHiDreamO1Size(options?.aspectRatio);
    const seed = Math.floor(Math.random() * 2_147_483_647);
    const steps = options?.quality === "hd" || options?.quality === "default" || !options?.quality ? 28 : 20;
    const hasReferences = !!uploadedReferences?.length;
    const negativeText = [
      "duplicate characters, multiple people, extra person, cloned figure, two many subjects, bad anatomy, ugly, blurry, low quality, distorted, watermark, text",
      options?.negativePrompt,
    ].filter(Boolean).join(", ");

    const workflow: Record<string, unknown> = {
      "6": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "hidream_o1_image_dev_mxfp8.safetensors" },
      },
      "124": {
        class_type: "ModelNoiseScale",
        inputs: { noise_scale: 7.6, model: ["6", 0] },
      },
      "112": {
        class_type: "BasicScheduler",
        inputs: { scheduler: "normal", steps, denoise: 1, model: ["124", 0] },
      },
      "125": {
        class_type: "SamplerLCM",
        inputs: { s_noise: 1, s_noise_end: 1, noise_clip_std: 2.5 },
      },
      "110": {
        class_type: "CLIPTextEncode",
        inputs: { text: prompt, clip: ["6", 1] },
      },
      "188": {
        class_type: "CLIPTextEncode",
        inputs: { text: negativeText, clip: ["6", 1] },
      },
      "156": {
        class_type: "EmptyHiDreamO1LatentImage",
        inputs: { width: size.width, height: size.height, batch_size: 1 },
      },
      "105": {
        class_type: "VAEDecode",
        inputs: { samples: ["108", 0], vae: ["6", 2] },
      },
      "227": {
        class_type: "SaveImage",
        inputs: { filename_prefix: "hidream_o1", images: ["105", 0] },
      },
    };

    if (hasReferences) {
      const loadImages: Record<string, unknown> = {};
      const refInputs: Record<string, unknown> = {
        positive: ["110", 0],
        negative: ["188", 0],
      };
      for (let i = 0; i < uploadedReferences!.length; i++) {
        const loadId = `${300 + i}`;
        loadImages[loadId] = {
          class_type: "LoadImage",
          inputs: { image: uploadedReferences![i].name },
        };
        refInputs[`images.image_${i + 1}`] = [loadId, 0];
      }

      workflow["154"] = {
        class_type: "PrimitiveBoolean",
        inputs: { value: true },
      };
      workflow["104"] = {
        class_type: "HiDreamO1ReferenceImages",
        inputs: refInputs,
      };
      workflow["152"] = {
        class_type: "ComfySwitchNode",
        inputs: {
          switch: ["154", 0],
          on_false: ["110", 0],
          on_true: ["104", 0],
        },
      };
      workflow["153"] = {
        class_type: "ComfySwitchNode",
        inputs: {
          switch: ["154", 0],
          on_false: ["188", 0],
          on_true: ["104", 1],
        },
      };
      workflow["108"] = {
        class_type: "SamplerCustom",
        inputs: {
          add_noise: true, noise_seed: seed, cfg: 1,
          model: ["124", 0],
          positive: ["152", 0],
          negative: ["153", 0],
          sampler: ["125", 0],
          sigmas: ["112", 0],
          latent_image: ["156", 0],
        },
      };
      Object.assign(workflow, loadImages);
    } else {
      workflow["108"] = {
        class_type: "SamplerCustom",
        inputs: {
          add_noise: true, noise_seed: seed, cfg: 1,
          model: ["124", 0],
          positive: ["110", 0],
          negative: ["188", 0],
          sampler: ["125", 0],
          sigmas: ["112", 0],
          latent_image: ["156", 0],
        },
      };
    }

    return workflow;
  }

  private buildErnieImageWorkflow(
    prompt: string,
    options?: ImageOptions,
  ): Record<string, unknown> {
    const size = ratioToErnieImageSize(options?.aspectRatio);
    const seed = Math.floor(Math.random() * 2_147_483_647);
    const isTurbo = isErnieTurboModel(this.model);
    const steps = isTurbo ? 8 : 20;
    const cfg = isTurbo ? 1.0 : 4.0;
    const samplerName = isTurbo ? "res_multistep" : "euler";
    const scheduler = isTurbo ? "simple" : "simple";
    const unetFile = isTurbo
      ? "ernie-image-turbo.safetensors"
      : "ernie-image.safetensors";
    const negativeText = [
      "duplicate characters, multiple people, extra person, cloned figure, two many subjects, bad anatomy, ugly, blurry, low quality, distorted, watermark, text",
      options?.negativePrompt,
    ].filter(Boolean).join(", ");

    const clone = JSON.parse(JSON.stringify(ERNIE_IMAGE_API_PROMPT)) as Record<string, { inputs: Record<string, unknown> }>;

    clone["88:78"].inputs.value = prompt;
    clone["88:72"].inputs.text = negativeText;
    clone["88:76"].inputs.value = true;
    clone["88:71"].inputs.width = size.width;
    clone["88:71"].inputs.height = size.height;
    clone["88:71"].inputs.batch_size = 1;
    clone["88:70"].inputs.seed = seed;
    clone["88:70"].inputs.steps = steps;
    clone["88:70"].inputs.cfg = cfg;
    clone["88:70"].inputs.sampler_name = samplerName;
    clone["88:70"].inputs.scheduler = scheduler;
    clone["88:70"].inputs.denoise = 1;
    clone["88:66"].inputs.unet_name = unetFile;
    clone["88:92"].inputs.source = size.width;
    clone["88:93"].inputs.source = size.height;
    clone["73"].inputs.filename_prefix = isTurbo ? "ernie-image-turbo" : "ernie-image";

    return clone as unknown as Record<string, unknown>;
  }

  private async pollForImage(promptId: string): Promise<{ filename: string; subfolder?: string; type?: string }> {
    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const res = await fetch(`${this.baseUrl}/history/${promptId}`, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;

      const json = (await res.json()) as Record<string, ComfyHistoryRecord>;
      const record = json[promptId];
      const statusMessages = record?.status?.messages;
      if (Array.isArray(statusMessages)) {
        for (const msg of statusMessages) {
          if (Array.isArray(msg) && msg[1]?.message?.includes("safety")) {
            throw new Error(`ComfyUI image blocked by safety filter: ${msg[1].message}`);
          }
        }
      }
      const outputs = record?.outputs || {};
      for (const node of Object.values(outputs)) {
        const image = node.images?.[0];
        if (image?.filename) return image;
      }
    }

    throw new Error("ComfyUI image generation timed out after 4 minutes");
  }

  private async detectWorkflowFamily(): Promise<WorkflowFamily> {
    if (this._workflowFamilyCache) return this._workflowFamilyCache;
    if (this.baseUrl.includes("localhost") || this.baseUrl.includes("127.0.0.1")) {
      return "z-image-turbo-comfyui";
    }
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return this.cacheFamily("z-image-turbo-comfyui");
      const folders = await res.json() as string[];
      for (const folder of folders) {
        if (!folder.includes("diffusion_models") && !folder.includes("checkpoints")) continue;
        const filesRes = await fetch(`${this.baseUrl}/models/${encodeURIComponent(folder)}`, {
          headers: this.getAuthHeaders(),
          signal: AbortSignal.timeout(10_000),
        });
        if (!filesRes.ok) break;
        const files = await filesRes.json() as string[];
        if (files.some((f: string) => f.includes("ideogram4"))) return this.cacheFamily("ideogram4-comfyui");
        if (files.some((f: string) => f.includes("qwen-edit"))) return this.cacheFamily("qwen-edit-dual");
        if (files.some((f: string) => f.includes("hidream_o1"))) return this.cacheFamily("hidream-o1-comfyui");
        if (files.some((f: string) => /ernie[-_]?image/i.test(f))) return this.cacheFamily("ernie-image-comfyui");
        if (files.some((f: string) => f.includes("z_image_turbo"))) return this.cacheFamily("z-image-turbo-comfyui");
      }
      return this.cacheFamily("z-image-turbo-comfyui");
    } catch {
      return this.cacheFamily("z-image-turbo-comfyui");
    }
  }

  private cacheFamily(family: WorkflowFamily): WorkflowFamily {
    this._workflowFamilyCache = family;
    return family;
  }

  private async downloadAndSaveImage(output: { filename: string; subfolder?: string; type?: string }, label: string): Promise<string> {
    if (output.filename.includes("safety") || output.filename.includes("blocked") || output.filename.includes("nsfw")) {
      throw new Error(`ComfyUI ${label} output blocked by safety filter: ${output.filename}`);
    }
    const query = new URLSearchParams({
      filename: output.filename,
      subfolder: output.subfolder || "",
      type: output.type || "output",
    });
    const imageRes = await fetch(`${this.baseUrl}/view?${query.toString()}`, {
      headers: this.getAuthHeaders(),
      signal: AbortSignal.timeout(120_000),
    });
    if (!imageRes.ok) {
      throw new Error(`ComfyUI ${label} download failed: ${imageRes.status}`);
    }

    const contentType = imageRes.headers.get("content-type") || "image/png";
    const ext = contentType.includes("jpeg") ? "jpg" : "png";
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await pipeline(imageRes.body! as any, createWriteStream(filepath));
    return filepath;
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const workflowFamily = options?.workflowFamily
      || (this.model.includes("qwen-edit") ? "qwen-edit-dual" as const : undefined)
      || (this.model.includes("ideogram4") || this.model.includes("ideogram-4") || prompt.includes('"prompt_generation"') ? "ideogram4-comfyui" as const : undefined)
      || (this.model.includes("hidream") || this.model.includes("hidream_o1") ? "hidream-o1-comfyui" as const : undefined)
      || (this.model.includes("ernie") ? "ernie-image-comfyui" as const : undefined)
      || await this.detectWorkflowFamily();
    const isIdeogram4 = workflowFamily === "ideogram4-comfyui";
    const isQwenEdit = workflowFamily === "qwen-edit-dual";
    const isHiDreamO1 = workflowFamily === "hidream-o1-comfyui";
    const isErnieImage = workflowFamily === "ernie-image-comfyui";

    if (isHiDreamO1) {
      const refs = [options?.editBaseImage, ...(options?.referenceImages ?? [])]
        .filter((img): img is string => !!img)
        .filter((img, index, arr) => arr.indexOf(img) === index)
        .slice(0, 10);
      const extraNodes = refs.length > 0
        ? ["HiDreamO1ReferenceImages", "ComfySwitchNode", "PrimitiveBoolean", "LoadImage"]
        : undefined;
      const preflightResult = await preflightWorkflow(
        this.baseUrl, workflowFamily, [], this.getAuthHeaders(), extraNodes,
      );
      if (!preflightResult.ok) {
        console.warn(`[ComfyUIImage] Preflight failed for ${this.model}:`, preflightResult.error);
        if (preflightResult.error?.code === ErrorCodes.SERVER_UNAVAILABLE) {
          throw new Error(`ComfyUI server unreachable: ${preflightResult.error.message}`);
        }
      }

      const uploadedRefs = refs.length > 0
        ? await Promise.all(refs.map((img) => this.uploadImage(img)))
        : [];
      const workflow = this.buildHiDreamO1Workflow(prompt, options, uploadedRefs);

      const submitRes = await fetch(`${this.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.getAuthHeaders() },
        body: JSON.stringify({ prompt: workflow }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!submitRes.ok) {
        const errText = await submitRes.text().catch(() => "");
        throw new Error(`ComfyUI hidream-o1 prompt submit failed: ${submitRes.status} ${errText}`);
      }

      const submitResult = (await submitRes.json()) as ComfyPromptResponse;
      const promptId = submitResult.prompt_id;
      if (!promptId) {
        throw new Error(`ComfyUI hidream-o1 returned no prompt_id: ${JSON.stringify(submitResult)}`);
      }

      const output = await this.pollForImage(promptId);
      return this.downloadAndSaveImage(output, "hidream-o1");
    }

    if (isErnieImage) {
      const preflightResult = await preflightWorkflow(
        this.baseUrl, workflowFamily, [], this.getAuthHeaders(),
      );
      if (!preflightResult.ok) {
        console.warn(`[ComfyUIImage] Preflight failed for ${this.model}:`, preflightResult.error);
        if (preflightResult.error?.code === ErrorCodes.SERVER_UNAVAILABLE) {
          throw new Error(`ComfyUI server unreachable: ${preflightResult.error.message}`);
        }
      }

      const workflow = this.buildErnieImageWorkflow(prompt, options);

      const submitRes = await fetch(`${this.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.getAuthHeaders() },
        body: JSON.stringify({ prompt: workflow }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!submitRes.ok) {
        const errText = await submitRes.text().catch(() => "");
        throw new Error(`ComfyUI ernie-image prompt submit failed: ${submitRes.status} ${errText}`);
      }

      const submitResult = (await submitRes.json()) as ComfyPromptResponse;
      const promptId = submitResult.prompt_id;
      if (!promptId) {
        throw new Error(`ComfyUI ernie-image returned no prompt_id: ${JSON.stringify(submitResult)}`);
      }

      const output = await this.pollForImage(promptId);
      return this.downloadAndSaveImage(output, "ernie-image");
    }

    const preflightResult = await preflightWorkflow(this.baseUrl, workflowFamily, [], this.getAuthHeaders());
    if (!preflightResult.ok) {
      console.warn(`[ComfyUIImage] Preflight failed for ${this.model}:`, preflightResult.error);
      if (preflightResult.error?.code === ErrorCodes.SERVER_UNAVAILABLE) {
        throw new Error(`ComfyUI server unreachable: ${preflightResult.error.message}`);
      }
    }

    if (isIdeogram4) {
      if (/[\u4e00-\u9fff]/.test(prompt)) {
        const panelMatch = prompt.match(/PANEL (\d+)/);
        const panelPos = panelMatch ? Number(panelMatch[1]) : 0;
        const panelLabels = ["", "Opening", "Development", "Turning Point", "Conclusion"];
        const panelLabel = panelLabels[panelPos] || "Storyboard";

        const chars = (prompt.match(/[a-zA-Z0-9_.,!?;:'"()\[\]{}\s-]+/g) || []).join(" ").trim();
        const desc = chars.slice(0, 600) || `${panelLabel} panel of a cinematic scene with characters`;

        prompt = JSON.stringify({
          high_level_description: `${panelLabel} panel of a 4-panel comic storyboard. ${desc}`,
          style_description: {
            aesthetics: "High quality 2D digital animation, cel shaded, clean line art, soft global illumination, volumetric lighting, vibrant colors, rich detail",
            lighting: "Cinematic lighting with motivated key light, rim light separation, soft ambient fill",
            medium: "Digital 2D animation production frame, professional storyboard panel",
            color_palette: ["#3A3F5C", "#6B7B8D", "#D4A574", "#2C3E50"],
          },
          compositional_deconstruction: {
            background: "Fully rendered detailed environment matching the scene setting",
            elements: [{ type: "obj", bbox: [0, 0, 1000, 1000], desc: desc.slice(0, 500) }],
          },
        }, null, 2);
      }
      const workflow = this.buildIdeogram4Workflow(prompt, options);

      const submitRes = await fetch(`${this.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.getAuthHeaders() },
        body: JSON.stringify({ prompt: workflow }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!submitRes.ok) {
        const errText = await submitRes.text().catch(() => "");
        throw new Error(`ComfyUI ideogram4 prompt submit failed: ${submitRes.status} ${errText}`);
      }

      const submitResult = (await submitRes.json()) as ComfyPromptResponse;
      const promptId = submitResult.prompt_id;
      if (!promptId) {
        throw new Error(`ComfyUI ideogram4 returned no prompt_id: ${JSON.stringify(submitResult)}`);
      }

      const output = await this.pollForImage(promptId);
      return this.downloadAndSaveImage(output, "ideogram4");
    }

    if (isQwenEdit) {
      const baseImage = options?.editBaseImage || options?.referenceImages?.[0];
      if (!baseImage) {
        throw new Error("ComfyUI qwen-edit requires an editBaseImage or at least one reference image");
      }

      const uploadedBaseImage = await this.uploadImage(baseImage);
      const extraReferences = (options?.referenceImages ?? []).filter((img) => img !== baseImage).slice(0, 6);
      const uploadedReferences = await Promise.all(extraReferences.map((img) => this.uploadImage(img)));
      const workflow = this.buildQwenEditWorkflow(prompt, options, uploadedBaseImage, uploadedReferences);

      const submitRes = await fetch(`${this.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.getAuthHeaders() },
        body: JSON.stringify({ prompt: workflow }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!submitRes.ok) {
        const errText = await submitRes.text().catch(() => "");
        throw new Error(`ComfyUI qwen-edit prompt submit failed: ${submitRes.status} ${errText}`);
      }

      const submitResult = (await submitRes.json()) as ComfyPromptResponse;
      const promptId = submitResult.prompt_id;
      if (!promptId) {
        throw new Error(`ComfyUI qwen-edit returned no prompt_id: ${JSON.stringify(submitResult)}`);
      }

      const output = await this.pollForImage(promptId);
      return this.downloadAndSaveImage(output, "qwen-edit");
    }

    const workflow = this.buildWorkflow(prompt, options);

    const submitRes = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.getAuthHeaders() },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(`ComfyUI image prompt submit failed: ${submitRes.status} ${errText}`);
    }

    const submitResult = (await submitRes.json()) as ComfyPromptResponse;
    const promptId = submitResult.prompt_id;
    if (!promptId) {
      throw new Error(`ComfyUI image prompt returned no prompt_id: ${JSON.stringify(submitResult)}`);
    }

    const output = await this.pollForImage(promptId);
    return this.downloadAndSaveImage(output, "image");
  }
}
