import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UCloudSeedanceProvider } from "../ucloud-seedance";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "ucs-id") }));

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
    if (url.includes("/tasks/status")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_status: "Success", urls: ["https://example.com/v.mp4"] } }) });
    }
    if (url.includes("/tasks/submit")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "task-1" } }) });
    }
    return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  }) as any);
});

afterEach(() => { vi.useRealTimers(); });

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new UCloudSeedanceProvider(params);
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    expect((p as any).baseUrl).toBe("https://api.modelverse.cn");
    expect((p as any).model).toBe("doubao-seedance-1-5-pro-251215");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("constructor params override defaults", () => {
    const p = makeProvider({ apiKey: "ak", model: "doubao-seedance-2-0", baseUrl: "https://custom.com" });
    expect((p as any).apiKey).toBe("ak");
    expect((p as any).model).toBe("doubao-seedance-2-0");
    expect((p as any).baseUrl).toBe("https://custom.com");
  });

  it("strips trailing slash from baseUrl", () => {
    const p = makeProvider({ baseUrl: "https://api.example.com/" });
    expect((p as any).baseUrl).toBe("https://api.example.com");
  });
});

describe("generateVideo", () => {
  it("submits keyframe body with firstFrame and lastFrame", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", lastFrame: "l.png", ratio: "16:9", duration: 5 } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/tasks/submit"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.model).toBe("doubao-seedance-1-5-pro-251215");
    expect(body.input.content).toHaveLength(3);
    expect(body.input.content[0].type).toBe("text");
    expect(body.input.content[1].role).toBe("first_frame");
    expect(body.input.content[2].role).toBe("last_frame");
    expect(body.parameters.duration).toBe(5);
    expect(body.parameters.ratio).toBe("16:9");
    expect(body.parameters.resolution).toBe("720p");
    expect(body.parameters.watermark).toBe(false);
    expect(result.filePath).toContain("ucs-id.mp4");
  });

  it("submits reference body with initialImage", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/tasks/submit"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.input.content).toHaveLength(2);
    expect(body.input.content[1].role).toBe("first_frame");
  });

  it("uses multi-reference mode for references", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", initialImage: "base.png", referenceImages: ["r1.png", "r2.png"], duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/tasks/submit"));
    const body = JSON.parse(submitCall!.options!.body as string);
    const refs = body.input.content.filter((c: any) => c.role === "reference_image");
    expect(refs).toHaveLength(3);
  });

  it("limits reference images to 9 total", async () => {
    vi.useFakeTimers();
    const manyRefs = Array.from({ length: 20 }, (_, i) => `r${i}.png`);
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", initialImage: "base.png", referenceImages: manyRefs, duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/tasks/submit"));
    const body = JSON.parse(submitCall!.options!.body as string);
    const refs = body.input.content.filter((c: any) => c.role === "reference_image");
    expect(refs).toHaveLength(9);
  });

  it("passes HTTP URL images without base64 encoding", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", initialImage: "https://example.com/ref.jpg", referenceImages: ["https://example.com/r1.jpg"], duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/tasks/submit"));
    const body = JSON.parse(submitCall!.options!.body as string);
    const imgs = body.input.content.filter((c: any) => c.type === "image_url");
    for (const img of imgs) {
      expect(img.image_url.url).toMatch(/^https?:\/\//);
    }
  });

  it("enables generate_audio for seedance-2 model", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak", model: "doubao-seedance-2-0" });
    const promise = p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/tasks/submit"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.parameters.generate_audio).toBe(true);
  });

  it("does not enable generate_audio for seedance-1.5", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak", model: "doubao-seedance-1-5-pro-251215" });
    const promise = p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/tasks/submit"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.parameters.generate_audio).toBeUndefined();
  });

  it("uses Authorization header with raw apiKey", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "my-key" });
    const promise = p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/tasks/submit"));
    expect(submitCall!.options!.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "my-key",
    });
  });

  it("polls status endpoint and saves video", async () => {
    let pollCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks/status")) {
        pollCount++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(pollCount === 1 ? { output: { task_status: "Pending" } } : { output: { task_status: "Success", urls: ["https://example.com/v.mp4"] } }) });
      }
      if (url.includes("/tasks/submit")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "t-1" } }) });
      }
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "video/mp4" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any);

    expect(result.filePath).toContain("ucs-id.mp4");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("throws on submit HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks/submit")) return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("UCloudSeedance submit failed: 401");
  });

  it("throws on no task_id", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks/submit")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("UCloudSeedance: no task_id in response");
  });

  it("throws on generation Failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks/status")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_status: "Failure", error_message: "model crash" } }) });
      if (url.includes("/tasks/submit")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "t-1" } }) });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("UCloudSeedance generation failure: model crash");
  }, 30000);

  it("throws on success but no urls", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks/status")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_status: "Success" } }) });
      if (url.includes("/tasks/submit")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "t-1" } }) });
      return Promise.resolve({ ok: true });
    }) as any);

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 5, ratio: "16:9" } as any)).rejects.toThrow("UCloudSeedance: Success but no urls");
  }, 30000);

  it("passes defaults for duration and ratio when not specified", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", lastFrame: "l.png" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    const submitCall = fetchCalls.find(c => c.url.includes("/tasks/submit"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.parameters.duration).toBe(5);
    expect(body.parameters.ratio).toBe("16:9");
  });

  it("passes signal to fetch calls", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", lastFrame: "l.png" } as any);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    for (const entry of fetchCalls) {
      expect(entry.options).toHaveProperty("signal");
    }
  });

  it("throws on JSON parse error from submit response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks/submit")) {
        return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    let caught: any;
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", lastFrame: "l.png" } as any).catch((e) => { caught = e; });
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    expect(caught).toBeInstanceOf(SyntaxError);
  });

  it("throws on network error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("network error"))) as any);
    const p = makeProvider({ apiKey: "ak" });
    let caught: any;
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", lastFrame: "l.png" } as any).catch((e) => { caught = e; });
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    expect(caught).toBeInstanceOf(TypeError);
  });

  it("throws when poll times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/tasks/status")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_status: "Pending" } }) });
      }
      if (url.includes("/tasks/submit")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ output: { task_id: "t-1" } }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    let caught: any;
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", lastFrame: "l.png" } as any).catch((e) => { caught = e; });
    await vi.advanceTimersByTimeAsync(1_800_100);
    vi.useRealTimers();
    expect(caught?.message).toContain("UCloudSeedance generation timed out after 30 minutes");
  }, 30_000);

  it("handles missing apiKey gracefully", () => {
    vi.stubEnv("UCLOUD_API_KEY", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    vi.unstubAllEnvs();
  });
});
