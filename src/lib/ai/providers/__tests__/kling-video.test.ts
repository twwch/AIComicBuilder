import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KlingVideoProvider } from "../kling-video";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "kling-test-id") }));

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

const mockCreateHmac = vi.hoisted(() => vi.fn(() => ({ update: vi.fn(() => ({ digest: vi.fn(() => "mock-sig") })) })));

vi.mock("node:crypto", () => ({
  default: { createHmac: mockCreateHmac },
  createHmac: mockCreateHmac,
}));

function klingSubmitOk(taskId = "ktask-1") {
  return { ok: true, json: () => Promise.resolve({ code: 0, message: "ok", data: { task_id: taskId } }) };
}

function klingPollResponse(status: string, videoUrl?: string) {
  return {
    ok: true,
    json: () => Promise.resolve({
      code: 0,
      message: "ok",
      data: { task_status: status, task_status_msg: "", task_result: videoUrl ? { videos: [{ url: videoUrl }] } : {} },
    }),
  };
}

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateHmac.mockClear();
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url.includes("/v1/videos/") && (url.includes("/image2video/") || url.includes("/text2video/"))) {
      return Promise.resolve(klingPollResponse("succeed", "https://example.com/video.mp4"));
    }
    if (url.includes("/v1/videos/image2video")) {
      return Promise.resolve(klingSubmitOk());
    }
    if (url.includes("/v1/videos/text2video")) {
      return Promise.resolve(klingSubmitOk());
    }
    return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  }) as any);
});

afterEach(() => { vi.useRealTimers(); });

function makeProvider(params?: { apiKey?: string; secretKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new KlingVideoProvider(params);
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("KLING_ACCESS_KEY", "");
    vi.stubEnv("KLING_SECRET_KEY", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    expect((p as any).secretKey).toBe("");
    expect((p as any).baseUrl).toBe("https://api.klingai.com");
    expect((p as any).model).toBe("kling-v1");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("reads from env vars", () => {
    vi.stubEnv("KLING_ACCESS_KEY", "ak-env");
    vi.stubEnv("KLING_SECRET_KEY", "sk-env");
    vi.stubEnv("UPLOAD_DIR", "/tmp/env");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("ak-env");
    expect((p as any).secretKey).toBe("sk-env");
    vi.unstubAllEnvs();
  });

  it("constructor params override env vars", () => {
    vi.stubEnv("KLING_ACCESS_KEY", "ak-env");
    vi.stubEnv("KLING_SECRET_KEY", "sk-env");
    const p = makeProvider({ apiKey: "ak-ctor", secretKey: "sk-ctor", model: "kling-v3", baseUrl: "https://kling.example.com" });
    expect((p as any).apiKey).toBe("ak-ctor");
    expect((p as any).secretKey).toBe("sk-ctor");
    expect((p as any).model).toBe("kling-v3");
    expect((p as any).baseUrl).toBe("https://kling.example.com");
    vi.unstubAllEnvs();
  });
});

describe("generateVideo", () => {
  it("submits image2video in keyframe mode", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak", secretKey: "sk" });
    const promise = p.generateVideo({ prompt: "a cat", firstFrame: "start.png", lastFrame: "end.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/v1/videos/image2video"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.model).toBe("kling-v1");
    expect(body.prompt).toBe("a cat");
    expect(body.image).toBeTruthy();
    expect(body.tail_image).toBeTruthy();
    expect(body.duration).toBe(5);
    expect(body.aspect_ratio).toBe("16:9");
    expect(body.sound).toBe("on");
    expect(result.filePath).toContain("kling-test-id.mp4");
  });

  it("submits text2video in reference mode", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak", secretKey: "sk" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/v1/videos/text2video"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.model).toBe("kling-v1");
    expect(body.prompt).toBe("a cat");
    expect(body.reference_image).toBeDefined();
    expect(Array.isArray(body.reference_image)).toBe(true);
  });

  it("uses JWT Bearer token when secretKey provided", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak", secretKey: "sk" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/v1/videos/text2video"));
    const auth = submitCall!.options!.headers as Record<string, string>;
    expect(auth.Authorization).toMatch(/^Bearer .+\.+.+\.mock-sig$/);
  });

  it("uses apiKey directly when no secretKey", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak-only" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/v1/videos/text2video"));
    const auth = submitCall!.options!.headers as Record<string, string>;
    expect(auth.Authorization).toBe("Bearer ak-only");
  });

  it("retries text2video without reference_image on 400", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options });
      if (url.includes("/v1/videos/") && (url.includes("/image2video/") || url.includes("/text2video/"))) {
        return Promise.resolve(klingPollResponse("succeed", "https://example.com/v.mp4"));
      }
      if (url.includes("/v1/videos/text2video")) {
        attempt++;
        if (attempt === 1) {
          return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve("ref not supported"), json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { task_id: "ktask-2" } }) });
      }
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const text2videoCalls = fetchCalls.filter(c => c.url.includes("/v1/videos/text2video") && !c.url.includes("/text2video/"));
    expect(text2videoCalls).toHaveLength(2);
    const body1 = JSON.parse(text2videoCalls[0].options!.body as string);
    const body2 = JSON.parse(text2videoCalls[1].options!.body as string);
    expect(body1.reference_image).toBeDefined();
    expect(body2.reference_image).toBeUndefined();
  });

  it("polls for result and returns file path", async () => {
    let pollCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options });
      if (url.includes("/v1/videos/text2video/") || url.includes("/v1/videos/image2video/")) {
        pollCount++;
        return Promise.resolve(pollCount === 1
          ? { ok: true, json: () => Promise.resolve({ code: 0, message: "", data: { task_status: "processing", task_status_msg: "", task_result: {} } }) }
          : klingPollResponse("succeed", "https://example.com/v.mp4"));
      }
      if (url.includes("/v1/videos/text2video")) return Promise.resolve(klingSubmitOk());
      if (url.includes("/v1/videos/image2video")) return Promise.resolve(klingSubmitOk());
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" });
    expect(result.filePath).toContain("kling-test-id.mp4");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("throws on submit error response code", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/videos/text2video")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 10010, message: "param error" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" })).rejects.toThrow("Kling text2video error");
  });

  it("throws on poll failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/videos/") && (url.includes("/image2video/") || url.includes("/text2video/"))) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { task_status: "failed", task_status_msg: "gen error", task_result: {} } }) });
      }
      if (url.includes("/v1/videos/text2video")) return Promise.resolve(klingSubmitOk());
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" })).rejects.toThrow("Kling video generation failed");
  }, 30000);

  it("maps duration for kling-v1: <=5 → 5, >5 → 10", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    let promise = p.generateVideo({ prompt: "a cat", firstFrame: "s.png", lastFrame: "e.png", duration: 3, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const image2videoCalls = () => fetchCalls.filter(c => c.url.includes("/v1/videos/image2video") && !c.url.includes("/image2video/"));
    expect(JSON.parse(image2videoCalls()[0].options!.body as string).duration).toBe(5);

    fetchCalls.length = 0;
    promise = p.generateVideo({ prompt: "a cat", firstFrame: "s.png", lastFrame: "e.png", duration: 8, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    expect(JSON.parse(image2videoCalls()[0].options!.body as string).duration).toBe(10);
  });

  it("maps duration for kling-v3: clamped to 3-15", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak", model: "kling-v3" });
    let promise = p.generateVideo({ prompt: "a cat", firstFrame: "s.png", lastFrame: "e.png", duration: 1, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const image2videoCalls = () => fetchCalls.filter(c => c.url.includes("/v1/videos/image2video") && !c.url.includes("/image2video/"));
    expect(JSON.parse(image2videoCalls()[0].options!.body as string).duration).toBe(3);

    promise = p.generateVideo({ prompt: "a cat", firstFrame: "s.png", lastFrame: "e.png", duration: 20, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    expect(JSON.parse(image2videoCalls()[1].options!.body as string).duration).toBe(15);
  });

  it("fetches HTTP images as base64 in reference mode", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "a cat", initialImage: "https://example.com/ref.jpg", duration: 5, ratio: "16:9" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const call = fetchCalls.find(c => c.url.includes("/v1/videos/text2video"));
    const body = JSON.parse(call!.options!.body as string);
    expect(body.reference_image[0]).toBeTruthy();
  });
});

describe("AbortSignal", () => {
  it("passes signal to submit fetch call", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "a cat", firstFrame: "s.png", lastFrame: "e.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/v1/videos/image2video"));
    expect(submitCall!.options!.signal).toBeDefined();
  });
});

