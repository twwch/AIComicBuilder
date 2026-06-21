import { describe, it, expect, vi, beforeEach } from "vitest";
import { OmnigenImageProvider } from "../omnigen-image";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "og-id") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockReadFileSync = vi.hoisted(() => vi.fn(() => Buffer.from("ref-data")));
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  default: { existsSync: mockExistsSync, readFileSync: mockReadFileSync, mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn() },
  existsSync: mockExistsSync, readFileSync: mockReadFileSync, mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn(),
}));

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];
let streamBody: string | null = null;

function sseBody(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockExistsSync.mockClear();
  mockReadFileSync.mockClear();
  mockMkdirSync.mockClear();
  mockWriteFileSync.mockClear();
  fetchCalls = [];
  streamBody = null;
});

function makeProvider(params?: { baseUrl?: string; model?: string; uploadDir?: string; fnName?: string }) {
  return new OmnigenImageProvider(params);
}

function setupDefaultMocks(resultPath = "/tmp/og/output.png") {
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    fetchCalls.push({ url, options });
    if (url.includes("/gradio_api/upload")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([{ name: "file.png", data: "uploaded-ref" }]) });
    }
    if (url.includes("/gradio_api/call/generate") && !url.includes("/gradio_api/call/generate/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ event_id: "evt-1" }) });
    }
    if (url.includes("/gradio_api/call/generate/")) {
      const text = streamBody ?? sseBody("complete", [{ path: resultPath }]);
      return Promise.resolve({ ok: true, text: () => Promise.resolve(text) });
    }
    if (url.includes("/file=") || url.includes("/tmp/og/")) {
      return Promise.resolve({ ok: true, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    return Promise.resolve({ ok: false });
  }) as any);
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("OMNIGEN_BASE_URL", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).baseUrl).toBe("http://localhost:7860");
    expect((p as any).model).toBe("OmniGen-v1");
    expect((p as any).uploadDir).toBe("./uploads");
    expect((p as any).fnName).toBe("generate");
    vi.unstubAllEnvs();
  });

  it("reads env vars and param overrides", () => {
    vi.stubEnv("OMNIGEN_BASE_URL", "http://og.example.com");
    const p = makeProvider({ model: "OmniGen-v2", fnName: "run" });
    expect((p as any).baseUrl).toBe("http://og.example.com");
    expect((p as any).model).toBe("OmniGen-v2");
    expect((p as any).fnName).toBe("run");
    vi.unstubAllEnvs();
  });

  it("strips trailing slash", () => {
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

describe("buildOmnigenPrompt", () => {
  it("returns prompt as-is when no references", () => {
    const p = makeProvider();
    const result = p.buildOmnigenPrompt("a cat", {});
    expect(result).toBe("a cat");
  });

  it("builds prompt with reference tokens", () => {
    const p = makeProvider();
    const result = p.buildOmnigenPrompt("a cat", { referenceImages: ["ref1.png"] });
    expect(result).toContain("<img><|image_1|></img>");
    expect(result).toContain("reference 1");
  });

  it("includes labels and roles", () => {
    const p = makeProvider();
    const result = p.buildOmnigenPrompt("a cat", {
      referenceImages: ["ref1.png"],
      referenceLabels: ["main character"],
      referenceRoles: ["person"],
    });
    expect(result).toContain("[person]");
    expect(result).toContain("reference 1 (main character)");
  });

  it("handles editBaseImage", () => {
    const p = makeProvider();
    const result = p.buildOmnigenPrompt("make it night", {
      editBaseImage: "base.png",
      referenceImages: ["base.png"],
    });
    expect(result).toContain("<img><|image_1|></img>");
    expect(result).toContain("Edit the base image");
    expect(result).not.toContain("image_2");
  });

  it("deduplicates editBaseImage from references", () => {
    const p = makeProvider();
    const result = p.buildOmnigenPrompt("edit", {
      editBaseImage: "base.png",
      referenceImages: ["base.png", "extra.png"],
    });
    expect(result).toContain("image_1");
    expect(result).toContain("image_2");
    expect(result).not.toContain("image_3");
  });

  it("limits to 6 references", () => {
    const p = makeProvider();
    const result = p.buildOmnigenPrompt("many refs", { referenceImages: Array(10).fill("r.png") });
    const matches = result.match(/image_\d+/g);
    expect(matches).toHaveLength(6);
  });
});

describe("parseSSE", () => {
  it("parses data and complete events", () => {
    const p = makeProvider();
    const text = sseBody("data", { data: "progress" }) + sseBody("complete", [{ path: "result.png" }]);
    const events = p.parseSSE(text, "evt-1");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("data");
    expect(events[1].type).toBe("complete");
  });

  it("skips [DONE] marker", () => {
    const p = makeProvider();
    const text = "data: [DONE]\n\n";
    const events = p.parseSSE(text, "evt-1");
    expect(events).toHaveLength(0);
  });

  it("skips unparseable JSON", () => {
    const p = makeProvider();
    const text = "data: not-json\n\n";
    const events = p.parseSSE(text, "evt-1");
    expect(events).toHaveLength(0);
  });
});

describe("generateImage", () => {
  it("uploads images and starts generation", async () => {
    setupDefaultMocks();
    const p = makeProvider({ uploadDir: "/tmp/up" });
    await p.generateImage("a cat", { referenceImages: ["ref1.png"] });
    const uploadCalls = fetchCalls.filter(c => c.url.includes("/gradio_api/upload"));
    expect(uploadCalls.length).toBeGreaterThanOrEqual(1);
    const startCall = fetchCalls.find(c => c.url.includes("/gradio_api/call/generate") && !c.url.includes("/gradio_api/call/generate/"));
    expect(startCall).toBeDefined();
    const body = JSON.parse(startCall!.options!.body as string);
    expect(body.data[0]).toContain("image_1");
    expect(body.data[body.data.length - 1]).toBe(-1);
  });

  it("downloads result and saves to disk", async () => {
    setupDefaultMocks();
    const p = makeProvider({ uploadDir: "/tmp/up" });
    const result = await p.generateImage("a cat");
    expect(result).toContain("og-id.png");
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringMatching(/tmp[\\/]up[\\/]images/), { recursive: true });
  });

  it("handles txt2img (no refs) without uploading", async () => {
    setupDefaultMocks();
    const p = makeProvider();
    await p.generateImage("a cat");
    const uploadCalls = fetchCalls.filter(c => c.url.includes("/gradio_api/upload"));
    expect(uploadCalls).toHaveLength(0);
  });

  it("throws on upload failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/upload")) return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("") });
      if (url.includes("/gradio_api/call/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ event_id: "evt-1" }) });
      return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat", { referenceImages: ["r.png"] })).rejects.toThrow("OmniGen image upload failed: 500");
  });

  it("throws on start failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/call/generate") && !url.includes("/gradio_api/call/generate/")) return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve("bad") });
      return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("OmniGen generation start failed: 400");
  });

  it("throws on no event_id", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/call/generate") && !url.includes("/gradio_api/call/generate/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("OmniGen returned no event_id");
  });

  it("throws on download failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/call/generate") && !url.includes("/gradio_api/call/generate/")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ event_id: "evt-1" }) });
      if (url.includes("/gradio_api/call/generate/")) return Promise.resolve({ ok: true, text: () => Promise.resolve(sseBody("complete", [{ path: "/tmp/out.png" }])) });
      if (url.includes("/file=") || url.includes("/tmp/")) return Promise.resolve({ ok: false, status: 404 });
      return Promise.resolve({ ok: true });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("OmniGen image download failed: 404");
  }, 30000);

  it("passes AbortSignal to the start call", async () => {
    setupDefaultMocks();
    const p = makeProvider();
    await p.generateImage("a cat");
    const startCall = fetchCalls.find(c => c.url.includes("/gradio_api/call/generate") && !c.url.includes("/gradio_api/call/generate/"));
    expect(startCall!.options!.signal).toBeDefined();
  });

  it("throws on JSON parse error in start response", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/call/generate") && !url.includes("/gradio_api/call/generate/")) return Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("Unexpected token")) });
      return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow(SyntaxError);
  });

  it("throws on network error during start", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/gradio_api/call/generate") && !url.includes("/gradio_api/call/generate/")) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
    }) as any);
    const p = makeProvider();
    await expect(p.generateImage("cat")).rejects.toThrow("fetch failed");
  });
});
