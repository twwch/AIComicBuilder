import { describe, it, expect, vi, beforeEach } from "vitest";
import { FramepackVideoProvider } from "../framepack-video";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "fp-id") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

let mockReadFileSync = vi.hoisted(() => vi.fn(() => Buffer.from("img")));
vi.mock("node:fs", () => ({
  default: {
    readFileSync: mockReadFileSync,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    createWriteStream: vi.fn(),
  },
  readFileSync: mockReadFileSync,
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url.includes("/gradio_api/upload")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([{ name: "img.png", data: "uploaded-img-data" }]) });
    }
    if (url.includes("/gradio_api/call/process") && !url.includes("/call/process/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ event_id: "evt-1" }) });
    }
    if (url.includes("/gradio_api/call/process/")) {
      return Promise.resolve({ ok: true, text: () => Promise.resolve("event: complete\ndata: [{\"path\": \"/tmp/video.mp4\", \"url\": \"\"}]\n\n") });
    }
    if (url.includes("/gradio_api/file=") || url.includes("/tmp/video")) {
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    return Promise.resolve({ ok: true });
  }) as any);
});

function makeProvider(params?: { baseUrl?: string; uploadDir?: string }) {
  return new FramepackVideoProvider(params);
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("FRAMEPACK_BASE_URL", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).baseUrl).toBe("http://localhost:7860");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("reads from env vars", () => {
    vi.stubEnv("FRAMEPACK_BASE_URL", "http://env:7860");
    vi.stubEnv("UPLOAD_DIR", "/tmp/env");
    const p = makeProvider();
    expect((p as any).baseUrl).toBe("http://env:7860");
    expect((p as any).uploadDir).toBe("/tmp/env");
    vi.unstubAllEnvs();
  });

  it("constructor params override env vars", () => {
    vi.stubEnv("FRAMEPACK_BASE_URL", "http://env:7860");
    const p = makeProvider({ baseUrl: "http://param:7860" });
    expect((p as any).baseUrl).toBe("http://param:7860");
    vi.unstubAllEnvs();
  });

  it("strips trailing slash", () => {
    const p = makeProvider({ baseUrl: "http://example.com:7860/" });
    expect((p as any).baseUrl).toBe("http://example.com:7860");
  });
});

describe("generateVideo", () => {
  it("uploads image, starts generation, polls SSE, downloads video", async () => {
    const p = makeProvider({ uploadDir: "/tmp/up" });
    const result = await p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any);

    const uploadCall = fetchCalls.find(c => c.url.includes("/gradio_api/upload"));
    expect(uploadCall).toBeDefined();
    const startCall = fetchCalls.find(c => c.url.includes("/gradio_api/call/process") && !c.url.includes("/call/process/"));
    expect(startCall).toBeDefined();
    const pollCall = fetchCalls.find(c => c.url.includes("/gradio_api/call/process/evt-1"));
    expect(pollCall).toBeDefined();
    expect(result.filePath).toContain("fp-id.mp4");
  });

  it("uses initialImage when firstFrame not provided", async () => {
    const p = makeProvider({ uploadDir: "/tmp/up" });
    const result = await p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any);

    expect(result.filePath).toContain("fp-id.mp4");
  });

  it("throws when no image provided", async () => {
    const p = makeProvider();
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("FramePack requires an input image");
  });

  it("clamps duration between 1 and 60", async () => {
    const p = makeProvider({ uploadDir: "/tmp/up" });
    await p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 999, ratio: "16:9" } as any);

    const startCall = fetchCalls.find(c => c.url.includes("/gradio_api/call/process") && !c.url.includes("/call/process/"));
    const body = JSON.parse(startCall!.options!.body as string);
    expect(body.data[4]).toBe(60);
  });

  it("sets minimum duration to 1", async () => {
    const p = makeProvider({ uploadDir: "/tmp/up" });
    await p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: -5, ratio: "16:9" } as any);

    const startCall = fetchCalls.find(c => c.url.includes("/gradio_api/call/process") && !c.url.includes("/call/process/"));
    const body = JSON.parse(startCall!.options!.body as string);
    expect(body.data[4]).toBe(1);
  });

  it("throws on upload failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/upload")) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);

    const p = makeProvider();
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("FramePack image upload failed: 500");
  });

  it("throws on upload no data", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/upload")) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);

    const p = makeProvider();
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("FramePack image upload returned no data");
  });

  it("throws on start generation failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/upload")) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ name: "img.png", data: "d" }]) });
      if (url.includes("/gradio_api/call/process") && !url.includes("/call/process/")) return Promise.resolve({ ok: false, status: 502, text: () => Promise.resolve("bad gateway") });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);

    const p = makeProvider();
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("FramePack generation start failed: 502");
  });

  it("throws on no event_id", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/upload")) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ name: "img.png", data: "d" }]) });
      if (url.includes("/gradio_api/call/process") && !url.includes("/call/process/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);

    const p = makeProvider();
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("FramePack generation returned no event_id");
  });

  it("parses SSE with progress events before complete", async () => {
    let pollCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/upload")) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ name: "img.png", data: "d" }]) });
      if (url.includes("/gradio_api/call/process") && !url.includes("/call/process/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ event_id: "evt-2" }) });
      if (url.includes("/gradio_api/call/process/evt-2")) {
        pollCount++;
        if (pollCount === 1) return Promise.resolve({ ok: true, text: () => Promise.resolve("event: progress\ndata: {\"index\": 5, \"length\": 25, \"desc\": \"denoising\"}\n\nevent: data\ndata: [\"intermediate.png\"]\n\n") });
        return Promise.resolve({ ok: true, text: () => Promise.resolve("event: complete\ndata: [{\"path\": \"/tmp/video.mp4\"}]\n\n") });
      }
      if (url.includes("/tmp/video")) return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ uploadDir: "/tmp/up" });
    const result = await p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any);

    expect(result.filePath).toContain("fp-id.mp4");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("downloads video to uploads/videos/", async () => {
    const mockMkdirSync = vi.fn();
    const mockWriteFileSync = vi.fn();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/upload")) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ name: "img.png", data: "d" }]) });
      if (url.includes("/gradio_api/call/process") && !url.includes("/call/process/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ event_id: "evt-3" }) });
      if (url.includes("/gradio_api/call/process/evt-3")) return Promise.resolve({ ok: true, text: () => Promise.resolve("event: complete\ndata: [{\"path\": \"/tmp/v.mp4\"}]\n\n") });
      if (url.includes("/tmp/v.mp4")) return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      return Promise.resolve({ ok: true });
    }) as any);

    vi.mocked(await import("node:fs")).mkdirSync = mockMkdirSync;
    vi.mocked(await import("node:fs")).writeFileSync = mockWriteFileSync;

    const p = makeProvider({ uploadDir: "/tmp/up" });
    await p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any);
  });

  it("passes AbortSignal to the upload call", async () => {
    const p = makeProvider({ uploadDir: "/tmp/up" });
    await p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any);
    const uploadCall = fetchCalls.find(c => c.url.includes("/gradio_api/upload"));
    expect(uploadCall!.options!.signal).toBeDefined();
  });

  it("throws on JSON parse error in upload response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/upload")) return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);

    const p = makeProvider();
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow(SyntaxError);
  });

  it("throws on network error during upload", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/upload")) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);

    const p = makeProvider();
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("fetch failed");
  });
});
