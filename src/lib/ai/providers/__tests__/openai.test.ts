import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIProvider } from "../openai";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "openai-test-id") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => Buffer.from("img")),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    createWriteStream: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => Buffer.from("img")),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

const mockChatCreate = vi.hoisted(() => vi.fn());
const mockImageGenerate = vi.hoisted(() => vi.fn());
let mockClientOpts: Record<string, unknown>;
let mockImageOpts: Record<string, unknown>;

vi.mock("openai", () => {
  function MockOpenAI(opts?: Record<string, unknown>) {
    if (opts) {
      mockClientOpts = { ...opts };
    }
    return {
      apiKey: (opts as any)?.apiKey,
      baseURL: (opts as any)?.baseURL,
      chat: { completions: { create: mockChatCreate } },
      images: { generate: mockImageGenerate },
    };
  }
  MockOpenAI.toFile = vi.fn();
  return { default: MockOpenAI, toFile: vi.fn() };
});

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockChatCreate.mockReset();
  mockImageGenerate.mockReset();
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

function makeProvider(params?: { apiKey?: string; baseURL?: string; model?: string; uploadDir?: string }) {
  return new OpenAIProvider(params);
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("OPENAI_MODEL", "");
    vi.stubEnv("UPLOAD_DIR", "");
    vi.stubEnv("IMAGEGEN_API_KEY", "");
    vi.stubEnv("IMAGEGEN_BASE_URL", "");
    const p = makeProvider();
    expect((p as any).defaultModel).toBe("gpt-4o");
    expect((p as any).uploadDir).toBe("./uploads");
    expect((p as any).isNvidia).toBe(false);
    vi.unstubAllEnvs();
  });

  it("reads from env vars", () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://env.example.com/v1");
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    vi.stubEnv("UPLOAD_DIR", "/tmp/env");
    const p = makeProvider();
    expect((p as any).defaultModel).toBe("gpt-4o-mini");
    expect((p as any).uploadDir).toBe("/tmp/env");
    expect((p as any).baseURL).toBe("https://env.example.com/v1");
    vi.unstubAllEnvs();
  });

  it("constructor params override env vars", () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://env.example.com/v1");
    const p = makeProvider({ apiKey: "ctor-key", baseURL: "https://ctor.example.com/v1", model: "ctor-model" });
    expect((p as any).defaultModel).toBe("ctor-model");
    expect((p as any).baseURL).toBe("https://ctor.example.com/v1");
    vi.unstubAllEnvs();
  });

  it("sets isNvidia for NVIDIA base URL", () => {
    const p = makeProvider({ baseURL: "https://integrate.api.nvidia.com/v1" });
    expect((p as any).isNvidia).toBe(true);
  });

  it("uses IMAGEGEN_API_KEY as fallback when no image params given", () => {
    vi.stubEnv("IMAGEGEN_API_KEY", "img-key");
    vi.stubEnv("IMAGEGEN_BASE_URL", "https://img.example.com/v1");
    const p = makeProvider();
    expect((p as any).imageClient.apiKey).toBe("img-key");
    expect((p as any).imageClient.baseURL).toBe("https://img.example.com/v1");
    vi.unstubAllEnvs();
  });

  it("params.apiKey takes precedence over IMAGEGEN_API_KEY", () => {
    vi.stubEnv("IMAGEGEN_API_KEY", "img-key");
    vi.stubEnv("IMAGEGEN_BASE_URL", "https://img.example.com/v1");
    const p = makeProvider({ apiKey: "agnes-key", baseURL: "https://apihub.agnes-ai.com/v1" });
    expect((p as any).client.apiKey).toBe("agnes-key");
    expect((p as any).imageClient.apiKey).toBe("agnes-key");
    expect((p as any).imageClient.baseURL).toBe("https://apihub.agnes-ai.com/v1");
    vi.unstubAllEnvs();
  });

  it("handles missing API key gracefully", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("IMAGEGEN_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    const p = makeProvider();
    expect((p as any).client.apiKey).toBe("");
    expect((p as any).imageClient.apiKey).toBe("");
    vi.unstubAllEnvs();
  });
});