describe("JSON parse error", () => {
  it("throws on malformed JSON in submit response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/videos/text2video") && !url.includes("/text2video/")) {
        return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" })).rejects.toThrow(SyntaxError);
  });
});

describe("network error", () => {
  it("throws when fetch fails during submit", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/videos/text2video") && !url.includes("/text2video/")) {
        return Promise.reject(new TypeError("fetch failed"));
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" })).rejects.toThrow(TypeError);
  });
});

describe("poll timeout", () => {
  it("throws after max retries when poll never completes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.stubGlobal("AbortSignal", { timeout: () => new AbortController().signal });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/videos/image2video/") || url.includes("/v1/videos/text2video/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { task_status: "processing", task_status_msg: "", task_result: {} } }) });
      }
      if (url.includes("/v1/videos/image2video")) return Promise.resolve(klingSubmitOk("ktask-tout"));
      if (url.includes("/v1/videos/text2video")) return Promise.resolve(klingSubmitOk("ktask-tout"));
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "a cat", firstFrame: "s.png", lastFrame: "e.png", duration: 5, ratio: "16:9" } as any);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(600_000);
    await expect(promise).rejects.toThrow("Kling video generation timed out after 10 minutes");
    vi.useRealTimers();
    (console.log as ReturnType<typeof vi.spyOn>).mockRestore();
    (console.warn as ReturnType<typeof vi.spyOn>).mockRestore();
  });
});

describe("missing API key", () => {
  it("throws when no API key is provided", async () => {
    vi.stubEnv("KLING_ACCESS_KEY", "");
    vi.stubEnv("KLING_SECRET_KEY", "");
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url.includes("/v1/videos/text2video") && !url.includes("/text2video/")) {
        const headers = options?.headers as Record<string, string>;
        if (!headers?.Authorization || headers.Authorization === "Bearer ") {
          return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
        }
        return Promise.resolve(klingSubmitOk());
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider();
    await expect(p.generateVideo({ prompt: "a cat", initialImage: "ref.png", duration: 5, ratio: "16:9" })).rejects.toThrow("Kling text2video submit failed: 401");
    vi.unstubAllEnvs();
  });
});
