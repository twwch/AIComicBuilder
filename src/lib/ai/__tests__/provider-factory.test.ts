import { describe, it, expect, beforeAll } from "vitest";
import {
  createAIProvider,
  createVideoProvider,
  resolveAIProvider,
  resolveImageProvider,
} from "@/lib/ai/provider-factory";
import type { AIProvider } from "@/lib/ai/types";

// setDefaultAIProvider/getAIProvider are side-effectful module singletons
import { setDefaultAIProvider } from "@/lib/ai/index";

beforeAll(() => {
  // Ensure the OpenAI constructor doesn't throw on missing credentials by
  // providing a dummy key (tests construct providers via factory, not via
  // direct OpenAI calls).
  process.env.OPENAI_API_KEY = "sk-test-only";
});

function makeTextConfig(protocol: string, overrides = {}) {
  return {
    protocol,
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    modelId: "test-model",
    ...overrides,
  };
}

describe("createAIProvider", () => {
  it("creates an OpenAI provider for 'openai' protocol", () => {
    const provider = createAIProvider(makeTextConfig("openai"));
    expect(provider.generateText).toBeDefined();
    expect(provider.generateImage).toBeDefined();
  });

  it("creates a provider for 'gemini' protocol", () => {
    const provider = createAIProvider(makeTextConfig("gemini"));
    expect(provider.generateText).toBeDefined();
    expect(provider.generateImage).toBeDefined();
  });

  it("creates a provider for 'sensenova' protocol", () => {
    const provider = createAIProvider(makeTextConfig("sensenova"));
    expect(provider.generateText).toBeDefined();
    expect(provider.generateImage).toBeDefined();
  });

  it("creates a provider for 'comfyui' protocol", () => {
    const provider = createAIProvider(makeTextConfig("comfyui"));
    // ComfyUIImageProvider accepts apiKey as authToken
    expect(provider.generateImage).toBeDefined();
  });

  it("creates an OpenAI provider for 'nvidia' protocol", () => {
    const provider = createAIProvider(makeTextConfig("nvidia"));
    expect(provider.generateText).toBeDefined();
  });

  it("creates a provider for 'siliconflow' protocol", () => {
    const provider = createAIProvider(makeTextConfig("siliconflow"));
    expect(provider.generateImage).toBeDefined();
  });

  it("creates a provider for 'dashscope' protocol", () => {
    const provider = createAIProvider(makeTextConfig("dashscope"));
    expect(provider.generateImage).toBeDefined();
  });

  it("creates a provider for 'kling' protocol", () => {
    const provider = createAIProvider(makeTextConfig("kling"));
    expect(provider.generateImage).toBeDefined();
  });

  it("creates a provider for 'asxs' protocol", () => {
    const provider = createAIProvider(makeTextConfig("asxs"));
    expect(provider.generateImage).toBeDefined();
  });

  it("creates a provider for 'omnigen' protocol", () => {
    const provider = createAIProvider(makeTextConfig("omnigen"));
    expect(provider.generateImage).toBeDefined();
  });

  it("throws for unsupported protocol", () => {
    expect(() => createAIProvider(makeTextConfig("unknown"))).toThrow("Unsupported AI protocol");
  });
});

describe("createVideoProvider", () => {
  it("creates a Seedance provider", () => {
    const provider = createVideoProvider(makeTextConfig("seedance"));
    expect(provider.generateVideo).toBeDefined();
  });

  it("creates a Veo provider for 'gemini' protocol", () => {
    const provider = createVideoProvider(makeTextConfig("gemini"));
    expect(provider.generateVideo).toBeDefined();
  });

  it("creates a Kling video provider", () => {
    const provider = createVideoProvider(makeTextConfig("kling"));
    expect(provider.generateVideo).toBeDefined();
  });

  it("creates a Wan video provider", () => {
    const provider = createVideoProvider(makeTextConfig("wan"));
    expect(provider.generateVideo).toBeDefined();
  });

  it("creates a ComfyUI video provider", () => {
    const provider = createVideoProvider(makeTextConfig("comfyui"));
    expect(provider.generateVideo).toBeDefined();
  });

  it("throws for unsupported protocol", () => {
    expect(() => createVideoProvider(makeTextConfig("unknown"))).toThrow("Unsupported video protocol");
  });
});

describe("resolveAIProvider", () => {
  it("returns provider for text-capable protocol (openai)", () => {
    const provider = resolveAIProvider({ text: makeTextConfig("openai") });
    expect(provider.generateText).toBeDefined();
  });

  it("returns provider for text-capable protocol (gemini)", () => {
    const provider = resolveAIProvider({ text: makeTextConfig("gemini") });
    expect(provider.generateText).toBeDefined();
  });

  it("returns OpenAI fallback for non-text-capable protocol (sensenova)", () => {
    const provider = resolveAIProvider({ text: makeTextConfig("sensenova") });
    expect(provider.generateText).toBeDefined();
    expect(provider.generateImage).toBeDefined();
  });

  it("falls back to default provider when no text config given", () => {
    // When no text config, ensureDefaultProvider creates an OpenAIProvider
    const provider = resolveAIProvider({ image: makeTextConfig("sensenova") });
    expect(provider.generateText).toBeDefined();
  });

  it("returns default provider when modelConfig is undefined", () => {
    const provider = resolveAIProvider(undefined);
    expect(provider.generateText).toBeDefined();
  });

  it("returns default provider when modelConfig.text is null", () => {
    const provider = resolveAIProvider({ text: null, image: makeTextConfig("sensenova") });
    expect(provider.generateText).toBeDefined();
  });
});

describe("resolveImageProvider", () => {
  it("returns provider from image config", () => {
    const provider = resolveImageProvider({ image: makeTextConfig("sensenova") });
    expect(provider.generateImage).toBeDefined();
  });

  it("falls back when no image config", () => {
    // Will use ensureDefaultImageProvider which creates OpenAIProvider
    const provider = resolveImageProvider({ text: makeTextConfig("openai") });
    expect(provider.generateImage).toBeDefined();
  });
});
