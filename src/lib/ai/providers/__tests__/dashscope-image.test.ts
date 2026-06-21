import { describe, it, expect, vi, beforeEach } from "vitest";
import { DashScopeImageProvider, getModelFamily, resolveSize } from "../dashscope-image";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "ds-id") }));

const mockPipeline = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("node:stream/promises", () => ({ pipeline: mockPipeline }));

const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(() => true), mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn() },
  existsSync: vi.fn(() => true), mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn(),
}));

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockMkdirSync.mockClear();
  mockWriteFileSync.mockClear();
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url.includes("/multimodal-generation/generation")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ output: { choices: [{ message: { content: [{ image: "https://dashscope.aliyuncs.com/img.png" }] } }] } }),
      });
    }
    if (url.includes("aliyuncs.com") || url.includes("dashscope")) {
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    return Promise.resolve({ ok: false });
  }) as any);
});

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new DashScopeImageProvider(params);
}

describe("getModelFamily", () => {
  it("detects wan family", () => {
    expect(getModelFamily("wan2.1-t2i")).toBe("wan");
    expect(getModelFamily("wan-v1")).toBe("wan");
  });

  it("detects zimage family", () => {
    expect(getModelFamily("z-image-turbo")).toBe("zimage");
  });

  it("defaults to qwen family", () => {
    expect(getModelFamily("qwen-image-2.0-pro")).toBe("qwen");
    expect(getModelFamily("unknown-model")).toBe("qwen");
    expect(getModelFamily("")).toBe("qwen");
  });
});

describe("resolveSize", () => {
  it("prefers explicit size", () => {
    expect(resolveSize("qwen", "1024x1024", "16:9")).toBe("1024x1024");
  });

  it("maps wan aspect ratio", () => {
    expect(resolveSize("wan", undefined, "16:9")).toBe("1280*720");
    expect(resolveSize("wan", undefined, "1:1")).toBe("1024*1024");
  });

  it("maps qwen aspect ratio", () => {
    expect(resolveSize("qwen", undefined, "16:9")).toBe("2048*1152");
    expect(resolveSize("qwen", undefined, "9:16")).toBe("1152*2048");
  });

  it("maps zimage aspect ratio", () => {
    expect(resolveSize("zimage", undefined, "16:9")).toBe("1536*1024");
    expect(resolveSize("zimage", undefined, "4:3")).toBe("1024*768");
  });

  it("returns family-specific default when no size or aspectRatio", () => {
    expect(resolveSize("wan", undefined, undefined)).toBe("1024*1024");
    expect(resolveSize("qwen", undefined, undefined)).toBe("2048*2048");
    expect(resolveSize("zimage", undefined, undefined)).toBe("1024*1536");
  });

  it("returns undefined for unknown aspect ratio", () => {
    expect(resolveSize("wan", undefined, "21:9")).toBeUndefined();
  });
});

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "");
    vi.stubEnv("DASHSCOPE_BASE_URL", "");
    vi.stubEnv("DASHSCOPE_IMAGE_MODEL", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    expect((p as any).baseUrl).toBe("https://dashscope.aliyuncs.com/api/v1");
    expect((p as any).model).toBe("qwen-image-2.0-pro");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("reads from env vars", () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "ds-key");
    vi.stubEnv("DASHSCOPE_BASE_URL", "https://ds.example.com/v1");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("ds-key");
    expect((p as any).baseUrl).toBe("https://ds.example.com/v1");
    vi.unstubAllEnvs();
  });

  it("constructor params override env", () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "env-key");
    const p = makeProvider({ apiKey: "ctor-key", model: "wan2.1-t2i" });
    expect((p as any).apiKey).toBe("ctor-key");
    expect((p as any).model).toBe("wan2.1-t2i");
    vi.unstubAllEnvs();
  });

  it("strips trailing slash from baseUrl", () => {
    const p = makeProvider({ baseUrl: "https://ds.example.com/v1/" });
    expect((p as any).baseUrl).toBe("https://ds.example.com/v1");
  });
});

describe("generateText", () => {
  it("throws not supported", async () => {
    const p = makeProvider();
    await expect((p.generateText as any)("hi")).rejects.toThrow("not support");
  });
});

