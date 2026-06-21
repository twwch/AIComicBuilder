import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NvidiaNimVideoProvider,
  getNimVideoModelFamily,
  isVideoToWorld,
  isTextToWorld,
  ratioToResolution,
  toImageUrl,
} from "../nvidia-nim-video";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "nim-vid-id") }));

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
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options });
      // Status poll returns completed after 1 call
      if (url.includes("nvcf.nvidia.com") && url.includes("/status/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: "completed",
              video: { url: "https://cdn.example.com/v.mp4" },
            }),
        });
      }
      // Video download
      if (url.includes("cdn.example.com")) {
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
        });
      }
      // Submit
      if (url.includes("ai.api.nvidia.com/v1/cosmos/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "nim-req-1" }),
        });
      }
      return Promise.resolve({ ok: false });
    }) as any,
  );
});

function makeProvider(
  params?: Partial<{
    apiKey: string;
    baseUrl: string;
    model: string;
    uploadDir: string;
    pollIntervalMs: number;
    maxPolls: number;
  }>,
) {
  return new NvidiaNimVideoProvider({
    apiKey: "test-key",
    baseUrl: "https://ai.api.nvidia.com",
    uploadDir: "./uploads-test",
    pollIntervalMs: 0,
    ...params,
  });
}

describe("getNimVideoModelFamily", () => {
  it("detects cosmos-1.0", () => {
    expect(getNimVideoModelFamily("nvidia/cosmos-1-0-7b-text2world")).toBe("cosmos-1.0");
    expect(getNimVideoModelFamily("nvidia/cosmos1-7b")).toBe("cosmos-1.0");
  });
  it("detects cosmos-predict1", () => {
    expect(getNimVideoModelFamily("nvidia/cosmos-predict1-7b-text2world")).toBe("cosmos-predict1");
  });
  it("detects cosmos-predict2", () => {
    expect(getNimVideoModelFamily("nvidia/cosmos-predict2-2b-text2world")).toBe("cosmos-predict2");
    expect(getNimVideoModelFamily("nvidia/cosmos-2-14b")).toBe("cosmos-predict2");
  });
  it("defaults to predict2 for unknown", () => {
    expect(getNimVideoModelFamily("nvidia/cosmos-future-99b")).toBe("cosmos-predict2");
  });
});

describe("isVideoToWorld / isTextToWorld", () => {
  it("detects V2W capability", () => {
    expect(isVideoToWorld("nvidia/cosmos-1-0-7b-video2world")).toBe(true);
    expect(isVideoToWorld("nvidia/cosmos-predict1-7b-i2v")).toBe(true);
    expect(isVideoToWorld("nvidia/cosmos-predict1-7b-v2v")).toBe(true);
    expect(isVideoToWorld("nvidia/cosmos-predict1-7b-text2world")).toBe(false);
  });
  it("detects T2W capability", () => {
    expect(isTextToWorld("nvidia/cosmos-predict2-2b-text2world")).toBe(true);
    expect(isTextToWorld("nvidia/cosmos-predict2-2b-t2v")).toBe(true);
    expect(isTextToWorld("nvidia/cosmos-predict2-2b-video2world")).toBe(false);
  });
});

describe("ratioToResolution", () => {
  it("forces 1024x640 for cosmos-1.0", () => {
    expect(ratioToResolution("16:9", "cosmos-1.0")).toEqual({ width: 1024, height: 640 });
    expect(ratioToResolution("9:16", "cosmos-1.0")).toEqual({ width: 1024, height: 640 });
  });
  it("forces 1024x640 for cosmos-predict1", () => {
    expect(ratioToResolution("16:9", "cosmos-predict1")).toEqual({ width: 1024, height: 640 });
  });
  it("uses aspect map for cosmos-predict2", () => {
    expect(ratioToResolution("16:9", "cosmos-predict2")).toEqual({ width: 1280, height: 720 });
    expect(ratioToResolution("9:16", "cosmos-predict2")).toEqual({ width: 720, height: 1280 });
    expect(ratioToResolution("1:1", "cosmos-predict2")).toEqual({ width: 1024, height: 1024 });
  });
  it("falls back to 16:9 for unknown ratio", () => {
    expect(ratioToResolution("99:1", "cosmos-predict2")).toEqual({ width: 1280, height: 720 });
  });
});

describe("toImageUrl", () => {
  it("passes http URLs as-is", () => {
    expect(toImageUrl("https://example.com/x.png")).toBe("https://example.com/x.png");
    expect(toImageUrl("http://example.com/x.png")).toBe("http://example.com/x.png");
  });
  it("converts local file to data URL with mime", () => {
    expect(toImageUrl("foo.png")).toMatch(/^data:image\/png;base64,/);
    expect(toImageUrl("foo.jpg")).toMatch(/^data:image\/jpeg;base64,/);
    expect(toImageUrl("foo.webp")).toMatch(/^data:image\/webp;base64,/);
  });
});

