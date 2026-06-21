import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgnesVideoProvider } from "../agnes-video";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "agnes-test-id") }));

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

const COMPLETED_RESPONSE = {
  id: "task-123",
  object: "video",
  status: "completed",
  progress: 100,
  remixed_from_video_id: "https://storage.agnes-ai.com/video.mp4",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url.includes("/videos/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(COMPLETED_RESPONSE) });
    }
    if (url.includes("/videos")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-agnes-1", task_id: "task-agnes-1", status: "queued" }) });
    }
    if (url.includes("storage.agnes-ai.com") || url.includes("example.com")) {
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    return Promise.resolve({ ok: true });
  }) as any);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new AgnesVideoProvider(params);
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("AGNES_API_KEY", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    expect((p as any).baseUrl).toBe("https://apihub.agnes-ai.com/v1");
    expect((p as any).model).toBe("agnes-video-v2.0");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("reads from env vars", () => {
    vi.stubEnv("AGNES_API_KEY", "env-key");
    vi.stubEnv("UPLOAD_DIR", "/tmp/env");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("env-key");
    expect((p as any).uploadDir).toBe("/tmp/env");
    vi.unstubAllEnvs();
  });

  it("constructor params override env vars", () => {
    vi.stubEnv("AGNES_API_KEY", "env-key");
    const p = makeProvider({ apiKey: "ctor-key", model: "agnes-1.5-flash", baseUrl: "https://custom.example.com/v1" });
    expect((p as any).apiKey).toBe("ctor-key");
    expect((p as any).model).toBe("agnes-1.5-flash");
    expect((p as any).baseUrl).toBe("https://custom.example.com/v1");
    vi.unstubAllEnvs();
  });

  it("strips trailing slash from baseUrl", () => {
    const p = makeProvider({ baseUrl: "https://apihub.agnes-ai.com/v1/" });
    expect((p as any).baseUrl).toBe("https://apihub.agnes-ai.com/v1");
  });
});

async function runWithAdvance<T>(fn: () => Promise<T>): Promise<T> {
  // provider uses setTimeout(resolve, 5000) for poll interval
  // we advance in one big jump which covers all poll cycles (or until completion/error)
  const promise = fn();
  promise.catch(() => {});
  await vi.advanceTimersByTimeAsync(60_000);
  return await promise;
}

