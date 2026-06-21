import { describe, it, expect, vi, beforeEach } from "vitest";
import { WanVideoProvider, toImageUrl, ratioToSize, normaliseRatio } from "../wan-video";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "wan-id") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

const mockReadFileSync = vi.hoisted(() => vi.fn(() => Buffer.from("img-data")));
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(() => true), readFileSync: mockReadFileSync, mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn() },
  existsSync: vi.fn(() => true), readFileSync: mockReadFileSync, mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn(),
}));

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockReadFileSync.mockClear();
  mockMkdirSync.mockClear();
  mockWriteFileSync.mockClear();
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url.includes("/tasks/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_status: "SUCCEEDED", video_url: "https://example.com/v.mp4" } }) });
    }
    if (url.includes("/video-synthesis")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "wan-task-1" } }) });
    }
    if (url.includes("example.com")) {
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    return Promise.resolve({ ok: false });
  }) as any);
});

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new WanVideoProvider(params);
}

describe("toImageUrl", () => {
  it("passes HTTP URLs as-is", () => {
    expect(toImageUrl("https://example.com/img.png")).toBe("https://example.com/img.png");
  });

  it("converts local file to data URL", () => {
    const result = toImageUrl("ref.png");
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(mockReadFileSync).toHaveBeenCalledWith("ref.png", { encoding: "base64" });
  });

  it("detects MIME from extension", () => {
    expect(toImageUrl("img.jpg")).toMatch(/^data:image\/jpeg;base64,/);
    expect(toImageUrl("img.jpeg")).toMatch(/^data:image\/jpeg;base64,/);
    expect(toImageUrl("img.webp")).toMatch(/^data:image\/webp;base64,/);
  });
});

describe("ratioToSize", () => {
  it("maps known ratios to wan sizes", () => {
    expect(ratioToSize("16:9")).toBe("1280*720");
    expect(ratioToSize("9:16")).toBe("720*1280");
    expect(ratioToSize("1:1")).toBe("960*960");
    expect(ratioToSize("4:3")).toBe("1088*832");
    expect(ratioToSize("3:4")).toBe("832*1088");
  });

  it("defaults to 1280*720 for unknown ratios", () => {
    expect(ratioToSize("21:9")).toBe("1280*720");
  });
});

describe("normaliseRatio", () => {
  it("passes through supported ratios", () => {
    expect(normaliseRatio("16:9")).toBe("16:9");
    expect(normaliseRatio("9:16")).toBe("9:16");
    expect(normaliseRatio("1:1")).toBe("1:1");
  });

  it("defaults to 16:9 for unsupported ratios", () => {
    expect(normaliseRatio("21:9")).toBe("16:9");
  });
});

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("WAN_API_KEY", "");
    vi.stubEnv("DASHSCOPE_API_KEY", "");
    vi.stubEnv("WAN_BASE_URL", "");
    vi.stubEnv("WAN_MODEL", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    expect((p as any).baseUrl).toBe("https://dashscope.aliyuncs.com/api/v1");
    expect((p as any).model).toBe("wan2.1-i2v-plus");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("reads WAN_API_KEY env", () => {
    vi.stubEnv("WAN_API_KEY", "wan-key");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("wan-key");
    vi.unstubAllEnvs();
  });

  it("falls back to DASHSCOPE_API_KEY", () => {
    vi.stubEnv("WAN_API_KEY", "");
    vi.stubEnv("DASHSCOPE_API_KEY", "ds-key");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("ds-key");
    vi.unstubAllEnvs();
  });

  it("params override env", () => {
    vi.stubEnv("WAN_API_KEY", "env-key");
    const p = makeProvider({ apiKey: "ctor-key", model: "wan2.7-r2v" });
    expect((p as any).apiKey).toBe("ctor-key");
    expect((p as any).model).toBe("wan2.7-r2v");
    vi.unstubAllEnvs();
  });
});

