import { describe, it, expect, vi, beforeEach } from "vitest";
import { SiliconFlowImageProvider } from "../siliconflow-image";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "sf-id") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn(() => Buffer.from("img-data")));

vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(() => true), readFileSync: mockReadFileSync, mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn() },
  existsSync: vi.fn(() => true), readFileSync: mockReadFileSync, mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn(),
}));

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockMkdirSync.mockClear();
  mockWriteFileSync.mockClear();
  mockReadFileSync.mockClear();
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url.includes("cdn.sf.com") || url.includes("example.com")) {
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    if (url.includes("/images/generations")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ images: [{ url: "https://cdn.sf.com/img.png" }] }) });
    }
    return Promise.resolve({ ok: false });
  }) as any);
});

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new SiliconFlowImageProvider(params);
}



describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("SILICONFLOW_API_KEY", "");
    vi.stubEnv("SILICONFLOW_BASE_URL", "");
    vi.stubEnv("SILICONFLOW_IMAGE_MODEL", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    expect((p as any).baseUrl).toBe("https://api.siliconflow.cn/v1");
    expect((p as any).model).toBe("black-forest-labs/FLUX.1-dev");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("reads from env vars", () => {
    vi.stubEnv("SILICONFLOW_API_KEY", "sf-key");
    vi.stubEnv("SILICONFLOW_BASE_URL", "https://sf.example.com/v1");
    vi.stubEnv("SILICONFLOW_IMAGE_MODEL", "stabilityai/stable-diffusion-3");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("sf-key");
    expect((p as any).baseUrl).toBe("https://sf.example.com/v1");
    expect((p as any).model).toBe("stabilityai/stable-diffusion-3");
    vi.unstubAllEnvs();
  });

  it("constructor params override env", () => {
    vi.stubEnv("SILICONFLOW_API_KEY", "env-key");
    const p = makeProvider({ apiKey: "ctor-key", model: "custom/model" });
    expect((p as any).apiKey).toBe("ctor-key");
    expect((p as any).model).toBe("custom/model");
    vi.unstubAllEnvs();
  });

  it("strips trailing slash from baseUrl", () => {
    const p = makeProvider({ baseUrl: "https://sf.example.com/v1/" });
    expect((p as any).baseUrl).toBe("https://sf.example.com/v1");
  });
});

describe("generateText", () => {
  it("throws not supported", async () => {
    const p = makeProvider();
    await expect((p.generateText as any)("hi")).rejects.toThrow("not support");
  });
});

describe("generateImage", () => {
  it("sends correct default body", async () => {
    const p = makeProvider({ apiKey: "sk-sf" });
    await p.generateImage("a cat");
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    const body = JSON.parse(call!.options!.body as string);
    expect(body.model).toBe("black-forest-labs/FLUX.1-dev");
    expect(body.prompt).toBe("a cat");
    expect(body.image_size).toBe("1024x1024");
    expect(body.batch_size).toBe(1);
    expect(body.image).toBeUndefined();
  });

  it("uses model override from options", async () => {
    const p = makeProvider({ apiKey: "sk-sf" });
    await p.generateImage("a cat", { model: "stabilityai/stable-diffusion-3" });
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    expect(JSON.parse(call!.options!.body as string).model).toBe("stabilityai/stable-diffusion-3");
  });

  it("resolves image_size from aspectRatio", async () => {
    const p = makeProvider({ apiKey: "sk-sf" });
    await p.generateImage("a cat", { aspectRatio: "1:1" });
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    expect(JSON.parse(call!.options!.body as string).image_size).toBe("1024x1024");
  });

  it("resolves image_size from explicit size", async () => {
    const p = makeProvider({ apiKey: "sk-sf" });
    await p.generateImage("a cat", { size: "512x768" });
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    expect(JSON.parse(call!.options!.body as string).image_size).toBe("512x768");
  });

  it("sends reference image as image field for img2img", async () => {
    const p = makeProvider({ apiKey: "sk-sf" });
    await p.generateImage("a cat", { referenceImages: ["ref.png"] });
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    const body = JSON.parse(call!.options!.body as string);
    expect(body.image).toMatch(/^data:image\/png;base64,/);
    expect(mockReadFileSync).toHaveBeenCalledWith("ref.png");
  });

  it("passes HTTP reference URL as-is", async () => {
    const p = makeProvider({ apiKey: "sk-sf" });
    await p.generateImage("a cat", { referenceImages: ["https://example.com/ref.png"] });
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    const body = JSON.parse(call!.options!.body as string);
    expect(body.image).toBe("https://example.com/ref.png");
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("uses Bearer token auth", async () => {
    const p = makeProvider({ apiKey: "sk-sf-key" });
    await p.generateImage("a cat");
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    const headers = call!.options!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-sf-key");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "sk" });
    await expect(p.generateImage("cat")).rejects.toThrow("SiliconFlow image request failed: 401");
  });

  it("throws on error code in response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 400, message: "bad prompt" }) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "sk" });
    await expect(p.generateImage("cat")).rejects.toThrow("SiliconFlow error [400]");
  });

  it("throws when no image in response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "sk" });
    await expect(p.generateImage("cat")).rejects.toThrow("SiliconFlow: no image in response");
  });

  it("throws on download failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ images: [{ url: "https://cdn.sf.com/img.png" }] }) });
      if (url.includes("cdn.sf.com")) return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("forbidden") });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "sk" });
    await expect(p.generateImage("cat")).rejects.toThrow("SiliconFlow: download failed (403)");
  });

  it("downloads and saves file", async () => {
    const p = makeProvider({ apiKey: "sk", uploadDir: "/tmp/up" });
    await p.generateImage("a cat");
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringMatching(/tmp[\\/]up[\\/]images/), { recursive: true });
  });

  it("passes AbortSignal to the fetch call", async () => {
    const p = makeProvider({ apiKey: "sk-sf" });
    await p.generateImage("a cat");
    const call = fetchCalls.find(c => c.url.includes("/images/generations"));
    expect(call!.options!.signal).toBeDefined();
  });

  it("throws on JSON parse error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "sk" });
    await expect(p.generateImage("cat")).rejects.toThrow(SyntaxError);
  });

  it("throws on network error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "sk" });
    await expect(p.generateImage("cat")).rejects.toThrow("fetch failed");
  });

  it("throws on missing apiKey", async () => {
    vi.stubEnv("SILICONFLOW_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/images/generations")) return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("SiliconFlow image request failed: 401");
    vi.unstubAllEnvs();
  });
});