describe("generateText", () => {
  it("returns content from chat completion", async () => {
    mockChatCreate.mockResolvedValueOnce({ choices: [{ message: { content: "Hello world" } }] });
    const result = await makeProvider().generateText("say hi");
    expect(result).toBe("Hello world");
  });

  it("includes system prompt", async () => {
    mockChatCreate.mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });
    await makeProvider().generateText("do it", { systemPrompt: "You are helpful" });
    const args = mockChatCreate.mock.calls[0][0];
    expect(args.messages[0].role).toBe("system");
    expect(args.messages[0].content).toBe("You are helpful");
    expect(args.messages[1].content).toBe("do it");
  });

  it("passes temperature and maxTokens", async () => {
    mockChatCreate.mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });
    await makeProvider().generateText("hi", { temperature: 0.5, maxTokens: 100 });
    const args = mockChatCreate.mock.calls[0][0];
    expect(args.temperature).toBe(0.5);
    expect(args.max_tokens).toBe(100);
  });

  it("passes custom model", async () => {
    mockChatCreate.mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });
    await makeProvider().generateText("hi", { model: "gpt-4-turbo" });
    expect(mockChatCreate.mock.calls[0][0].model).toBe("gpt-4-turbo");
  });

  it("encodes local images as base64 when vision is supported", async () => {
    mockChatCreate.mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });
    await makeProvider().generateText("describe", { images: ["cat.png"] });
    const args = mockChatCreate.mock.calls[0][0];
    const userMsg = args.messages[0];
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBeInstanceOf(Array);
    const parts = userMsg.content as Array<Record<string, unknown>>;
    expect(parts[0].type).toBe("image_url");
    expect((parts[0].image_url as Record<string, string>).url).toMatch(/^data:image\/png;base64,/);
    expect(parts[1].type).toBe("text");
    expect(parts[1].text).toBe("describe");
  });

  it("adds fallback note when model does not support vision", async () => {
    mockChatCreate.mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });
    const p = makeProvider({ baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" });
    await p.generateText("describe", { images: ["cat.png"] });
    const args = mockChatCreate.mock.calls[0][0];
    const userMsg = args.messages[0];
    expect(typeof userMsg.content).toBe("string");
    expect(userMsg.content).toContain("does not support image inputs");
    expect(userMsg.content).toContain("describe");
  });

  it("does not retry on 429 for non-NVIDIA (maxAttempts=1)", async () => {
    const err429 = Object.assign(new Error("rate limited"), { status: 429 });
    mockChatCreate.mockRejectedValue(err429);
    await expect(makeProvider().generateText("hi")).rejects.toThrow("rate limited");
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it("throws on non-429 error without retry", async () => {
    mockChatCreate.mockRejectedValue(new Error("bad request"));
    await expect(makeProvider().generateText("hi")).rejects.toThrow("bad request");
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it("throws on network error from OpenAI SDK", async () => {
    mockChatCreate.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(makeProvider().generateText("hi")).rejects.toThrow("connect ECONNREFUSED");
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it("returns empty string when no content", async () => {
    mockChatCreate.mockResolvedValue({ choices: [{ message: {} }] });
    const result = await makeProvider().generateText("hi");
    expect(result).toBe("");
  });

  it("NVIDIA provider retries up to 5 times on 429", async () => {
    mockChatCreate.mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 }));
    const p = makeProvider({ baseURL: "https://integrate.api.nvidia.com/v1" });
    await expect(p.generateText("hi")).rejects.toThrow("rate limited");
    expect(mockChatCreate).toHaveBeenCalledTimes(5);
  }, 40000);
});

describe("generateImage", () => {
  it("generates from URL in standard path", async () => {
    mockImageGenerate.mockResolvedValueOnce({ data: [{ url: "https://example.com/img.png" }] });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });
    const result = await makeProvider().generateImage("a dog");
    expect(result).toContain("openai-test-id.png");
    expect(mockImageGenerate).toHaveBeenCalledTimes(1);
  });

  it("uses default aspect ratio 16:9 when no size or aspectRatio given", async () => {
    mockImageGenerate.mockResolvedValueOnce({ data: [{ url: "https://example.com/img.png" }] });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });
    await makeProvider().generateImage("a dog");
    const args = mockImageGenerate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.aspect_ratio).toBe("16:9");
  });

  it("passes size option", async () => {
    mockImageGenerate.mockResolvedValueOnce({ data: [{ url: "https://example.com/img.png" }] });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });
    await makeProvider().generateImage("a dog", { size: "1024x1024" });
    const args = mockImageGenerate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.size).toBe("1024x1024");
    expect(args.aspect_ratio).toBeUndefined();
  });

  it("passes aspectRatio option", async () => {
    mockImageGenerate.mockResolvedValueOnce({ data: [{ url: "https://example.com/img.png" }] });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });
    await makeProvider().generateImage("a dog", { aspectRatio: "4:3" });
    const args = mockImageGenerate.mock.calls[0][0] as Record<string, unknown>;
    expect(args.aspect_ratio).toBe("4:3");
  });

  it("does not retry on 429 for non-NVIDIA in standard path", async () => {
    const err429 = Object.assign(new Error("rate limited"), { status: 429 });
    mockImageGenerate.mockRejectedValue(err429);
    await expect(makeProvider().generateImage("a dog")).rejects.toThrow("rate limited");
    expect(mockImageGenerate).toHaveBeenCalledTimes(1);
  });

  it("throws on non-429 error in standard path without retry", async () => {
    mockImageGenerate.mockRejectedValue(new Error("bad request"));
    await expect(makeProvider().generateImage("a dog")).rejects.toThrow("bad request");
    expect(mockImageGenerate).toHaveBeenCalledTimes(1);
  });

  describe("gpt-image-2", () => {
    it("returns file path from b64_json", async () => {
      mockImageGenerate.mockResolvedValue({ data: [{ b64_json: "dGVzdA==" }] });
      const p = makeProvider({ model: "gpt-image-2" });
      const result = await p.generateImage("a cat");
      expect(result).toContain("openai-test-id.png");
      expect(mockImageGenerate).toHaveBeenCalledTimes(1);
    });

    it("falls back to URL fetch when no b64_json", async () => {
      mockImageGenerate.mockResolvedValueOnce({ data: [{ url: "https://example.com/img.png" }] });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "image/png" }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const p = makeProvider({ model: "gpt-image-2" });
      const result = await p.generateImage("a cat");
      expect(result).toContain("openai-test-id.png");
    });

    it("retries on failure up to 3 attempts", async () => {
      mockImageGenerate
        .mockRejectedValueOnce(new Error("fail1"))
        .mockRejectedValueOnce(new Error("fail2"))
        .mockResolvedValueOnce({ data: [{ b64_json: "dGVzdA==" }] });
      const p = makeProvider({ model: "gpt-image-2" });
      const result = await p.generateImage("a cat");
      expect(result).toContain("openai-test-id.png");
      expect(mockImageGenerate).toHaveBeenCalledTimes(3);
    }, 12000);

    it("throws after 3 failed attempts", async () => {
      mockImageGenerate.mockRejectedValue(new Error("always fails"));
      const p = makeProvider({ model: "gpt-image-2" });
      await expect(p.generateImage("a cat")).rejects.toThrow("failed after 3 attempts");
      expect(mockImageGenerate).toHaveBeenCalledTimes(3);
    }, 12000);
  });

  describe("DALL-E", () => {
    it("passes default size 1792x1024 for DALL-E 3", async () => {
      mockImageGenerate.mockResolvedValueOnce({ data: [{ url: "https://example.com/img.png" }] });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "image/png" }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const p = makeProvider({ model: "dall-e-3" });
      await p.generateImage("a cat");
      const args = mockImageGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(args.size).toBe("1792x1024");
      expect(args.quality).toBe("standard");
    });

    it("passes valid DALL-E size and hd quality", async () => {
      mockImageGenerate.mockResolvedValueOnce({ data: [{ url: "https://example.com/img.png" }] });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "image/png" }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const p = makeProvider({ model: "dall-e-3" });
      await p.generateImage("a cat", { size: "1024x1024", quality: "hd" });
      const args = mockImageGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(args.size).toBe("1024x1024");
      expect(args.quality).toBe("hd");
    });

    it("rejects invalid DALL-E size", async () => {
      const p = makeProvider({ model: "dall-e-3" });
      await expect(p.generateImage("a cat", { size: "512x512" })).rejects.toThrow();
    });
  });

  it("throws when download fetch returns non-ok status", async () => {
    mockImageGenerate.mockResolvedValueOnce({ data: [{ url: "https://example.com/img.png" }] });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue("Bad Gateway"),
    });
    await expect(makeProvider().generateImage("a dog")).rejects.toThrow("Failed to download generated image");
    expect(mockImageGenerate).toHaveBeenCalledTimes(1);
  });

  it("passes abort signal to download fetch", async () => {
    mockImageGenerate.mockResolvedValueOnce({ data: [{ url: "https://example.com/img.png" }] });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });
    await makeProvider().generateImage("a dog");
    expect(mockFetch).toHaveBeenCalled();
    const [, options] = mockFetch.mock.calls[0];
    expect(options).toBeDefined();
    expect((options as Record<string, unknown>).signal).toBeDefined();
  });

  describe("SenseNova", () => {
    it("generates image via SenseNova images API", async () => {
      mockImageGenerate.mockResolvedValueOnce({ data: [{ url: "https://sensenova.example.com/img.png" }] });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "image/png" }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const p = makeProvider({ baseURL: "https://api.sensenova.cn/v1", model: "u1-fast" });
      const result = await p.generateImage("a cat");
      expect(result).toContain("openai-test-id.png");
      const args = mockImageGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(args.model).toBe("u1-fast");
      expect(args.n).toBe(1);
    });

    it("throws when SenseNova returns no image URL", async () => {
      mockImageGenerate.mockResolvedValueOnce({ data: [] });
      const p = makeProvider({ baseURL: "https://api.sensenova.cn/v1", model: "u1-fast" });
      await expect(p.generateImage("a cat")).rejects.toThrow("No image URL returned");
    });
  });
});
