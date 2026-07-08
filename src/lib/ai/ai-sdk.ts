import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { splitConfiguredKeys } from "./key-pool";

export interface ProviderConfig {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  secretKey?: string;
  modelId: string;
}

export function createLanguageModel(config: ProviderConfig): LanguageModel {
  switch (config.protocol) {
    case "openai": {
      const provider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
      });
      return provider.chat(config.modelId);
    }
    case "gemini": {
      const provider = createGoogleGenerativeAI({
        apiKey: config.apiKey,
      });
      return provider(config.modelId);
    }
    default:
      throw new Error(`Unsupported protocol: ${config.protocol}`);
  }
}

function firstConfiguredApiKey(apiKeysEnv: string[], labelPrefix: string) {
  return splitConfiguredKeys({ apiKey: "", apiKeysEnv, labelPrefix })[0]?.apiKey ?? "";
}

function getLanguagePoolEnv(protocol: string) {
  switch (protocol) {
    case "openai":
      return { apiKeysEnv: ["OPENAI_API_KEYS", "OPENAI_API_KEY"] };
    case "gemini":
      return { apiKeysEnv: ["GEMINI_API_KEYS", "GEMINI_API_KEY"] };
    default:
      return { apiKeysEnv: [] };
  }
}

function envLanguageModelConfigs(protocol: "openai" | "gemini"): ProviderConfig[] {
  const poolEnv = getLanguagePoolEnv(protocol);
  const entries = splitConfiguredKeys({
    apiKey: "",
    apiKeysEnv: poolEnv.apiKeysEnv,
    labelPrefix: protocol,
  });
  const baseUrl = protocol === "openai"
    ? process.env.OPENAI_BASE_URL || ""
    : process.env.GEMINI_BASE_URL || "";
  const modelId = protocol === "openai"
    ? process.env.OPENAI_MODEL || "gpt-4o"
    : process.env.GEMINI_MODEL || "gemini-2.0-flash";

  const configs: ProviderConfig[] = entries.map((entry) => ({
    protocol,
    baseUrl,
    apiKey: entry.apiKey,
    modelId,
  }));

  if (protocol === "openai") configs.push(...jimApiTextModelConfigs());

  return configs;
}

function imageKeysForTextEnabled() {
  return !/^(0|false|no|off)$/i.test(process.env.IMPORT_USE_IMAGE_KEYS_FOR_TEXT || "");
}

function jimApiTextModelConfigs(): ProviderConfig[] {
  if (!process.env.JIMAPI_BASE_URL) return [];
  if (!imageKeysForTextEnabled()) return [];

  const textModel =
    process.env.TEXT_REVIEW_MODEL ||
    process.env.JIMAPI_TEXT_MODEL ||
    process.env.CLAUDE_TEXT_MODEL ||
    "claude-opus-4-8";

  const jimApiEntries = splitConfiguredKeys({
    apiKey: process.env.JIMAPI_API_KEY || "",
    apiKeysEnv: ["JIMAPI_API_KEYS", "IMAGE2_API_KEYS"],
    labelPrefix: "jimapi-text",
  });

  return jimApiEntries.map((entry) => ({
    protocol: "openai",
    baseUrl: process.env.JIMAPI_BASE_URL || "",
    apiKey: entry.apiKey,
    modelId: textModel,
  }));
}

export function resolveLanguageModelConfigs(config?: ProviderConfig | null): ProviderConfig[] {
  if (config?.apiKey) {
    const poolEnv = getLanguagePoolEnv(config.protocol);
    const entries = splitConfiguredKeys({
      apiKey: config.apiKey,
      secretKey: config.secretKey,
      apiKeysEnv: poolEnv.apiKeysEnv,
      labelPrefix: config.protocol,
    });

    if (entries.length > 0) {
      const configs = entries.map((entry) => ({
        ...config,
        apiKey: entry.apiKey,
        secretKey: entry.secretKey ?? config.secretKey,
      }));
      return config.protocol === "openai" ? [...configs, ...jimApiTextModelConfigs()] : configs;
    }

    return [config];
  }

  if (process.env.OPENAI_API_KEYS || process.env.OPENAI_API_KEY) {
    return envLanguageModelConfigs("openai");
  }

  if (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY) {
    return envLanguageModelConfigs("gemini");
  }

  const jimApiConfigs = jimApiTextModelConfigs();
  if (jimApiConfigs.length > 0) return jimApiConfigs;

  return [];
}

export function resolveLanguageModelConfig(config?: ProviderConfig | null): ProviderConfig | null {
  const configs = resolveLanguageModelConfigs(config);
  if (configs.length > 0) return configs[0];

  if (config?.apiKey) return config;

  if (process.env.OPENAI_API_KEYS || process.env.OPENAI_API_KEY) {
    const apiKey = firstConfiguredApiKey(["OPENAI_API_KEYS", "OPENAI_API_KEY"], "openai");
    if (apiKey) {
      return {
        protocol: "openai",
        baseUrl: process.env.OPENAI_BASE_URL || "",
        apiKey,
        modelId: process.env.OPENAI_MODEL || "gpt-4o",
      };
    }
  }

  if (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY) {
    const apiKey = firstConfiguredApiKey(["GEMINI_API_KEYS", "GEMINI_API_KEY"], "gemini");
    if (apiKey) {
      return {
        protocol: "gemini",
        baseUrl: process.env.GEMINI_BASE_URL || "",
        apiKey,
        modelId: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      };
    }
  }

  return null;
}

export function supportsOpenAIJsonMode(config: ProviderConfig): boolean {
  if (config.protocol !== "openai") return false;
  const modelId = config.modelId.toLowerCase();
  return /^(gpt-|o\d|chatgpt-)/.test(modelId);
}

/**
 * Strip markdown code fences from AI response if present.
 */
export function extractJSON(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = match ? match[1].trim() : text.trim();
  // Remove control characters that break JSON.parse (except \n \r \t)
  const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) return cleaned;

  const start = cleaned.search(/[\[{]/);
  if (start < 0) return cleaned;

  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }

  return cleaned.slice(start);
}
