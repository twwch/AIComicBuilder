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
    case "openai":
    case "atlascloud": {
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
  // Remove control characters that break JSON.parse (except \n \r \t)
  return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}