describe("buildKeyframeBody", () => {
  it("builds wan2.6 body with img_url and size", () => {
    const p = makeProvider({ apiKey: "ak", model: "wan2.1-i2v-plus" });
    const body = p.buildKeyframeBody({ prompt: "cat", firstFrame: "f.png", lastFrame: "l.png", ratio: "16:9", duration: 5 } as any);
    const b = body as any;
    expect(b.model).toBe("wan2.1-i2v-plus");
    expect(b.input.prompt).toBe("cat");
    expect(b.input.img_url).toContain("data:image");
    expect(b.parameters.size).toBe("1280*720");
    expect(b.parameters.duration).toBe(5);
  });

  it("builds wan2.7 body with media[] and ratio", () => {
    const p = makeProvider({ apiKey: "ak", model: "wan2.7-r2v" });
    const body = p.buildKeyframeBody({ prompt: "cat", firstFrame: "f.png", lastFrame: "l.png", ratio: "9:16", duration: 5 } as any);
    const b = body as any;
    expect(b.model).toBe("wan2.7-r2v");
    expect(b.input.prompt).toBe("cat");
    expect(b.input.media).toHaveLength(2);
    expect(b.input.media[0].type).toBe("first_frame");
    expect(b.input.media[1].type).toBe("last_frame");
    expect(b.parameters.ratio).toBe("9:16");
    expect(b.parameters.resolution).toBe("720P");
  });
});

describe("buildReferenceBody", () => {
  it("builds wan2.6 body with img_url", () => {
    const p = makeProvider({ apiKey: "ak", model: "wan2.1-i2v-plus" });
    const body = p.buildReferenceBody({ prompt: "cat", initialImage: "init.png", ratio: "16:9" } as any);
    expect(body.model).toBe("wan2.1-i2v-plus");
    expect((body.input as any).img_url).toContain("data:image");
  });

  it("builds wan2.7 body with reference_image media", () => {
    const p = makeProvider({ apiKey: "ak", model: "wan2.7-r2v" });
    const body = p.buildReferenceBody({ prompt: "cat", initialImage: "init.png", referenceImages: ["ref1.png", "ref2.png"], ratio: "4:3" } as any);
    expect((body.input as any).media).toHaveLength(3);
    expect((body.input as any).media[0].type).toBe("reference_image");
    expect((body.input as any).media[1].type).toBe("reference_image");
    expect((body.parameters as any).ratio).toBe("4:3");
  });

  it("limits wan2.7 reference_images to 8", () => {
    const p = makeProvider({ apiKey: "ak", model: "wan2.7-r2v" });
    const body = p.buildReferenceBody({ prompt: "cat", initialImage: "init.png", referenceImages: Array(15).fill("r.png"), ratio: "16:9" } as any);
    expect((body.input as any).media).toHaveLength(9);
  });
});

describe("buildTextBody", () => {
  it("uses model as-is for non-wan2.7", () => {
    const p = makeProvider({ apiKey: "ak", model: "wan2.1-i2v-plus" });
    const body = p.buildTextBody({ prompt: "cat", ratio: "1:1", duration: 5 } as any);
    expect(body.model).toBe("wan2.1-i2v-plus");
    expect((body.parameters as any).size).toBe("960*960");
  });

  it("uses wan2.7-t2v for wan2.7 base", () => {
    const p = makeProvider({ apiKey: "ak", model: "wan2.7-r2v" });
    const body = p.buildTextBody({ prompt: "cat", ratio: "1:1", duration: 5 } as any);
    expect(body.model).toBe("wan2.7-t2v");
    expect((body.parameters as any).ratio).toBe("1:1");
  });
});