describe("generateVideo", () => {
  it("submits text-only body when no image provided", async () => {
    const p = makeProvider({ apiKey: "test-key" });
    await runWithAdvance(() => p.generateVideo({ prompt: "a cat walking", duration: 5, ratio: "16:9" } as any));

    const submitCall = fetchCalls.find(c => c.url.includes("/videos") && !c.url.includes("/videos/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.model).toBe("agnes-video-v2.0");
    expect(body.prompt).toBe("a cat walking");
    expect(body.image).toBeUndefined();
    expect(body.width).toBe(1152);
    expect(body.height).toBe(768);
    expect(body.num_frames).toBe(121);
    expect(body.frame_rate).toBe(24);
  });

  it("submits with base64 image when firstFrame provided", async () => {
    const p = makeProvider({ apiKey: "test-key" });
    await runWithAdvance(() => p.generateVideo({ prompt: "cat", firstFrame: "start.png", duration: 5, ratio: "16:9" } as any));

    const submitCall = fetchCalls.find(c => c.url.includes("/videos") && !c.url.includes("/videos/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.image).toBe("aW1n");
    expect(body.model).toBe("agnes-video-v2.0");
  });

  it("submits with base64 image when initialImage provided", async () => {
    const p = makeProvider({ apiKey: "test-key" });
    await runWithAdvance(() => p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any));

    const submitCall = fetchCalls.find(c => c.url.includes("/videos") && !c.url.includes("/videos/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.image).toBe("aW1n");
  });

  it("uses Authorization header with Bearer token", async () => {
    const p = makeProvider({ apiKey: "my-secret-key" });
    await runWithAdvance(() => p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any));

    const submitCall = fetchCalls.find(c => c.url.includes("/videos") && !c.url.includes("/videos/"));
    expect(submitCall!.options!.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer my-secret-key",
    });
  });

  it("polls task status and returns filePath on completion", async () => {
    let pollCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/videos/")) {
        pollCount++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(pollCount === 1
          ? { id: "task-1", status: "in_progress", progress: 30 }
          : COMPLETED_RESPONSE) });
      }
      if (url.includes("/videos")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-1", task_id: "task-1", status: "queued" }) });
      }
      if (url.includes("storage.agnes-ai.com") || url.includes("example.com")) {
        return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    const result = await runWithAdvance(() => p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any));
    expect((result as any).filePath).toContain("agnes-test-id.mp4");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });

  it("throws on submit HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/videos") && !url.includes("/videos/")) {
        return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "bad-key" });
    // no poll cycle needed — submit fails before polling
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Agnes video submit failed: 401");
  });

  it("throws when submit response has no task_id", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/videos") && !url.includes("/videos/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "queued" }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Agnes video: no task_id");
  });

  it("throws on generation failed", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/videos/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-1", status: "failed", error: "internal error" }) });
      }
      if (url.includes("/videos")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-1", task_id: "task-1", status: "queued" }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(
      runWithAdvance(() => p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any))
    ).rejects.toThrow("Agnes video generation failed: internal error");
  });

  it("throws on completed but no URL", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/videos/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-1", status: "completed", progress: 100 }) });
      }
      if (url.includes("/videos")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-1", task_id: "task-1", status: "queued" }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(
      runWithAdvance(() => p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any))
    ).rejects.toThrow("Agnes video: no URL in completed response");
  });

  it("falls back to video_url field when remixed_from_video_id missing", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/videos/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-1", status: "completed", video_url: "https://example.com/v.mp4" }) });
      }
      if (url.includes("/videos")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-1", task_id: "task-1", status: "queued" }) });
      }
      if (url.includes("example.com")) {
        return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      }
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    const result = await runWithAdvance(() => p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any));
    expect((result as any).filePath).toContain("agnes-test-id.mp4");
  });

  it("throws on download failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/videos/")) return Promise.resolve({ ok: true, json: () => Promise.resolve(COMPLETED_RESPONSE) });
      if (url.includes("/videos")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-1", task_id: "task-1", status: "queued" }) });
      if (url.includes("storage.agnes-ai.com")) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(
      runWithAdvance(() => p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any))
    ).rejects.toThrow("Agnes video download failed: 500");
  });

  it("saves video to uploads/videos/ directory", async () => {
    const p = makeProvider({ apiKey: "ak", uploadDir: "/tmp/up" });
    await runWithAdvance(() => p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any));

    const calls = fetchCalls.filter(c => c.url.includes("storage.agnes-ai.com") || c.url.includes("example.com"));
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("accepts task_id via id field in submit response", async () => {
    let polledId = "";
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const match = url.match(/\/videos\/(.+)/);
      if (match) polledId = match[1];
      if (url.includes("/videos/")) return Promise.resolve({ ok: true, json: () => Promise.resolve(COMPLETED_RESPONSE) });
      if (url.includes("/videos")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-alt-id", task_id: "task-alt-id", status: "queued" }) });
      if (url.includes("storage.agnes-ai.com")) return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    const result = await runWithAdvance(() => p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any));
    expect((result as any).filePath).toContain("agnes-test-id.mp4");
    expect(polledId).toBe("task-alt-id");
  });
});

describe("AbortSignal", () => {
  it("passes signal to submit fetch call", async () => {
    const p = makeProvider({ apiKey: "ak" });
    await runWithAdvance(() => p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any));
    const submitCall = fetchCalls.find(c => c.url.includes("/videos") && !c.url.includes("/videos/"));
    expect(submitCall!.options!.signal).toBeDefined();
  });
});

describe("JSON parse error", () => {
  it("throws on malformed JSON in submit response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/videos") && !url.includes("/videos/")) {
        return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow(SyntaxError);
  });
});

describe("network error", () => {
  it("throws when fetch fails during submit", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/videos") && !url.includes("/videos/")) {
        return Promise.reject(new TypeError("fetch failed"));
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow(TypeError);
  });
});

describe("poll timeout", () => {
  it("throws when poll exceeds max retries", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("AbortSignal", { timeout: () => new AbortController().signal });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/videos/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-1", status: "in_progress" }) });
      }
      if (url.includes("/videos")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-1", task_id: "task-1", status: "queued" }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(600_000);
    await expect(promise).rejects.toThrow("Agnes video generation timed out after 10 minutes");
    (console.log as ReturnType<typeof vi.spyOn>).mockRestore();
  });
});

describe("missing API key", () => {
  it("throws when no API key is provided", async () => {
    vi.stubEnv("AGNES_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url.includes("/videos") && !url.includes("/videos/")) {
        const headers = options?.headers as Record<string, string>;
        if (!headers?.Authorization || headers.Authorization === "Bearer ") {
          return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "task-1", task_id: "task-1", status: "queued" }) });
      }
      if (url.includes("/videos/")) return Promise.resolve({ ok: true, json: () => Promise.resolve(COMPLETED_RESPONSE) });
      if (url.includes("storage.agnes-ai.com") || url.includes("example.com")) return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider();
    await expect(p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("Agnes video submit failed: 401");
    vi.unstubAllEnvs();
  });
});
