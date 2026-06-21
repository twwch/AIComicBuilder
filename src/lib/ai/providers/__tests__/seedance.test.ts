import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SeedanceProvider } from "../seedance";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "seedance-test-id") }));

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

const mockSubmitJson = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "task-123" }));
const mockPollJson = vi.hoisted(() => vi.fn().mockResolvedValue({ status: "succeeded", content: { video_url: "https://example.com/video.mp4", last_frame_url: "https://example.com/last.png" } }));

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls = [];
  mockSubmitJson.mockClear();
  mockPollJson.mockClear();
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url.includes("/tasks/")) {
      return Promise.resolve({ ok: true, json: mockPollJson });
    }
    if (url.includes("/tasks")) {
      return Promise.resolve({ ok: true, json: mockSubmitJson });
    }
    return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  }) as any);
});

afterEach(() => { vi.useRealTimers(); });

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new SeedanceProvider(params);
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("SEEDANCE_API_KEY", "");
    vi.stubEnv("SEEDANCE_BASE_URL", "");
    vi.stubEnv("SEEDANCE_MODEL", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    expect((p as any).baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
    expect((p as any).model).toBe("doubao-seedance-1-5-pro-250528");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("reads from env vars", () => {
    vi.stubEnv("SEEDANCE_API_KEY", "env-key");
    vi.stubEnv("SEEDANCE_BASE_URL", "https://env.example.com/v3");
    vi.stubEnv("SEEDANCE_MODEL", "env-model");
    vi.stubEnv("UPLOAD_DIR", "/tmp/env");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("env-key");
    expect((p as any).baseUrl).toBe("https://env.example.com/v3");
    expect((p as any).model).toBe("env-model");
    expect((p as any).uploadDir).toBe("/tmp/env");
    vi.unstubAllEnvs();
  });

  it("constructor params override env vars", () => {
    vi.stubEnv("SEEDANCE_API_KEY", "env-key");
    const p = makeProvider({ apiKey: "ctor-key", model: "ctor-model", baseUrl: "https://ctor.example.com/v3" });
    expect((p as any).apiKey).toBe("ctor-key");
    expect((p as any).model).toBe("ctor-model");
    expect((p as any).baseUrl).toBe("https://ctor.example.com/v3");
    vi.unstubAllEnvs();
  });

  it("strips trailing slash from baseUrl", () => {
    const p = makeProvider({ baseUrl: "https://example.com/api/v3/" });
    expect((p as any).baseUrl).toBe("https://example.com/api/v3");
  });
});

