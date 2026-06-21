import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KlingImageProvider } from "../kling-image";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "kling-img-id") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => Buffer.from("")),
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    createWriteStream: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => Buffer.from("")),
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  createWriteStream: vi.fn(),
}));

const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockCreateHmac = vi.hoisted(() => vi.fn(() => ({ update: vi.fn(() => ({ digest: vi.fn(() => "mock-sig") })) })));

vi.mock("node:crypto", () => ({
  default: { createHmac: mockCreateHmac },
  createHmac: mockCreateHmac,
}));

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

function pollOk(status: string, imageUrl?: string) {
  return {
    ok: true,
    json: () => Promise.resolve({
      code: 0,
      message: "ok",
      data: { task_status: status, task_status_msg: "", task_result: imageUrl ? { images: [{ url: imageUrl }] } : {} },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateHmac.mockClear();
  mockMkdirSync.mockClear();
  mockWriteFileSync.mockClear();
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url.includes("/v1/images/generations/")) {
      return Promise.resolve(pollOk("succeed", "https://example.com/image.png"));
    }
    if (url.includes("/v1/images/generations")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, message: "ok", data: { task_id: "img-task-1" } }) });
    }
    return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  }) as any);
});

afterEach(() => { vi.useRealTimers(); });

function makeProvider(params?: { apiKey?: string; secretKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new KlingImageProvider(params);
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
    const p = makeProvider();
    expect((p as any).apiKey).toBe("ak-env");
    expect((p as any).secretKey).toBe("sk-env");
    vi.unstubAllEnvs();
  });

  it("constructor params override env vars", () => {
    vi.stubEnv("KLING_ACCESS_KEY", "ak-env");
    const p = makeProvider({ apiKey: "ak-ctor", model: "kling-v2", baseUrl: "https://kling.example.com" });
    expect((p as any).apiKey).toBe("ak-ctor");
    expect((p as any).model).toBe("kling-v2");
    expect((p as any).baseUrl).toBe("https://kling.example.com");
    vi.unstubAllEnvs();
  });
});

describe("generateText", () => {
  it("throws not supported", async () => {
    const p = makeProvider();
    await expect(p.generateText("hello")).rejects.toThrow("Kling does not support text generation");
  });
});

