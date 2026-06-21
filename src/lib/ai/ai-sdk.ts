import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

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
        baseURL: config.baseUrl,
      });
      return provider.chat(config.modelId);
    }
    case "gemini": {
      const provider = createGoogleGenerativeAI({
        apiKey: config.apiKey,
      });
      return provider(config.modelId);
    }
    case "sensenova":
    case "dashscope":
    case "siliconflow":
    case "nvidia":
    case "agnes": {
      const provider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider.chat(config.modelId);
    }
    default:
      throw new Error(`Unsupported protocol: ${config.protocol}`);
  }
}

/**
 * Strip markdown code fences from AI response if present.
 */
export function extractJSON(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = match ? match[1].trim() : text.trim();
  const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

  // Fast path: already valid-looking JSON.
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    return cleaned;
  }

  // Fallback: some models prepend explanatory prose before the JSON payload.
  const firstObject = cleaned.indexOf("{");
  const firstArray = cleaned.indexOf("[");
  const candidates = [firstObject, firstArray].filter((i) => i >= 0).sort((a, b) => a - b);
  if (candidates.length > 0) {
    return cleaned.slice(candidates[0]).trim();
  }

  return cleaned;
}
