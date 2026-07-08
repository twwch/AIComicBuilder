import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";
import { VeoProvider } from "./providers/veo";
import { KlingImageProvider } from "./providers/kling-image";
import { KlingVideoProvider } from "./providers/kling-video";
import { WanVideoProvider } from "./providers/wan-video";
import { UCloudSeedanceProvider } from "./providers/ucloud-seedance";
import { DashScopeImageProvider } from "./providers/dashscope-image";
import { JimApiVideoProvider } from "./providers/jimapi-video";
import { getAIProvider, getVideoProvider } from "./index";
import type { AIProvider, VideoProvider } from "./types";
import { KeyPoolAIProvider, splitConfiguredKeys } from "./key-pool";

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

function getImagePoolEnv(protocol: string) {
  switch (protocol) {
    case "openai":
      return { apiKeysEnv: ["OPENAI_API_KEYS", "OPENAI_API_KEY"] };
    case "gemini":
      return { apiKeysEnv: ["GEMINI_API_KEYS", "GEMINI_API_KEY"] };
    case "kling":
      return {
        apiKeysEnv: ["KLING_ACCESS_KEYS", "KLING_ACCESS_KEY"],
        secretKeysEnv: ["KLING_SECRET_KEYS", "KLING_SECRET_KEY"],
      };
    case "dashscope":
      return { apiKeysEnv: ["DASHSCOPE_API_KEYS", "DASHSCOPE_API_KEY"] };
    default:
      return { apiKeysEnv: [] };
  }
}

function createSingleAIProvider(config: ProviderConfig, uploadDir?: string): AIProvider {
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
    default:
      throw new Error(`Unsupported AI protocol: ${config.protocol}`);
  }
}

export function createAIProvider(config: ProviderConfig, uploadDir?: string): AIProvider {
  const poolEnv = getImagePoolEnv(config.protocol);
  const entries = splitConfiguredKeys({
    apiKey: config.apiKey,
    secretKey: config.secretKey,
    apiKeysEnv: poolEnv.apiKeysEnv,
    secretKeysEnv: poolEnv.secretKeysEnv,
    labelPrefix: config.protocol,
  });

  if (entries.length <= 1) {
    return createSingleAIProvider(
      {
        ...config,
        apiKey: entries[0]?.apiKey ?? config.apiKey,
        secretKey: entries[0]?.secretKey ?? config.secretKey,
      },
      uploadDir,
    );
  }

  console.log(`[ImageKeyPool] ${config.protocol}: loaded ${entries.length} API keys`);
  return new KeyPoolAIProvider(entries, (entry) =>
    createSingleAIProvider(
      {
        ...config,
        apiKey: entry.apiKey,
        secretKey: entry.secretKey ?? config.secretKey,
      },
      uploadDir,
    ),
  );
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
    case "jimapi-video":
      return new JimApiVideoProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.modelId,
        ...(uploadDir && { uploadDir }),
      });
    default:
      throw new Error(`Unsupported video protocol: ${config.protocol}`);
  }
}

export function resolveAIProvider(modelConfig?: ModelConfigPayload): AIProvider {
  if (modelConfig?.text) {
    return createAIProvider(modelConfig.text);
  }
  return getAIProvider();
}

export function resolveImageProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): AIProvider {
  if (modelConfig?.image) {
    return createAIProvider(modelConfig.image, uploadDir);
  }
  return getAIProvider(uploadDir);
}

export function resolveVideoProvider(modelConfig?: ModelConfigPayload, uploadDir?: string): VideoProvider {
  if (modelConfig?.video) {
    return createVideoProvider(modelConfig.video, uploadDir);
  }
  return getVideoProvider(uploadDir);
}
