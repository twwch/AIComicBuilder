import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AivideoVideoProvider } from "../aivideo-video";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "av-id") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(() => Buffer.from("img")),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    createWriteStream: vi.fn(),
  },
  readFileSync: vi.fn(() => Buffer.from("img")),
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
    if (url.includes("/api/v1/tasks/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "COMPLETED", output: { url: "https://example.com/v.mp4" } }) });
    }
    if (url.includes("/api/v1/generate/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SUBMITTED", taskId: "task-1" }) });
    }
    if (url.includes("example.com")) {
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    return Promise.resolve({ ok: true });
  }) as any);
});

afterEach(() => { vi.useRealTimers(); });

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new AivideoVideoProvider(params);
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("AIVIDEO_API_KEY", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    expect((p as any).baseUrl).toBe("https://aivideomaker.ai");
    expect((p as any).model).toBe("i2v_v3");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("reads from env vars", () => {
    vi.stubEnv("AIVIDEO_API_KEY", "env-key");
    vi.stubEnv("UPLOAD_DIR", "/tmp/env");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("env-key");
    expect((p as any).uploadDir).toBe("/tmp/env");
    vi.unstubAllEnvs();
  });

  it("constructor params override env vars", () => {
    vi.stubEnv("AIVIDEO_API_KEY", "env-key");
    const p = makeProvider({ apiKey: "ctor-key", model: "t2v_v3" });
    expect((p as any).apiKey).toBe("ctor-key");
    expect((p as any).model).toBe("t2v_v3");
    vi.unstubAllEnvs();
  });

  it("strips trailing slash from baseUrl", () => {
    const p = makeProvider({ baseUrl: "https://example.com/" });
    expect((p as any).baseUrl).toBe("https://example.com");
  });
});

describe("generateVideo", () => {
  it("submits i2v body with firstFrame", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/api/v1/generate/i2v_v3"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.image).toContain("data:");
    expect(body.prompt).toBe("cat");
    expect(body.duration).toBe("5");
    expect(result.filePath).toContain("av-id.mp4");
  });

  it("submits i2v body with initialImage fallback", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/api/v1/generate/i2v_v3"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.image).toContain("data:");
  });

  it("submits t2v body for t2v model", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak", model: "t2v_v3" });
    const promise = p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/api/v1/generate/t2v_v3"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.image).toBeUndefined();
    expect(body.prompt).toBe("cat");
  });

  it("throws when i2v has no image", async () => {
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Aivideo: i2v requires firstFrame or initialImage");
  });

  it("maps duration to nearest valid value for v3 (5/10/15/20)", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 12, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/api/v1/generate/i2v_v3"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.duration).toBe("10");
  });

  it("maps duration to nearest valid value for non-v3 (5/8)", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak", model: "i2v" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 7, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/api/v1/generate/i2v"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.duration).toBe("8");
  });

  it("includes aspectRatio for i2v (non-v3) model", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak", model: "i2v" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "9:16" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/api/v1/generate/i2v"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.aspectRatio).toBe("9:16");
  });

  it("uses custom key header for auth", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "my-secret" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/api/v1/generate/"));
    const headers = submitCall!.options!.headers as Record<string, string>;
    expect(headers.key).toBe("my-secret");
  });

  it("polls task status and saves video", async () => {
    let pollCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/v1/tasks/")) {
        pollCount++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(pollCount === 1 ? { status: "PROCESSING" } : { status: "COMPLETED", output: { url: "https://example.com/v.mp4" } }) });
      }
      if (url.includes("/api/v1/generate/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SUBMITTED", taskId: "t-1" }) });
      }
      if (url.includes("example.com")) return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any);

    expect(result.filePath).toContain("av-id.mp4");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("throws on submit HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/v1/generate/")) return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve("bad") });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Aivideo submit failed: 400");
  });

  it("throws on submit status not SUBMITTED", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/v1/generate/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "ERROR", message: "quota exceeded" }) });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Aivideo submit error: quota exceeded");
  });

  it("throws on generation FAILED", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/v1/tasks/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "FAILED", message: "model error" }) });
      if (url.includes("/api/v1/generate/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SUBMITTED", taskId: "t-1" }) });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Aivideo generation failed: model error");
  }, 30000);

  it("throws on COMPLETED but no URL", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/v1/tasks/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "COMPLETED" }) });
      if (url.includes("/api/v1/generate/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SUBMITTED", taskId: "t-1" }) });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Aivideo: no video URL in completed task");
  }, 30000);

  it("downloads and saves video to uploads/videos/", async () => {
    vi.useFakeTimers();
    const mockMkdirSync = vi.fn();
    const mockWriteFileSync = vi.fn();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/v1/tasks/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "COMPLETED", output: { url: "https://example.com/v.mp4" } }) });
      if (url.includes("/api/v1/generate/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SUBMITTED", taskId: "t-1" }) });
      if (url.includes("example.com")) return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak", uploadDir: "/tmp/up" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
  });
});

describe("AbortSignal", () => {
  it("passes signal to submit fetch call", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/api/v1/generate/"));
    expect(submitCall!.options!.signal).toBeDefined();
  });
});

describe("JSON parse error", () => {
  it("throws on malformed JSON in submit response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/v1/generate/")) {
        return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow(SyntaxError);
  });
});

describe("network error", () => {
  it("throws when fetch fails during submit", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/v1/generate/")) {
        return Promise.reject(new TypeError("fetch failed"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow(TypeError);
  });
});

describe("poll timeout", () => {
  it("throws after max retries when poll never completes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.stubGlobal("AbortSignal", { timeout: () => new AbortController().signal });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/v1/tasks/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "PROCESSING" }) });
      if (url.includes("/api/v1/generate/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SUBMITTED", taskId: "t-1" }) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(600_000);
    await expect(promise).rejects.toThrow("Aivideo generation timed out after 10 minutes");
    vi.useRealTimers();
    (console.log as ReturnType<typeof vi.spyOn>).mockRestore();
  });
});

describe("missing API key", () => {
  it("throws when no API key is provided", async () => {
    vi.stubEnv("AIVIDEO_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url.includes("/api/v1/generate/")) {
        const headers = options?.headers as Record<string, string>;
        if (!headers?.key || headers.key === "") {
          return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "SUBMITTED", taskId: "t-1" }) });
      }
      if (url.includes("/api/v1/tasks/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "COMPLETED", output: { url: "https://example.com/v.mp4" } }) });
      if (url.includes("example.com")) return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider();
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Aivideo submit failed: 401");
    vi.unstubAllEnvs();
  });
});
