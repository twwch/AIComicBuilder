import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VeoProvider } from "../veo";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "veo-id") }));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(() => Buffer.from("img")),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  readFileSync: vi.fn(() => Buffer.from("img")),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const mockClient = vi.hoisted(() => ({
  generateVideos: vi.fn(),
  download: vi.fn(),
  getVideosOperation: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return {
      models: { generateVideos: mockClient.generateVideos },
      files: { download: mockClient.download },
      operations: { getVideosOperation: mockClient.getVideosOperation },
    };
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

function makeProvider(params?: { apiKey?: string; baseUrl?: string; model?: string; uploadDir?: string }) {
  return new VeoProvider(params);
}

function doneOperation(overrides: Record<string, unknown> = {}) {
  return {
    done: true,
    error: undefined,
    response: {
      generatedVideos: [{ video: "files/abc123" }],
      raiMediaFilteredCount: 0,
      ...overrides,
    },
  };
}

describe("constructor", () => {
  it("uses defaults when no params given", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("UPLOAD_DIR", "");
    const p = makeProvider();
    expect((p as any).model).toBe("veo-2.0-generate-001");
    expect((p as any).uploadDir).toBe("./uploads");
    vi.unstubAllEnvs();
  });

  it("reads from env vars", () => {
    vi.stubEnv("GEMINI_API_KEY", "env-key");
    vi.stubEnv("UPLOAD_DIR", "/tmp/env");
    const p = makeProvider();
    expect((p as any).uploadDir).toBe("/tmp/env");
    vi.unstubAllEnvs();
  });

  it("constructor params override env vars", () => {
    vi.stubEnv("GEMINI_API_KEY", "env-key");
    const p = makeProvider({ apiKey: "ctor-key", model: "veo-3.1-generate-001" });
    expect((p as any).model).toBe("veo-3.1-generate-001");
    vi.unstubAllEnvs();
  });

  it("strips trailing slash and version from baseUrl", () => {
    const p = makeProvider({ baseUrl: "https://example.com/v1/" });
    expect((p as any).client).toBeDefined();
  });

  it("handles missing API key gracefully", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const p = makeProvider();
    expect((p as any).client).toBeDefined();
    vi.unstubAllEnvs();
  });
});

describe("generateVideo", () => {
  it("generates keyframe mode with firstFrame and lastFrame", async () => {
    mockClient.generateVideos.mockResolvedValue(doneOperation());
    mockClient.download.mockResolvedValue(undefined);

    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "cat", firstFrame: "f.png", lastFrame: "l.png", ratio: "16:9", duration: 6 } as any);

    expect(mockClient.generateVideos).toHaveBeenCalled();
    const callArgs = mockClient.generateVideos.mock.calls[0][0];
    expect(callArgs.model).toBe("veo-2.0-generate-001");
    expect(callArgs.config.durationSeconds).toBe(6);
    expect(callArgs.config.aspectRatio).toBe("16:9");
    expect(result.filePath).toContain("veo-id.mp4");
  });

  it("generates reference mode with initialImage", async () => {
    mockClient.generateVideos.mockResolvedValue(doneOperation());
    mockClient.download.mockResolvedValue(undefined);

    const p = makeProvider({ apiKey: "ak" });
    const result = await p.generateVideo({ prompt: "cat", initialImage: "ref.png", duration: 6, ratio: "9:16" } as any);

    expect(mockClient.generateVideos).toHaveBeenCalled();
    const callArgs = mockClient.generateVideos.mock.calls[0][0];
    expect(callArgs.config.aspectRatio).toBe("9:16");
    expect(result.filePath).toContain("veo-id.mp4");
  });

  it("throws when no image provided", async () => {
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", duration: 6, ratio: "16:9" } as any)).rejects.toThrow("Veo requires an image input");
  });

  it("uses referenceImages mode for Veo 3.1", async () => {
    mockClient.generateVideos.mockResolvedValue(doneOperation());
    mockClient.download.mockResolvedValue(undefined);

    const p = makeProvider({ apiKey: "ak", model: "veo-3.1-generate-001" });
    await p.generateVideo({ prompt: "cat", initialImage: "ref.png", referenceImages: ["r1.png", "r2.png"], duration: 6, ratio: "16:9" } as any);

    const callArgs = mockClient.generateVideos.mock.calls[0][0];
    expect(callArgs.model).toBe("veo-3.1-generate-001");
    expect(callArgs.config.referenceImages).toHaveLength(3);
    expect(callArgs.config.durationSeconds).toBe(8);
    expect(callArgs.image).toBeUndefined();
  });

  it("polls when operation is not done", async () => {
    vi.useFakeTimers();
    mockClient.generateVideos.mockResolvedValue({ done: false });
    mockClient.getVideosOperation.mockResolvedValue(doneOperation());
    mockClient.download.mockResolvedValue(undefined);

    const p = makeProvider({ apiKey: "ak" });
    const promise = p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 6, ratio: "16:9" } as any);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(result.filePath).toContain("veo-id.mp4");
    expect(mockClient.getVideosOperation).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("throws on safety filter", async () => {
    mockClient.generateVideos.mockImplementation(() => Promise.resolve({
      done: true,
      response: {
        generatedVideos: [],
        raiMediaFilteredCount: 2,
        raiMediaFilteredReasons: ["violence"],
      },
    }));

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 6, ratio: "16:9" } as any)).rejects.toThrow("Veo generation blocked by safety filter");
  });

  it("throws when no video returned", async () => {
    mockClient.generateVideos.mockImplementation(() => Promise.resolve({
      done: true,
      response: { generatedVideos: [], raiMediaFilteredCount: 0 },
    }));

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 6, ratio: "16:9" } as any)).rejects.toThrow("No video returned from Veo");
  });

  it("throws when generation error occurs", async () => {
    mockClient.generateVideos.mockResolvedValue({
      done: true,
      error: { message: "GPU OOM" },
      response: null,
    });

    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 6, ratio: "16:9" } as any)).rejects.toThrow("Veo generation failed");
  });

  it("downloads video to uploads/videos/", async () => {
    mockClient.generateVideos.mockResolvedValue(doneOperation());
    mockClient.download.mockResolvedValue(undefined);

    const p = makeProvider({ apiKey: "ak", uploadDir: "/tmp/up" });
    await p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 6, ratio: "16:9" } as any);

    expect(mockClient.download).toHaveBeenCalled();
    expect(mockClient.download.mock.calls[0][0].file).toBe("files/abc123");
  });

  it("throws on network error from Veo SDK", async () => {
    mockClient.generateVideos.mockRejectedValue(new Error("connect ETIMEDOUT"));
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 6, ratio: "16:9" } as any)).rejects.toThrow("connect ETIMEDOUT");
  });

  it("throws when operation returns no generatedVideos", async () => {
    mockClient.generateVideos.mockResolvedValue({
      done: true,
      response: { generatedVideos: null, raiMediaFilteredCount: 0 },
    });
    const p = makeProvider({ apiKey: "ak" });
    await expect(p.generateVideo({ prompt: "cat", firstFrame: "f.png", duration: 6, ratio: "16:9" } as any)).rejects.toThrow("No video returned from Veo");
  });
});