describe("NvidiaNimVideoProvider", () => {
  it("submits text-to-video to /v1/cosmos/<model>", async () => {
    const provider = makeProvider({ model: "nvidia/cosmos-predict2-2b-text2world" });
    const result = await provider.generateVideo({
      prompt: "a dog running",
      duration: 5,
      ratio: "16:9",
    } as any);
    expect(result.filePath).toContain("nim-vid-id");
    expect(result.filePath).toMatch(/\.mp4$/);
    const submit = fetchCalls.find((c) => c.url.includes("ai.api.nvidia.com/v1/cosmos/"));
    expect(submit).toBeDefined();
    const body = JSON.parse(submit!.options!.body as string);
    expect(body.prompt).toBe("a dog running");
    expect(body.num_frames).toBe(32);
    expect(body.fps).toBe(16);
    expect(body.width).toBe(1280);
    expect(body.height).toBe(720);
  });

  it("includes image in body for I2V (initialImage)", async () => {
    const provider = makeProvider({ model: "nvidia/cosmos-predict2-14b-video2world" });
    await provider.generateVideo({
      prompt: "camera push in",
      duration: 5,
      ratio: "16:9",
      initialImage: "first-frame.png",
    });
    const submit = fetchCalls.find((c) => c.url.includes("ai.api.nvidia.com/v1/cosmos/"));
    const body = JSON.parse(submit!.options!.body as string);
    expect(body.image).toMatch(/^data:image\/png;base64,/);
  });

  it("includes firstFrame and lastImage for keyframe mode", async () => {
    const provider = makeProvider({ model: "nvidia/cosmos-predict2-14b-video2world" });
    await provider.generateVideo({
      prompt: "morph from A to B",
      duration: 5,
      ratio: "16:9",
      firstFrame: "a.png",
      lastFrame: "b.png",
    });
    const submit = fetchCalls.find((c) => c.url.includes("ai.api.nvidia.com/v1/cosmos/"));
    const body = JSON.parse(submit!.options!.body as string);
    expect(body.image).toMatch(/^data:image\/png;base64,/);
    expect(body.last_image).toMatch(/^data:image\/png;base64,/);
  });

  it("uses cosmos-1.0 dimensions (1024x640, 32 frames, 8 fps) for predict1 family", async () => {
    const provider = makeProvider({ model: "nvidia/cosmos-1-0-7b-text2world" });
    await provider.generateVideo({
      prompt: "test",
      duration: 5,
      ratio: "16:9",
    } as any);
    const submit = fetchCalls.find((c) => c.url.includes("ai.api.nvidia.com/v1/cosmos/"));
    const body = JSON.parse(submit!.options!.body as string);
    expect(body.width).toBe(1024);
    expect(body.height).toBe(640);
    expect(body.num_frames).toBe(32);
    expect(body.fps).toBe(8);
  });

  it("scales num_frames with duration for predict2", async () => {
    const provider = makeProvider({ model: "nvidia/cosmos-predict2-2b-text2world" });
    await provider.generateVideo({
      prompt: "test",
      duration: 12,
      ratio: "16:9",
    } as any);
    const submit = fetchCalls.find((c) => c.url.includes("ai.api.nvidia.com/v1/cosmos/"));
    const body = JSON.parse(submit!.options!.body as string);
    expect(body.num_frames).toBe(93);
  });

  it("polls NVCF status endpoint with bearer auth", async () => {
    const provider = makeProvider({ model: "nvidia/cosmos-predict2-2b-text2world" });
    await provider.generateVideo({ prompt: "p", duration: 5, ratio: "1:1" } as any);
    const pollCall = fetchCalls.find((c) => c.url.includes("nvcf.nvidia.com"));
    expect(pollCall).toBeDefined();
    expect(pollCall!.url).toContain("/v2/nvcf/pexec/status/nim-req-1");
    expect(pollCall!.options!.headers).toMatchObject({
      Authorization: "Bearer test-key",
      Accept: "application/json",
    });
  });

  it("throws on submit error", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          text: () => Promise.resolve("Unauthorized"),
        }),
      ) as any,
    );
    const provider = makeProvider();
    await expect(
      provider.generateVideo({ prompt: "x", duration: 5, ratio: "16:9" } as any),
    ).rejects.toThrow(/401/);
  });

  it("throws on generation failure status", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("nvcf.nvidia.com")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ status: "failed", message: "GPU OOM" }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "req-1" }),
        });
      }) as any,
    );
    const provider = makeProvider();
    await expect(
      provider.generateVideo({ prompt: "x", duration: 5, ratio: "16:9" } as any),
    ).rejects.toThrow(/GPU OOM/);
  });

  it("handles sync response with inline video URL", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("cdn.example.com")) {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
          });
        }
        if (url.includes("ai.api.nvidia.com/v1/cosmos/")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: "req-sync",
                status: "completed",
                video: { url: "https://cdn.example.com/sync.mp4" },
              }),
          });
        }
        return Promise.resolve({ ok: false });
      }) as any,
    );
    const provider = makeProvider();
    const result = await provider.generateVideo({
      prompt: "x",
      duration: 5,
      ratio: "16:9",
    } as any);
    expect(result.filePath).toContain(".mp4");
  });

  it("saves base64 video from poll response", async () => {
    const b64 = Buffer.from("fake-video-bytes").toString("base64");
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("nvcf.nvidia.com")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ status: "completed", video: { base64: b64 } }),
          });
        }
        if (url.includes("ai.api.nvidia.com/v1/cosmos/")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: "req-b64" }),
          });
        }
        return Promise.resolve({ ok: false });
      }) as any,
    );
    const provider = makeProvider();
    const result = await provider.generateVideo({
      prompt: "x",
      duration: 5,
      ratio: "16:9",
    } as any);
    expect(result.filePath).toMatch(/\.mp4$/);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});
