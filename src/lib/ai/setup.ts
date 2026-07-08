import { setDefaultAIProvider, setDefaultVideoProvider } from "./index";
import { createAIProvider } from "./provider-factory";
import { SeedanceProvider } from "./providers/seedance";
import { JimApiVideoProvider } from "./providers/jimapi-video";

let initialized = false;

export function initializeProviders() {
  if (initialized) return;

  if (process.env.OPENAI_API_KEYS || process.env.OPENAI_API_KEY) {
    setDefaultAIProvider(
      createAIProvider({
        protocol: "openai",
        baseUrl: process.env.OPENAI_BASE_URL || "",
        apiKey: process.env.OPENAI_API_KEYS || process.env.OPENAI_API_KEY || "",
        modelId: process.env.OPENAI_MODEL || "gpt-4o",
      }),
      (uploadDir) => createAIProvider({
        protocol: "openai",
        baseUrl: process.env.OPENAI_BASE_URL || "",
        apiKey: process.env.OPENAI_API_KEYS || process.env.OPENAI_API_KEY || "",
        modelId: process.env.OPENAI_MODEL || "gpt-4o",
      }, uploadDir),
    );
  } else if (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY) {
    setDefaultAIProvider(
      createAIProvider({
        protocol: "gemini",
        baseUrl: process.env.GEMINI_BASE_URL || "",
        apiKey: process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "",
        modelId: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      }),
      (uploadDir) => createAIProvider({
        protocol: "gemini",
        baseUrl: process.env.GEMINI_BASE_URL || "",
        apiKey: process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "",
        modelId: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      }, uploadDir),
    );
  } else if (process.env.DASHSCOPE_API_KEYS || process.env.DASHSCOPE_API_KEY) {
    setDefaultAIProvider(
      createAIProvider({
        protocol: "dashscope",
        baseUrl: process.env.DASHSCOPE_BASE_URL || "",
        apiKey: process.env.DASHSCOPE_API_KEYS || process.env.DASHSCOPE_API_KEY || "",
        modelId: process.env.DASHSCOPE_IMAGE_MODEL || "qwen-image-2.0-pro",
      }),
      (uploadDir) => createAIProvider({
        protocol: "dashscope",
        baseUrl: process.env.DASHSCOPE_BASE_URL || "",
        apiKey: process.env.DASHSCOPE_API_KEYS || process.env.DASHSCOPE_API_KEY || "",
        modelId: process.env.DASHSCOPE_IMAGE_MODEL || "qwen-image-2.0-pro",
      }, uploadDir),
    );
  }

  if (process.env.SEEDANCE_API_KEY) {
    setDefaultVideoProvider(
      new SeedanceProvider(),
      (uploadDir) => new SeedanceProvider({ ...(uploadDir && { uploadDir }) }),
    );
  } else if (process.env.JIMAPI_API_KEY) {
    setDefaultVideoProvider(
      new JimApiVideoProvider(),
      (uploadDir) => new JimApiVideoProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }

  initialized = true;
}
