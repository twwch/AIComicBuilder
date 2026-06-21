import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";
import { VeoProvider } from "./providers/veo";
import { KlingImageProvider } from "./providers/kling-image";
import { KlingVideoProvider } from "./providers/kling-video";
import { WanVideoProvider } from "./providers/wan-video";
import { UCloudSeedanceProvider } from "./providers/ucloud-seedance";
import { DashScopeImageProvider } from "./providers/dashscope-image";
import { ComfyUIVideoProvider } from "./providers/comfyui-video";
import { ComfyUIImageProvider } from "./providers/comfyui-image";
import { SenseNovaImageProvider } from "./providers/sensenova-image";
import { SiliconFlowImageProvider } from "./providers/siliconflow-image";
import { HiDreamImageProvider } from "./providers/hidream-image";
import { AivideoVideoProvider } from "./providers/aivideo-video";
import { ASXSImageProvider } from "./providers/asxs-image";
import { FramepackVideoProvider } from "./providers/framepack-video";
import { OmnigenImageProvider } from "./providers/omnigen-image";
import { AgnesVideoProvider } from "./providers/agnes-video";
import { NvidiaNimImageProvider } from "./providers/nvidia-nim-image";
import { NvidiaNimVideoProvider } from "./providers/nvidia-nim-video";
import { setDefaultAIProvider, getAIProvider, getVideoProvider } from "./index";
import type { AIProvider, VideoProvider } from "./types";

interface ProviderConfig {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  secretKey?: string;
  modelId: string;
}

export interface ModelConfigPayload {
  text?: ProviderConfig | null;
  image?: ProviderConfig | null;
  video?: ProviderConfig | null;
}

export function createAIProvider(config: ProviderConfig, uploadDir?: string): AIProvider {
  switch (config.protocol) {
    case "openai":
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "gemini":
      return new GeminiProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "kling":
      return new KlingImageProvider({
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "dashscope":
      return new DashScopeImageProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "sensenova":
      return new SenseNovaImageProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "comfyui":
      return new ComfyUIImageProvider({
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
        ...(config.apiKey && { authToken: config.apiKey }),
        ...(config.secretKey && { authCookie: config.secretKey }),
      });
    case "siliconflow":
      return new SiliconFlowImageProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "hidream":
      return new HiDreamImageProvider({
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "asxs":
      return new ASXSImageProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "nvidia":
    case "agnes":
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "nvidia-nim":
      return new NvidiaNimImageProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "omnigen":
      return new OmnigenImageProvider({
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    default:
      throw new Error(`Unsupported AI protocol: ${config.protocol}`);
  }
}

export function createVideoProvider(config: ProviderConfig, uploadDir?: string): VideoProvider {
  switch (config.protocol) {
    case "seedance":
      return new SeedanceProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "gemini":
      return new VeoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "kling":
      return new KlingVideoProvider({
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "wan":
      return new WanVideoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "ucloud-seedance":
      return new UCloudSeedanceProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "comfyui":
      console.log("ComfyUI Video Config:", { hasApiKey: !!config.apiKey, hasSecretKey: !!config.secretKey, baseUrl: config.baseUrl });
      return new ComfyUIVideoProvider({
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
        authToken: config.apiKey,
        authCookie: config.secretKey,
      });
    case "framepack":
      console.log("FramePack Video Config:", { baseUrl: config.baseUrl });
      return new FramepackVideoProvider({
        baseUrl: config.baseUrl,
        ...(uploadDir && { uploadDir }),
      });
    case "aivideo":
      return new AivideoVideoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "agnes":
      return new AgnesVideoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    case "nvidia-nim":
      return new NvidiaNimVideoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    default:
      throw new Error(`Unsupported video protocol: ${config.protocol}`);
  }
}

function isTextCapable(provider: AIProvider): boolean {
  return provider instanceof OpenAIProvider || provider instanceof GeminiProvider;
}

function ensureDefaultProvider(): AIProvider {
  try {
    const existing = getAIProvider();
    if (isTextCapable(existing)) return existing;
    console.warn(`[ensureDefaultProvider] Default provider (${existing.constructor.name}) does not support text — creating OpenAI fallback`);
  } catch {
    // No default set
  }
  const fallback = new OpenAIProvider();
  try { setDefaultAIProvider(fallback, (ud) => new OpenAIProvider({ ...(ud && { uploadDir: ud }) })); } catch { /* best effort */ }
  return fallback;
}

const TEXT_CAPABLE_PROTOCOLS = new Set(["openai", "gemini", "nvidia", "agnes"]);

export function resolveAIProvider(modelConfig?: ModelConfigPayload): AIProvider {
  if (modelConfig?.text && TEXT_CAPABLE_PROTOCOLS.has(modelConfig.text.protocol)) {
    return createAIProvider(modelConfig.text);
  }
  if (modelConfig?.text) {
    // Protocol doesn't support text natively (e.g. sensenova) — use OpenAI-compatible client
    console.warn(`[resolveAIProvider] "${modelConfig.text.protocol}" does not support text — creating OpenAI-compatible client`);
    return new OpenAIProvider({
      baseURL: modelConfig.text.baseUrl,
      apiKey: modelConfig.text.apiKey,
      model: modelConfig.text.modelId,
    });
  }
  return ensureDefaultProvider();
}

function ensureDefaultImageProvider(uploadDir?: string): AIProvider {
  try {
    return getAIProvider(uploadDir);
  } catch {
    const fallback = new OpenAIProvider({ ...(uploadDir && { uploadDir }) });
    setDefaultAIProvider(fallback, (ud) => new OpenAIProvider({ ...(ud && { uploadDir: ud }) }));
    return fallback;
  }
}

function ensureDefaultVideoProvider(uploadDir?: string): VideoProvider {
  try {
    return getVideoProvider(uploadDir);
  } catch {
    throw new Error("No video provider configured. Set modelConfig.video or configure a video provider via environment variables.");
  }
}

export function resolveImageProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): AIProvider {
  if (modelConfig?.image) {
    return createAIProvider(modelConfig.image, uploadDir);
  }
  return ensureDefaultImageProvider(uploadDir);
}

export function resolveVideoProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): VideoProvider {
  if (modelConfig?.video) {
    return createVideoProvider(modelConfig.video, uploadDir);
  }
  return ensureDefaultVideoProvider(uploadDir);
}
