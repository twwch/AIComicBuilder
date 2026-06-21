import { describe, it, expect, beforeEach } from "vitest";
import { useModelStore } from "@/stores/model-store";
import type { Provider, ModelRef } from "@/stores/model-store";

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "p1",
    name: "Test Provider",
    protocol: "openai",
    capability: "text",
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    models: [{ id: "gpt-4", name: "GPT-4", checked: true }],
    ...overrides,
  };
}

beforeEach(() => {
  // Reset store to initial state
  useModelStore.setState({
    providers: [],
    defaultTextModel: null,
    defaultImageModel: null,
    defaultVideoModel: null,
  });
});

describe("addProvider", () => {
  it("adds a provider and returns its id", () => {
    const id = useModelStore.getState().addProvider({
      name: "My Provider",
      protocol: "openai",
      capability: "text",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-xxx",
    });
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    expect(useModelStore.getState().providers).toHaveLength(1);
    expect(useModelStore.getState().providers[0].name).toBe("My Provider");
  });
});

describe("addProviderTemplate", () => {
  it("adds provider and sets default model for matching capability", () => {
    const id = useModelStore.getState().addProviderTemplate({
      name: "GPT Provider",
      protocol: "openai",
      capability: "text",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-xxx",
      models: [{ id: "gpt-4", name: "GPT-4", checked: true }],
    });
    expect(useModelStore.getState().defaultTextModel).toEqual({
      providerId: id,
      modelId: "gpt-4",
    });
  });

  it("does not set default for non-matching capability", () => {
    useModelStore.getState().addProviderTemplate({
      name: "Image Provider",
      protocol: "sensenova",
      capability: "image",
      baseUrl: "https://api.sensenova.cn/v1",
      apiKey: "sk-xxx",
      models: [{ id: "sensenova-u1", name: "SenseNova U1", checked: true }],
    });
    expect(useModelStore.getState().defaultTextModel).toBeNull();
  });
});

describe("removeProvider", () => {
  it("removes provider and clears related defaults", () => {
    const id = useModelStore.getState().addProvider({
      name: "Test",
      protocol: "openai",
      capability: "text",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-xxx",
    });
    useModelStore.getState().setDefaultTextModel({ providerId: id, modelId: "gpt-4" });
    useModelStore.getState().removeProvider(id);
    expect(useModelStore.getState().providers).toHaveLength(0);
    expect(useModelStore.getState().defaultTextModel).toBeNull();
  });
});

describe("getModelConfig", () => {
  it("returns null for all when no defaults set", () => {
    const config = useModelStore.getState().getModelConfig();
    expect(config.text).toBeNull();
    expect(config.image).toBeNull();
    expect(config.video).toBeNull();
  });

  it("returns valid text config when defaults are set", () => {
    const id = useModelStore.getState().addProvider({
      name: "GPT",
      protocol: "openai",
      capability: "text",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-xxx",
    });
    useModelStore.getState().addManualModel(id, "gpt-4");
    useModelStore.getState().setDefaultTextModel({ providerId: id, modelId: "gpt-4" });
    const config = useModelStore.getState().getModelConfig();
    expect(config.text).toEqual({
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-xxx",
      modelId: "gpt-4",
    });
  });

  it("returns null text when provider capability is not 'text'", () => {
    const id = useModelStore.getState().addProvider({
      name: "Image Provider",
      protocol: "sensenova",
      capability: "image",
      baseUrl: "https://api.sensenova.cn/v1",
      apiKey: "sk-xxx",
    });
    // Set defaultTextModel to an image-only provider
    useModelStore.getState().setDefaultTextModel({ providerId: id, modelId: "sensenova-u1" });
    // We also need to add a model since toggleModel checks models exist
    useModelStore.getState().addManualModel(id, "sensenova-u1");
    const config = useModelStore.getState().getModelConfig();
    // getModelConfig should reject because capability !== "text"
    expect(config.text).toBeNull();
  });

  it("returns null when model is not checked", () => {
    const id = useModelStore.getState().addProvider({
      name: "GPT",
      protocol: "openai",
      capability: "text",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-xxx",
    });
    useModelStore.getState().addManualModel(id, "gpt-4");
    // DefaultTextModel points to gpt-4 which was just added (checked=true)
    useModelStore.getState().setDefaultTextModel({ providerId: id, modelId: "gpt-4" });
    // Toggle it off
    useModelStore.getState().toggleModel(id, "gpt-4");
    const config = useModelStore.getState().getModelConfig();
    expect(config.text).toBeNull();
  });
});

describe("toggle/remove model", () => {
  it("toggles model checked state", () => {
    const id = useModelStore.getState().addProvider({
      name: "Test",
      protocol: "openai",
      capability: "text",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-xxx",
    });
    useModelStore.getState().addManualModel(id, "gpt-4");
    expect(useModelStore.getState().providers[0].models[0].checked).toBe(true);
    useModelStore.getState().toggleModel(id, "gpt-4");
    expect(useModelStore.getState().providers[0].models[0].checked).toBe(false);
  });

  it("removes a model", () => {
    const id = useModelStore.getState().addProvider({
      name: "Test",
      protocol: "openai",
      capability: "text",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-xxx",
    });
    useModelStore.getState().addManualModel(id, "gpt-4");
    expect(useModelStore.getState().providers[0].models).toHaveLength(1);
    useModelStore.getState().removeModel(id, "gpt-4");
    expect(useModelStore.getState().providers[0].models).toHaveLength(0);
  });
});

describe("updateProvider", () => {
  it("updates provider fields", () => {
    const id = useModelStore.getState().addProvider({
      name: "Original",
      protocol: "openai",
      capability: "text",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-xxx",
    });
    useModelStore.getState().updateProvider(id, { name: "Updated" });
    expect(useModelStore.getState().providers[0].name).toBe("Updated");
  });
});
