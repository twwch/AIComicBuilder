import { setDefaultAIProvider, setDefaultVideoProvider } from "./index";
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";
import { AtlasCloudProvider } from "./providers/atlascloud";
import { AtlasCloudVideoProvider } from "./providers/atlascloud-video";

const ATLAS_API_KEY = process.env.ATLASCLOUD_API_KEY || process.env.ATLAS_CLOUD_API_KEY;

let initialized = false;

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
  } else if (ATLAS_API_KEY) {
    // Atlas Cloud covers text + image behind a single key.
    setDefaultAIProvider(
      new AtlasCloudProvider(),
      (uploadDir) => new AtlasCloudProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }

  if (process.env.SEEDANCE_API_KEY) {
    setDefaultVideoProvider(
      new SeedanceProvider(),
      (uploadDir) => new SeedanceProvider({ ...(uploadDir && { uploadDir }) }),
    );
  } else if (ATLAS_API_KEY) {
    setDefaultVideoProvider(
      new AtlasCloudVideoProvider(),
      (uploadDir) => new AtlasCloudVideoProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }

  initialized = true;
}
