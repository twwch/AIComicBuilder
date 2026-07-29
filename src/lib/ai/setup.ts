import { setDefaultAIProvider, setDefaultVideoProvider } from "./index";
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";

let initialized = false;

const ATLASCLOUD_BASE_URL =
  process.env.ATLASCLOUD_BASE_URL || "https://api.atlascloud.ai/v1";
const ATLASCLOUD_MODEL =
  process.env.ATLASCLOUD_MODEL || "deepseek-ai/deepseek-v4-pro";

export function initializeProviders() {
  if (initialized) return;

  if (process.env.OPENAI_API_KEY) {
    setDefaultAIProvider(
      new OpenAIProvider(),
      (uploadDir) => new OpenAIProvider({ ...(uploadDir && { uploadDir }) }),
    );
  } else if (process.env.GEMINI_API_KEY) {
    setDefaultAIProvider(
      new GeminiProvider(),
      (uploadDir) => new GeminiProvider({ ...(uploadDir && { uploadDir }) }),
    );
  } else if (process.env.ATLASCLOUD_API_KEY) {
    setDefaultAIProvider(
      new OpenAIProvider({
        apiKey: process.env.ATLASCLOUD_API_KEY,
        baseURL: ATLASCLOUD_BASE_URL,
        model: ATLASCLOUD_MODEL,
      }),
      (uploadDir) =>
        new OpenAIProvider({
          apiKey: process.env.ATLASCLOUD_API_KEY,
          baseURL: ATLASCLOUD_BASE_URL,
          model: ATLASCLOUD_MODEL,
          ...(uploadDir && { uploadDir }),
        }),
    );
  }

  if (process.env.SEEDANCE_API_KEY) {
    setDefaultVideoProvider(
      new SeedanceProvider(),
      (uploadDir) => new SeedanceProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }

  initialized = true;
}