describe("generateImage", () => {
  it("sends correct body for qwen model", async () => {
    const p = makeProvider({ apiKey: "ds-key" });
    await p.generateImage("a cat");
    const call = fetchCalls.find(c => c.url.includes("/multimodal-generation/generation"));
    const body = JSON.parse(call!.options!.body as string);
    expect(body.model).toBe("qwen-image-2.0-pro");
    expect(body.input.messages[0].content[0].text).toBe("a cat");
    expect(body.parameters.size).toBe("2048*2048");
    expect(body.parameters.n).toBe(1);
  });

  it("detects wan family and uses wan size", async () => {
    const p = makeProvider({ apiKey: "ds-key", model: "wan2.1-t2i" });
    await p.generateImage("a cat");
    const call = fetchCalls.find(c => c.url.includes("/multimodal-generation/generation"));
    const body = JSON.parse(call!.options!.body as string);
    expect(body.model).toBe("wan2.1-t2i");
    expect(body.parameters.size).toBe("1024*1024");
  });

  it("detects zimage and omits n parameter", async () => {
    const p = makeProvider({ apiKey: "ds-key", model: "z-image-turbo" });
    await p.generateImage("a cat", { aspectRatio: "16:9" });
    const call = fetchCalls.find(c => c.url.includes("/multimodal-generation/generation"));
    const body = JSON.parse(call!.options!.body as string);
    expect(body.model).toBe("z-image-turbo");
    expect(body.parameters.size).toBe("1536*1024");
    expect(body.parameters.n).toBeUndefined();
  });

  it("uses model override from options", async () => {
    const p = makeProvider({ apiKey: "ds-key" });
    await p.generateImage("a cat", { model: "wan2.1-t2i" });
    const call = fetchCalls.find(c => c.url.includes("/multimodal-generation/generation"));
    const body = JSON.parse(call!.options!.body as string);
    expect(body.model).toBe("wan2.1-t2i");
    expect(body.parameters.size).toBe("1024*1024");
  });

  it("uses explicit size over aspectRatio", async () => {
    const p = makeProvider({ apiKey: "ds-key" });
    await p.generateImage("a cat", { size: "512x512", aspectRatio: "16:9" });
    const call = fetchCalls.find(c => c.url.includes("/multimodal-generation/generation"));
    expect(JSON.parse(call!.options!.body as string).parameters.size).toBe("512x512");
  });

  it("uses Bearer token auth", async () => {
    const p = makeProvider({ apiKey: "ds-secret" });
    await p.generateImage("a cat");
    const call = fetchCalls.find(c => c.url.includes("/multimodal-generation/generation"));
    const headers = call!.options!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ds-secret");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/multimodal-generation/generation")) return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "ds" });
    await expect(p.generateImage("cat")).rejects.toThrow("DashScope image request failed: 401");
  });

  it("throws on API error code", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/multimodal-generation/generation")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: "BadRequest", message: "invalid" }) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ds" });
    await expect(p.generateImage("cat")).rejects.toThrow("DashScope image error [BadRequest]");
  });

  it("throws when no image URL in response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/multimodal-generation/generation")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { choices: [] } }) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ds" });
    await expect(p.generateImage("cat")).rejects.toThrow("DashScope image: no image URL in response");
  });

  it("throws on download failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/multimodal-generation/generation")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { choices: [{ message: { content: [{ image: "https://dashscope.aliyuncs.com/img.png" }] } }] } }) });
      if (url.includes("aliyuncs.com/img.png")) return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("forbidden") });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ds" });
    await expect(p.generateImage("cat")).rejects.toThrow("DashScope image: failed to download image (403)");
  });

  it("downloads and saves file", async () => {
    const p = makeProvider({ apiKey: "ds", uploadDir: "/tmp/up" });
    const result = await p.generateImage("a cat");
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringMatching(/tmp[\\/]up[\\/]images/), { recursive: true });
    expect(mockPipeline).toHaveBeenCalled();
    expect(result).toContain("ds-id.png");
  });
});

describe("AbortSignal", () => {
  it("passes signal to fetch call", async () => {
    const p = makeProvider({ apiKey: "ds-key" });
    await p.generateImage("a cat");
    const call = fetchCalls.find(c => c.url.includes("/multimodal-generation/generation"));
    expect(call!.options!.signal).toBeDefined();
  });
});

describe("JSON parse error", () => {
  it("throws on malformed JSON in response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/multimodal-generation/generation")) {
        return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ds" });
    await expect(p.generateImage("cat")).rejects.toThrow(SyntaxError);
  });
});

describe("network error", () => {
  it("throws when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/multimodal-generation/generation")) {
        return Promise.reject(new TypeError("fetch failed"));
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ds" });
    await expect(p.generateImage("cat")).rejects.toThrow(TypeError);
  });
});

describe("missing API key", () => {
  it("throws when no API key is provided", async () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url.includes("/multimodal-generation/generation")) {
        const headers = options?.headers as Record<string, string>;
        if (!headers?.Authorization || headers.Authorization === "Bearer ") {
          return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { choices: [{ message: { content: [{ image: "https://dashscope.aliyuncs.com/img.png" }] } }] } }) });
      }
      if (url.includes("aliyuncs.com") || url.includes("dashscope")) return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      return Promise.resolve({ ok: false });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("DashScope image request failed: 401");
    vi.unstubAllEnvs();
  });
});
