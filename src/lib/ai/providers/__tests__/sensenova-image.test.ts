import { describe, it, expect, vi, beforeEach } from "vitest";
import { SenseNovaImageProvider, normalizeSenseNovaSize, normalizeBaseUrl } from "../sensenova-image";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "sn-id") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(() => true), readFileSync: vi.fn(() => Buffer.from("")), mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn() },
  existsSync: vi.fn(() => true), readFileSync: vi.fn(() => Buffer.from("")), mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn(),
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
    if (url.includes("/images/generations")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ url: "https://sensenova.cn/img.png" }] }) });
    }
    if (url.includes("sensenova.cn") || url.includes("example.com")) {
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    return Promise.resolve({ ok: false });
  }) as any);
});

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new SenseNovaImageProvider(params);
}

describe("normalizeSenseNovaSize", () => {
  it("maps aspect ratio to known sizes", () => {
    expect(normalizeSenseNovaSize(undefined, "16:9")).toBe("3072x1376");
    expect(normalizeSenseNovaSize(undefined, "9:16")).toBe("1344x3136");
    expect(normalizeSenseNovaSize(undefined, "1:1")).toBe("2048x2048");
  });

  it("maps known sizes to SenseNova equivalents", () => {
    expect(normalizeSenseNovaSize("2560x1440", undefined)).toBe("3072x1376");
    expect(normalizeSenseNovaSize("1024x1792", undefined)).toBe("1344x3136");
    expect(normalizeSenseNovaSize("2048x2048", undefined)).toBe("2048x2048");
    expect(normalizeSenseNovaSize("768x1024", undefined)).toBe("1536x2752");
  });

  it("falls back to 3072x1376 for unknown size", () => {
    expect(normalizeSenseNovaSize("1234x5678", undefined)).toBe("3072x1376");
    expect(normalizeSenseNovaSize(undefined, "21:9")).toBe("3072x1376");
  });
});

describe("normalizeBaseUrl", () => {
  it("uses default when no baseUrl given", () => {
    expect(normalizeBaseUrl(undefined)).toBe("https://token.sensenova.cn/v1");
  });

  it("ensures /v1 suffix", () => {
    expect(normalizeBaseUrl("https://sn.example.com")).toBe("https://sn.example.com/v1");
    expect(normalizeBaseUrl("https://sn.example.com/v1")).toBe("https://sn.example.com/v1");
  });

  it("strips trailing slash before appending", () => {
    expect(normalizeBaseUrl("https://sn.example.com/v1/")).toBe("https://sn.example.com/v1");
    expect(normalizeBaseUrl("https://sn.example.com/")).toBe("https://sn.example.com/v1");
  });
});

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    expect((p as any).baseUrl).toBe("https://token.sensenova.cn/v1");
    expect((p as any).model).toBe("sensenova-u1-fast");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("reads apiKey from OPENAI_API_KEY env", () => {
    vi.stubEnv("OPENAI_API_KEY", "sn-env-key");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("sn-env-key");
    vi.unstubAllEnvs();
  });

  it("constructor params override env", () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    const p = makeProvider({ apiKey: "ctor-key", model: "sensenova-u1" });
    expect((p as any).apiKey).toBe("ctor-key");
    expect((p as any).model).toBe("sensenova-u1");
    vi.unstubAllEnvs();
  });
});

describe("generateText", () => {
  it("throws not supported", async () => {
    const p = makeProvider();
    await expect((p.generateText as any)("hi")).rejects.toThrow("not support");
  });
});

describe("generateImage", () => {
  it("sends correct payload", async () => {
    const p = makeProvider({ apiKey: "sn-key" });
    await p.generateImage("a cat", { aspectRatio: "16:9", quality: "high" });
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    const body = JSON.parse(call!.options!.body as string);
    expect(body.model).toBe("sensenova-u1-fast");
    expect(body.prompt).toBe("a cat");
    expect(body.n).toBe(1);
    expect(body.size).toBe("3072x1376");
    expect(body.aspect_ratio).toBe("16:9");
    expect(body.quality).toBe("high");
  });

  it("resolves size from explicit size param", async () => {
    const p = makeProvider({ apiKey: "sn-key" });
    await p.generateImage("a cat", { size: "2048x2048" });
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    expect(JSON.parse(call!.options!.body as string).size).toBe("2048x2048");
  });

  it("uses Bearer token auth", async () => {
    const p = makeProvider({ apiKey: "sn-secret" });
    await p.generateImage("a cat");
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    const headers = call!.options!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sn-secret");
  });

  it("saves b64_json inline when present", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ b64_json: "aW1hZ2U=" }] }) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "sn-key" });
    await p.generateImage("a cat");
    expect(mockWriteFileSync).toHaveBeenCalledWith(expect.stringContaining("sn-id.png"), Buffer.from("aW1hZ2U=", "base64"));
  });

  it("downloads image from URL when no b64_json", async () => {
    const p = makeProvider({ apiKey: "sn-key" });
    await p.generateImage("a cat");
    const downloadCall = fetchCalls.find(c => c.url.includes("sensenova.cn/img.png"));
    expect(downloadCall).toBeDefined();
    expect(mockMkdirSync).toHaveBeenCalled();
  });

  it("saves to frames/ directory", async () => {
    const p = makeProvider({ apiKey: "sn-key", uploadDir: "/tmp/up" });
    await p.generateImage("a cat");
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringMatching(/tmp[\\/]up[\\/]frames/), { recursive: true });
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "sn" });
    await expect(p.generateImage("cat")).rejects.toThrow("SenseNova image request failed: 401");
  });

  it("throws on API error message", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ error: { message: "rate limit" } }) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "sn" });
    await expect(p.generateImage("cat")).rejects.toThrow("SenseNova image error: rate limit");
  });

  it("throws on empty response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "sn" });
    await expect(p.generateImage("cat")).rejects.toThrow("SenseNova image: empty response");
  });

  it("throws on no image payload", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{}] }) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "sn" });
    await expect(p.generateImage("cat")).rejects.toThrow("SenseNova image: no image payload");
  });

  it("throws on download failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ url: "https://sensenova.cn/img.png" }] }) });
      if (url.includes("sensenova.cn")) return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("forbidden") });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "sn" });
    await expect(p.generateImage("cat")).rejects.toThrow("SenseNova image download failed: 403");
  });

  it("passes AbortSignal to the fetch call", async () => {
    const p = makeProvider({ apiKey: "sn-key" });
    await p.generateImage("a cat");
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    expect(call!.options!.signal).toBeDefined();
  });

  it("throws on JSON parse error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "sn" });
    await expect(p.generateImage("cat")).rejects.toThrow(SyntaxError);
  });

  it("throws on network error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "sn" });
    await expect(p.generateImage("cat")).rejects.toThrow("fetch failed");
  });

  it("throws on missing apiKey", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("SenseNova image request failed: 401");
    vi.unstubAllEnvs();
  });
});
