import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiProvider } from "../gemini";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "gemini-test-id") }));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => Buffer.from("img")),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => Buffer.from("img")),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const mockGenerateContent = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => {
  function MockGoogleGenAI(options: Record<string, unknown>) {
    return {
      apiKey: (options as any).apiKey,
      httpOptions: (options as any).httpOptions,
      models: { generateContent: mockGenerateContent },
    };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateContent.mockReset();
});

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new GeminiProvider(params);
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).defaultModel).toBe("gemini-2.0-flash");
    expect((p as any).uploadDir).toBe("./uploads");
    expect((p as any).client.apiKey).toBe("");
    vi.unstubAllEnvs();
  });

  it("reads from env vars", () => {
    vi.stubEnv("GEMINI_API_KEY", "env-key");
    vi.stubEnv("UPLOAD_DIR", "/tmp/env");
    const p = makeProvider();
    expect((p as any).client.apiKey).toBe("env-key");
    expect((p as any).uploadDir).toBe("/tmp/env");
    vi.unstubAllEnvs();
  });

  it("constructor params override env vars", () => {
    vi.stubEnv("GEMINI_API_KEY", "env-key");
    const p = makeProvider({ apiKey: "ctor-key", model: "ctor-model", baseUrl: "https://ctor.example.com" });
    expect((p as any).client.apiKey).toBe("ctor-key");
    expect((p as any).defaultModel).toBe("ctor-model");
    expect((p as any).client.httpOptions.baseUrl).toBe("https://ctor.example.com");
    vi.unstubAllEnvs();
  });

  it("strips trailing path segments from baseUrl", () => {
    const p = makeProvider({ baseUrl: "https://example.com/v1beta/" });
    expect((p as any).client.httpOptions.baseUrl).toBe("https://example.com");
  });

  it("handles missing API key gracefully", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const p = makeProvider();
    expect((p as any).client.apiKey).toBe("");
    vi.unstubAllEnvs();
  });
});

describe("generateText", () => {
  it("returns text from generateContent", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "Hello world" });
    const result = await makeProvider().generateText("say hi");
    expect(result).toBe("Hello world");
  });

  it("includes prompt in contents", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "ok" });
    await makeProvider().generateText("hello");
    const args = mockGenerateContent.mock.calls[0][0];
    expect(args.contents[0].parts[0].text).toBe("hello");
  });

  it("includes system prompt in config", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "ok" });
    await makeProvider().generateText("do it", { systemPrompt: "You are helpful" });
    const args = mockGenerateContent.mock.calls[0][0];
    expect(args.config.systemInstruction).toBe("You are helpful");
  });

  it("passes temperature and maxTokens", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "ok" });
    await makeProvider().generateText("hi", { temperature: 0.3, maxTokens: 200 });
    const args = mockGenerateContent.mock.calls[0][0];
    expect(args.config.temperature).toBe(0.3);
    expect(args.config.maxOutputTokens).toBe(200);
  });

  it("passes custom model", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "ok" });
    await makeProvider().generateText("hi", { model: "gemini-2.5-pro" });
    expect(mockGenerateContent.mock.calls[0][0].model).toBe("gemini-2.5-pro");
  });

  it("encodes local images as inlineData", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: "ok" });
    await makeProvider().generateText("describe", { images: ["cat.png"] });
    const args = mockGenerateContent.mock.calls[0][0];
    const parts = args.contents[0].parts;
    expect(parts[0].inlineData).toBeDefined();
    expect(parts[0].inlineData.mimeType).toBe("image/png");
    expect(parts[0].inlineData.data).toBeTruthy();
    expect(parts[1].text).toBe("describe");
  });

  it("returns empty string when no text", async () => {
    mockGenerateContent.mockResolvedValueOnce({});
    const result = await makeProvider().generateText("hi");
    expect(result).toBe("");
  });

  it("throws on network error from Gemini SDK", async () => {
    mockGenerateContent.mockRejectedValue(new Error("NETWORK_ERROR"));
    await expect(makeProvider().generateText("hi")).rejects.toThrow("NETWORK_ERROR");
  });
});

describe("generateImage", () => {
  it("returns file path when inlineData returned", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }],
    });
    const result = await makeProvider().generateImage("a cat");
    expect(result).toContain("gemini-test-id.png");
  });

  it("uses jpg extension for jpeg mimeType", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: "aW1hZ2U=" } }] } }],
    });
    const result = await makeProvider().generateImage("a cat");
    expect(result).toContain("gemini-test-id.jpg");
  });

  it("throws when no candidates returned", async () => {
    mockGenerateContent.mockResolvedValueOnce({ candidates: [] });
    await expect(makeProvider().generateImage("a cat")).rejects.toThrow("No image returned");
  });

  it("throws when no inlineData in response parts", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ text: "sorry, I can't do that" }] } }],
    });
    await expect(makeProvider().generateImage("a cat")).rejects.toThrow("No image data found");
  });

  it("throws when response has unexpected shape", async () => {
    mockGenerateContent.mockResolvedValueOnce({ unexpected: "shape" });
    await expect(makeProvider().generateImage("a cat")).rejects.toThrow("No image returned from Gemini");
  });

  it("passes custom model", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }],
    });
    await makeProvider().generateImage("a cat", { model: "gemini-2.0-flash-exp" });
    expect(mockGenerateContent.mock.calls[0][0].model).toBe("gemini-2.0-flash-exp");
  });

  it("throws on network error from Gemini SDK in generateImage", async () => {
    mockGenerateContent.mockRejectedValue(new Error("Rate limit exceeded"));
    await expect(makeProvider().generateImage("a cat")).rejects.toThrow("Rate limit exceeded");
  });

  describe("reference images", () => {
    it("includes reference images as inlineData with labels", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }],
      });
      await makeProvider().generateImage("draw a scene", { referenceImages: ["char1.png", "char2.png"], referenceLabels: ["Alice", "Bob"] });
      const args = mockGenerateContent.mock.calls[0][0];
      const parts = args.contents[0].parts;
      expect(parts[0].text).toContain("Alice");
      expect(parts[1].inlineData).toBeDefined();
      expect(parts[2].text).toContain("Bob");
      expect(parts[3].inlineData).toBeDefined();
      expect(parts[4].text).toContain("CHARACTER CONSISTENCY RULES");
      expect(parts[4].text).toContain("draw a scene");
    });

    it("uses generic labels when referenceLabels not provided", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }],
      });
      await makeProvider().generateImage("draw a scene", { referenceImages: ["char1.png"] });
      const args = mockGenerateContent.mock.calls[0][0];
      const parts = args.contents[0].parts;
      expect(parts[0].text).toBe("[Reference Image 1]");
    });

    it("limits to 6 reference images", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }],
      });
      await makeProvider().generateImage("draw a scene", { referenceImages: Array.from({ length: 10 }, (_, i) => `img${i}.png`) });
      const args = mockGenerateContent.mock.calls[0][0];
      const textParts = args.contents[0].parts.filter((p: any) => p.text);
      // 6 refs → 6 labels + 1 end block = 7 text parts, plus inline data parts
      expect(textParts.length).toBe(7);
    });

    it("uses plain prompt when no reference images given", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }],
      });
      await makeProvider().generateImage("just a cat");
      const args = mockGenerateContent.mock.calls[0][0];
      const parts = args.contents[0].parts;
      expect(parts[0].text).toBe("just a cat");
    });
  });
});
