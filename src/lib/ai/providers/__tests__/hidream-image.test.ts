import { describe, it, expect, vi, beforeEach } from "vitest";
import { HiDreamImageProvider } from "../hidream-image";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "hd-id") }));

const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockReadFileSync = vi.hoisted(() => vi.fn(() => Buffer.from("img-data")));
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  default: { existsSync: mockExistsSync, readFileSync: mockReadFileSync, mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync },
  existsSync: mockExistsSync, readFileSync: mockReadFileSync, mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync,
}));

function sseStream(events: string[]): ReadableStream {
  const encoder = new TextEncoder();
  let idx = 0;
  return new ReadableStream({
    pull(controller) {
      if (idx < events.length) {
        controller.enqueue(encoder.encode(events[idx] + "\n"));
        idx++;
      } else {
        controller.close();
      }
    },
  });
}

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockExistsSync.mockClear();
  mockReadFileSync.mockClear();
  mockMkdirSync.mockClear();
  mockWriteFileSync.mockClear();
  fetchCalls = [];
});

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new HiDreamImageProvider(params);
}

function setupDefaultMocks(imageBase64 = "aW1hZ2UtZGF0YQ==") {
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url.includes("/api/generate/start")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ job_id: "job-1" }) });
    }
    if (url.includes("/api/generate/stream/")) {
      return Promise.resolve({
        ok: true,
        body: sseStream([`data: {"type":"done","image":"${imageBase64}"}`]),
      });
    }
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  }) as any);
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).baseUrl).toBe("http://localhost:7860");
    expect((p as any).model).toBe("HiDream-O1-Image-Dev");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("constructor params override defaults", () => {
    const p = makeProvider({ baseUrl: "http://192.168.1.100:7860", model: "HiDream-Pro" });
    expect((p as any).baseUrl).toBe("http://192.168.1.100:7860");
    expect((p as any).model).toBe("HiDream-Pro");
  });

  it("strips trailing slash from baseUrl", () => {
    const p = makeProvider({ baseUrl: "http://localhost:7860/" });
    expect((p as any).baseUrl).toBe("http://localhost:7860");
  });
});

describe("generateText", () => {
  it("throws not supported", async () => {
    const p = makeProvider();
    await expect((p.generateText as any)("hi")).rejects.toThrow("not support");
  });
});

describe("generateImage", () => {
  it("uses t2i mode with no reference images", async () => {
    setupDefaultMocks();
    const p = makeProvider();
    await p.generateImage("a cat");
    const startCall = fetchCalls.find(c => c.url.includes("/api/generate/start"));
    const body = JSON.parse(startCall!.options!.body as string);
    expect(body.mode).toBe("t2i");
    expect(body.prompt).toBe("a cat");
    expect(body.refs_b64).toEqual([]);
    expect(body.keep_original_aspect).toBe(false);
  });

  it("uses edit mode with one reference image", async () => {
    setupDefaultMocks();
    const p = makeProvider();
    await p.generateImage("edit this", { referenceImages: ["ref.png"] });
    const startCall = fetchCalls.find(c => c.url.includes("/api/generate/start"));
    const body = JSON.parse(startCall!.options!.body as string);
    expect(body.mode).toBe("edit");
    expect(body.refs_b64).toHaveLength(1);
    expect(body.keep_original_aspect).toBe(true);
  });

  it("uses subject mode with two reference images", async () => {
    setupDefaultMocks();
    const p = makeProvider();
    await p.generateImage("subject", { referenceImages: ["ref1.png", "ref2.png"] });
    const startCall = fetchCalls.find(c => c.url.includes("/api/generate/start"));
    const body = JSON.parse(startCall!.options!.body as string);
    expect(body.mode).toBe("subject");
    expect(body.refs_b64).toHaveLength(2);
    expect(body.keep_original_aspect).toBe(false);
  });

  it("limits reference images to 6", async () => {
    setupDefaultMocks();
    const p = makeProvider();
    await p.generateImage("test", { referenceImages: Array(10).fill("ref.png") });
    const startCall = fetchCalls.find(c => c.url.includes("/api/generate/start"));
    const body = JSON.parse(startCall!.options!.body as string);
    expect(body.refs_b64).toHaveLength(6);
  });

  it("parses size from options", async () => {
    setupDefaultMocks();
    const p = makeProvider();
    await p.generateImage("a cat", { size: "1024x768" });
    const startCall = fetchCalls.find(c => c.url.includes("/api/generate/start"));
    const body = JSON.parse(startCall!.options!.body as string);
    expect(body.width).toBe(1024);
    expect(body.height).toBe(768);
  });

  it("defaults to 2048x2048 with seed 32", async () => {
    setupDefaultMocks();
    const p = makeProvider();
    await p.generateImage("a cat");
    const startCall = fetchCalls.find(c => c.url.includes("/api/generate/start"));
    const body = JSON.parse(startCall!.options!.body as string);
    expect(body.width).toBe(2048);
    expect(body.height).toBe(2048);
    expect(body.seed).toBe(32);
  });

  it("decodes SSE result and saves file", async () => {
    setupDefaultMocks("ZGVjb2RlZC1pbWc=");
    const p = makeProvider({ uploadDir: "/tmp/up" });
    const result = await p.generateImage("a cat");
    expect(result).toContain("hd-id.png");
    expect(mockWriteFileSync).toHaveBeenCalledWith(expect.stringContaining("hd-id.png"), Buffer.from("ZGVjb2RlZC1pbWc=", "base64"));
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringMatching(/tmp[\\/]up[\\/]images/), { recursive: true });
  });

  it("throws on start HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/generate/start")) return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("internal error") });
      return Promise.resolve({ ok: true, body: sseStream([]) });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("HiDream start failed: 500");
  });

  it("throws when no job_id", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/generate/start")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, body: sseStream([]) });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("HiDream: no job_id returned");
  });

  it("throws on stream HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/generate/start")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ job_id: "j-1" }) });
      if (url.includes("/api/generate/stream/")) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, body: sseStream([]) });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("HiDream stream failed: 500");
  });

  it("throws on SSE error event", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/generate/start")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ job_id: "j-1" }) });
      if (url.includes("/api/generate/stream/")) return Promise.resolve({ ok: true, body: sseStream(['data: {"type":"error","message":"OOM"}']) });
      return Promise.resolve({ ok: true, body: sseStream([]) });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("HiDream error: OOM");
  });

  it("throws when stream ends without result", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/generate/start")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ job_id: "j-1" }) });
      if (url.includes("/api/generate/stream/")) return Promise.resolve({ ok: true, body: sseStream(['data: {"type":"progress","pct":50}']) });
      return Promise.resolve({ ok: true, body: sseStream([]) });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("HiDream stream ended without result");
  });

  it("passes AbortSignal to the start call", async () => {
    setupDefaultMocks();
    const p = makeProvider();
    await p.generateImage("a cat");
    const startCall = fetchCalls.find(c => c.url.includes("/api/generate/start"));
    expect(startCall!.options!.signal).toBeDefined();
  });

  it("throws on JSON parse error in start response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/generate/start")) return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      return Promise.resolve({ ok: true, body: sseStream([]) });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow(SyntaxError);
  });

  it("throws on network error during start", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/generate/start")) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve({ ok: true, body: sseStream([]) });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("fetch failed");
  });

  it("handles missing apiKey gracefully", async () => {
    setupDefaultMocks();
    const p = makeProvider({ apiKey: "" });
    const result = await p.generateImage("a cat");
    expect(result).toContain("hd-id.png");
  });
});