describe("generateImage", () => {
  it("submits with correct body", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateImage("a cat");
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/v1/images/generations") && !c.url.includes("/v1/images/generations/"));
    const body = JSON.parse(submitCall!.options!.body as string);
    expect(body.model).toBe("kling-v1");
    expect(body.prompt).toBe("a cat");
    expect(body.n).toBe(1);
    expect(body.aspect_ratio).toBe("16:9");
  });

  it("uses custom aspect_ratio", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateImage("a cat", { aspectRatio: "1:1" });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const submitCall = fetchCalls.find(c => c.url.includes("/v1/images/generations") && !c.url.includes("/v1/images/generations/"));
    expect(JSON.parse(submitCall!.options!.body as string).aspect_ratio).toBe("1:1");
  });

  it("uses JWT Bearer token when secretKey provided", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak", secretKey: "sk" });
    const promise = p.generateImage("a cat");
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const call = fetchCalls.find(c => c.url.includes("/v1/images/generations") && !c.url.includes("/v1/images/generations/"));
    const auth = call!.options!.headers as Record<string, string>;
    expect(auth.Authorization).toMatch(/^Bearer .+\.+.+\.mock-sig$/);
    expect(mockCreateHmac).toHaveBeenCalledWith("sha256", "sk");
  });

  it("uses apiKey directly when no secretKey", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak-only" });
    const promise = p.generateImage("a cat");
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const call = fetchCalls.find(c => c.url.includes("/v1/images/generations") && !c.url.includes("/v1/images/generations/"));
    const auth = call!.options!.headers as Record<string, string>;
    expect(auth.Authorization).toBe("Bearer ak-only");
  });

  it("polls processing then succeed", async () => {
    let pollCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options });
      if (url.includes("/v1/images/generations/")) {
        pollCount++;
        return Promise.resolve(pollCount === 1
          ? { ok: true, json: () => Promise.resolve({ code: 0, data: { task_status: "processing", task_status_msg: "", task_result: {} } }) }
          : pollOk("succeed", "https://example.com/img.png"));
      }
      if (url.includes("/v1/images/generations") && !url.includes("/v1/images/generations/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { task_id: "img-task-1" } }) });
      }
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateImage("a cat");
    expect(result).toContain("kling-img-id.png");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("throws on submit HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/images/generations") && !url.includes("/v1/images/generations/")) {
        return Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("") });
      }
      if (url.includes("/v1/images/generations/")) return Promise.resolve(pollOk("succeed", "https://example.com/i.png"));
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateImage("a cat")).rejects.toThrow("Kling image submit failed: 401");
  });

  it("throws on submit error code", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/images/generations") && !url.includes("/v1/images/generations/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 10010, message: "bad request" }) });
      }
      if (url.includes("/v1/images/generations/")) return Promise.resolve(pollOk("succeed", "https://example.com/i.png"));
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateImage("a cat")).rejects.toThrow("Kling image error: bad request");
  });

  it("throws on poll HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/images/generations/")) {
        return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("") });
      }
      if (url.includes("/v1/images/generations")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { task_id: "img-task-1" } }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateImage("a cat")).rejects.toThrow("Kling image poll failed: 500");
  }, 30000);

  it("throws on poll failed status", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/images/generations/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { task_status: "failed", task_status_msg: "gen error", task_result: {} } }) });
      }
      if (url.includes("/v1/images/generations")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { task_id: "img-task-1" } }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateImage("a cat")).rejects.toThrow("Kling image generation failed: gen error");
  }, 30000);

  it("throws on no URL in result", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/images/generations/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { task_status: "succeed", task_status_msg: "", task_result: {} } }) });
      }
      if (url.includes("/v1/images/generations")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { task_id: "img-task-1" } }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateImage("a cat")).rejects.toThrow("Kling image: no URL in result");
  }, 30000);

  it("downloads image and writes to disk", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak", uploadDir: "/tmp/uploads" });
    const promise = p.generateImage("a cat");
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    const imageFetch = fetchCalls.find(c => String(c.url).startsWith("https://example.com/image.png"));
    expect(imageFetch).toBeDefined();
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringMatching(/uploads[\\/]images/), { recursive: true });
  });

  it("passes signal to fetch calls", async () => {
    vi.useFakeTimers();
    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateImage("a cat");
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    for (const entry of fetchCalls) {
      expect(entry.options).toHaveProperty("signal");
    }
  });

  it("throws on JSON parse error from submit response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/images/generations") && !url.includes("/v1/images/generations/")) {
        return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")), text: vi.fn() });
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    let caught: any;
    const promise = p.generateImage("a cat").catch((e) => { caught = e; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(caught).toBeInstanceOf(SyntaxError);
  });

  it("throws on network error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("network error"))) as any);
    const p = makeProvider({ apiKey: "ak" });
    let caught: any;
    const promise = p.generateImage("a cat").catch((e) => { caught = e; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(caught).toBeInstanceOf(TypeError);
  });

  it("throws when poll times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/images/generations/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { task_status: "processing", task_status_msg: "", task_result: {} } }) });
      }
      if (url.includes("/v1/images/generations")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, data: { task_id: "img-task-1" } }) });
      }
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider({ apiKey: "ak" });
    let caught: any;
    const promise = p.generateImage("a cat").catch((e) => { caught = e; });
    await vi.advanceTimersByTimeAsync(300_100);
    vi.useRealTimers();
    expect(caught?.message).toContain("Kling image generation timed out after 5 minutes");
  }, 30_000);

  it("handles missing apiKey gracefully", () => {
    vi.stubEnv("KLING_ACCESS_KEY", "");
    vi.stubEnv("KLING_SECRET_KEY", "");
    const p = makeProvider();
    expect((p as any).apiKey).toBe("");
    vi.unstubAllEnvs();
  });
});