describe("generateVideo", () => {
  it("submits keyframe body when firstFrame and lastFrame provided", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "test-key" });
    const promise = p.generateVideo({ prompt: "a cat", firstFrame: "start.png", lastFrame: "end.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/tasks") && !c.url.includes("/tasks/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.model).toBe("doubao-seedance-1-5-pro-250528");
    expect(body.duration).toBe(5);
    expect(body.ratio).toBe("16:9");
    expect(body.content[0].type).toBe("text");
    expect(body.content[0].text).toBe("a cat");
    expect(body.content[1].type).toBe("image_url");
    expect(body.content[2].type).toBe("image_url");
    expect(result.filePath).toContain("seedance-test-id.mp4");
  });

  it("submits reference body when initialImage provided", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "test-key" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/tasks") && !c.url.includes("/tasks/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.content[0].type).toBe("text");
    expect(body.content[1].type).toBe("image_url");
    expect(body.content[1].image_url.url).toContain("data:");
    expect(body.return_last_frame).toBe(true);
  });

  it("includes multi-reference images for Seedance 2.0", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "test-key", model: "doubao-seedance-2-0" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", referenceImages: ["r1.png", "r2.png"], duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/tasks") && !c.url.includes("/tasks/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    const refImages = body.content.filter((c: any) => c.role === "reference_image");
    expect(refImages).toHaveLength(3);
    expect(body.generate_audio).toBe(true);
  });

  it("enables generate_audio for seedance-2 model", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "test-key", model: "doubao-seedance-2-0" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/tasks") && !c.url.includes("/tasks/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.generate_audio).toBe(true);
  });

  it("does not enable generate_audio for non seedance-2 model", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "test-key", model: "doubao-seedance-1-5" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/tasks") && !c.url.includes("/tasks/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.generate_audio).toBeUndefined();
  });

  it("uses Authorization header with Bearer token", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "my-secret-key" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/tasks") && !c.url.includes("/tasks/"));
    expect(submitCall!.options!.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer my-secret-key",
    });
  });

  it("throws on submit failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks") && !url.includes("/tasks/")) {
        return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve("bad request") });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);
    const p = makeProvider({ apiKey: "test-key" });
    await expect(p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" })).rejects.toThrow("Seedance submit failed");
  });

  it("polls for task result", async () => {
    let pollCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks/")) {
        pollCount++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(pollCount === 1 ? { status: "running" } : { status: "succeeded", content: { video_url: "https://example.com/v.mp4" } }) });
      }
      if (url.includes("/tasks")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-123" }) });
      }
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "test-key" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" });
    const result = await promise;
    expect(result.filePath).toContain("seedance-test-id.mp4");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("throws when generation fails", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "failed", error: { message: "gen failed" } }) });
      }
      if (url.includes("/tasks")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-123" }) });
      }
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "test-key" });
    await expect(p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" })).rejects.toThrow("Seedance generation failed");
  }, 30000);

  it("handles HTTP URL images without base64 encoding", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "test-key", model: "doubao-seedance-2-0" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "https://example.com/ref.jpg", referenceImages: ["https://example.com/r1.jpg"], duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/tasks") && !c.url.includes("/tasks/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    const refs = body.content.filter((c: any) => c.type === "image_url");
    for (const ref of refs) {
      expect(ref.image_url.url).toMatch(/^https?:\/\//);
      expect(ref.image_url.url).not.toContain("data:");
    }
  });

  it("returns lastFrameUrl when provided", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "test-key" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    expect(result.lastFrameUrl).toBe("https://example.com/last.png");
  });

  it("passes default duration and ratio when not specified", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "test-key" });
    const promise = p.generateVideo({ prompt: "a cat", firstFrame: "start.png", lastFrame: "end.png" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/tasks") && !c.url.includes("/tasks/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.duration).toBe(5);
    expect(body.ratio).toBe("16:9");
  });

  it("limits reference images to 9 total (initial + 8)", async () => {
    vi.useFakeTimers();
    const manyRefs = Array.from({ length: 20 }, (_, i) => `ref${i}.png`);
    const p = makeProvider({ apiKey: "test-key", model: "doubao-seedance-2-0" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "base.png", referenceImages: manyRefs, duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/tasks") && !c.url.includes("/tasks/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    const refImages = body.content.filter((c: any) => c.role === "reference_image");
    expect(refImages).toHaveLength(9);
  });

  it("passes signal to fetch calls", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "test-key" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    for (const entry of fetchCalls) {
      expect(entry.options).toHaveProperty("signal");
    }
  });

  it("throws on JSON parse error from submit response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks") && !url.includes("/tasks/")) {
        return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);
    mockSubmitJson.mockRejectedValue(new SyntaxError("Unexpected token"));
    const p = makeProvider({ apiKey: "test-key" });
    let caught: any;
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" }).catch((e) => { caught = e; });
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    expect(caught).toBeInstanceOf(SyntaxError);
  });

  it("throws on network error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("network error"))) as any);
    const p = makeProvider({ apiKey: "test-key" });
    let caught: any;
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" }).catch((e) => { caught = e; });
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    expect(caught).toBeInstanceOf(TypeError);
  });

  it("throws when poll times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "running" }) });
      }
      if (url.includes("/tasks")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-123" }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);
    mockPollJson.mockResolvedValue({ status: "running" });
    const p = makeProvider({ apiKey: "test-key" });
    let caught: any;
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" }).catch((e) => { caught = e; });
    await vi.advanceTimersByTimeAsync(600_100);
    vi.useRealTimers();
    expect(caught?.message).toContain("Seedance generation timed out after 10 minutes");
  }, 30_000);

  it("handles missing apiKey gracefully", () => {
    vi.stubEnv("SEEDANCE_API_KEY", "");
    vi.stubEnv("SEEDANCE_BASE_URL", "");
    vi.stubEnv("SEEDANCE_MODEL", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    vi.unstubAllEnvs();
  });
});