describe("generateVideo", () => {
  it("submits keyframe task and polls for result", async () => {
    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "cat", firstFrame: "f.png", lastFrame: "l.png", ratio: "16:9", duration: 5 } as any);
    const submitCall = fetchCalls.find(c => c.url.includes("/video-synthesis"));
    expect(submitCall).toBeDefined();
    expect(result.filePath).toContain("wan-id.mp4");
  }, 30000);

  it("submits reference task and polls", async () => {
    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "cat", initialImage: "init.png", ratio: "16:9", duration: 5 } as any);
    const submitCall = fetchCalls.find(c => c.url.includes("/video-synthesis"));
    expect(submitCall).toBeDefined();
    expect(result.filePath).toContain("wan-id.mp4");
  }, 30000);

  it("submits text-only task", async () => {
    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "cat", ratio: "16:9", duration: 5 } as any);
    const submitCall = fetchCalls.find(c => c.url.includes("/video-synthesis"));
    expect(submitCall).toBeDefined();
    expect(result.filePath).toContain("wan-id.mp4");
  }, 30000);

  it("uses X-DashScope-Async header and Bearer auth", async () => {
    const p = makeProvider({ apiKey: "wan-secret" });
    await p.generateVideo({ prompt: "cat", ratio: "16:9", duration: 5 } as any);
    const call = fetchCalls.find(c => c.url.includes("/video-synthesis"));
    const headers = call!.options!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer wan-secret");
    expect(headers["X-DashScope-Async"]).toBe("enable");
  }, 30000);

  it("polls until SUCCEEDED and saves video", async () => {
    let pollCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options });
      if (url.includes("/video-synthesis")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "t-1" } }) });
      if (url.includes("/tasks/")) {
        pollCount++;
        return Promise.resolve(pollCount === 1
          ? { ok: true, json: () => Promise.resolve({ output: { task_status: "RUNNING" } }) }
          : { ok: true, json: () => Promise.resolve({ output: { task_status: "SUCCEEDED", video_url: "https://example.com/v.mp4" } }) });
      }
      if (url.includes("example.com")) return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      return Promise.resolve({ ok: false });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "cat", ratio: "16:9" } as any);
    expect(result.filePath).toContain("wan-id.mp4");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("throws on submit HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video-synthesis")) return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("bad") });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", ratio: "16:9" } as any)).rejects.toThrow("WanVideo submit failed: 401");
  });

  it("throws on no task_id", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video-synthesis")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", ratio: "16:9" } as any)).rejects.toThrow("WanVideo: no task_id in response");
  });

  it("throws on generation FAILED", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video-synthesis")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "t-1" } }) });
      if (url.includes("/tasks/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_status: "FAILED", message: "model error" } }) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", ratio: "16:9" } as any)).rejects.toThrow("WanVideo generation failed: model error");
  }, 30000);

  it("throws on SUCCEEDED but no video_url", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video-synthesis")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "t-1" } }) });
      if (url.includes("/tasks/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_status: "SUCCEEDED" } }) });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", ratio: "16:9" } as any)).rejects.toThrow("WanVideo: SUCCEEDED but no video_url");
  }, 30000);

  it("downloads and saves video to uploads/videos/", async () => {
    const p = makeProvider({ apiKey: "ak", uploadDir: "/tmp/up" });
    const mockCreateWriteStream = vi.fn();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video-synthesis")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "t-1" } }) });
      if (url.includes("/tasks/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_status: "SUCCEEDED", video_url: "https://example.com/v.mp4" } }) });
      return Promise.resolve({ ok: true, body: { pipe: vi.fn() } });
    }) as any);
    await p.generateVideo({ prompt: "cat", ratio: "16:9", duration: 5 } as any);
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringMatching(/tmp[\\/]up[\\/]videos/), { recursive: true });
  }, 30000);
});

describe("AbortSignal", () => {
  it("passes signal to submit fetch call", async () => {
    const p = makeProvider({ apiKey: "ak" });
    await p.generateVideo({ prompt: "cat", ratio: "16:9", duration: 5 } as any);
    const submitCall = fetchCalls.find(c => c.url.includes("/video-synthesis"));
    expect(submitCall!.options!.signal).toBeDefined();
  }, 30000);
});

describe("JSON parse error", () => {
  it("throws on malformed JSON in submit response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video-synthesis")) {
        return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", ratio: "16:9" } as any)).rejects.toThrow(SyntaxError);
  });
});

describe("network error", () => {
  it("throws when fetch fails during submit", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video-synthesis")) {
        return Promise.reject(new TypeError("fetch failed"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", ratio: "16:9" } as any)).rejects.toThrow(TypeError);
  });
});

describe("poll timeout", () => {
  it("throws after max retries when poll never completes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.stubGlobal("AbortSignal", { timeout: () => new AbortController().signal });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/video-synthesis")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "t-1" } }) });
      if (url.includes("/tasks/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_status: "RUNNING" } }) });
      return Promise.resolve({ ok: false });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", ratio: "16:9" } as any);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(1_800_000);
    await expect(promise).rejects.toThrow("WanVideo generation timed out after 30 minutes");
    vi.useRealTimers();
    (console.log as ReturnType<typeof vi.spyOn>).mockRestore();
    (console.warn as ReturnType<typeof vi.spyOn>).mockRestore();
  });
});

describe("missing API key", () => {
  it("throws when no API key is provided", async () => {
    vi.stubEnv("WAN_API_KEY", "");
    vi.stubEnv("DASHSCOPE_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url.includes("/video-synthesis")) {
        const headers = options?.headers as Record<string, string>;
        if (!headers?.Authorization || headers.Authorization === "Bearer ") {
          return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "t-1" } }) });
      }
      if (url.includes("/tasks/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_status: "SUCCEEDED", video_url: "https://example.com/v.mp4" } }) });
      if (url.includes("example.com")) return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
      return Promise.resolve({ ok: false });
    }) as any);
    const p = makeProvider();
    await expect(p.generateVideo({ prompt: "cat", ratio: "16:9", duration: 5 } as any)).rejects.toThrow("WanVideo submit failed: 401");
    vi.unstubAllEnvs();
  });
});
