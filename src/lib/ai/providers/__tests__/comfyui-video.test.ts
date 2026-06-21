import { describe, it, expect, vi, beforeEach } from "vitest";
import { ComfyUIVideoProvider } from "../comfyui-video";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "mock-id-456") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(() => "{}"),
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    createWriteStream: vi.fn(),
  },
  readFileSync: vi.fn(() => "{}"),
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock("@/lib/comfyui/preflight", () => ({
  preflightWorkflow: vi.fn(),
}));

vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return {
    ...actual,
    resolve: vi.fn((...args: string[]) => args.join("/")),
  };
});

import { preflightWorkflow } from "@/lib/comfyui/preflight";

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

describe("ComfyUIVideoProvider", () => {
  describe("constructor", () => {
    it("uses default values when no params given", () => {
      vi.stubEnv("COMFYUI_BASE_URL", "");
      vi.stubEnv("UPLOAD_DIR", "");
      const p = new ComfyUIVideoProvider();
      expect((p as any).baseUrl).toBe("http://localhost:8188");
      expect((p as any).model).toBe("wan-i2v");
      expect((p as any).uploadDir).toBe("./uploads");
      vi.unstubAllEnvs();
    });

    it("uses constructor params over env vars", () => {
      vi.stubEnv("COMFYUI_BASE_URL", "http://env:8188");
      const p = new ComfyUIVideoProvider({ baseUrl: "http://param:8188" });
      expect((p as any).baseUrl).toBe("http://param:8188");
      vi.unstubAllEnvs();
    });

    it("strips trailing slash from baseUrl", () => {
      const p = new ComfyUIVideoProvider({ baseUrl: "http://example.com:8188/" });
      expect((p as any).baseUrl).toBe("http://example.com:8188");
    });
  });

  describe("getAuthHeaders", () => {
    it("returns empty object when no auth configured", () => {
      const p = new ComfyUIVideoProvider();
      expect((p as any).getAuthHeaders()).toEqual({});
    });

    it("includes Bearer token when authToken is set", () => {
      const p = new ComfyUIVideoProvider({ authToken: "abc123" });
      expect((p as any).getAuthHeaders()).toEqual({ Authorization: "Bearer abc123" });
    });

    it("includes Cookie when authCookie is set", () => {
      const p = new ComfyUIVideoProvider({ authCookie: "session=xyz" });
      expect((p as any).getAuthHeaders()).toEqual({ Cookie: "session=xyz" });
    });

    it("includes both token and cookie", () => {
      const p = new ComfyUIVideoProvider({ authToken: "abc", authCookie: "xyz" });
      expect((p as any).getAuthHeaders()).toEqual({
        Authorization: "Bearer abc",
        Cookie: "xyz",
      });
    });
  });

  describe("getRequiredModels", () => {
    it("returns checkpoint model for LTX model", () => {
      vi.stubEnv("COMFYUI_LTX_CHECKPOINT", "");
      const p = new ComfyUIVideoProvider({ model: "ltx-i2v" });
      const models = (p as any).getRequiredModels();
      expect(models).toHaveLength(1);
      expect(models[0].path).toContain("ltx-2.3");
      expect(models[0].type).toBe("checkpoint");
      vi.unstubAllEnvs();
    });

    it("returns additional models for wan-i2v", () => {
      const p = new ComfyUIVideoProvider({ model: "wan-i2v" });
      const models = (p as any).getRequiredModels();
      expect(models).toHaveLength(4);
      expect(models[1].type).toBe("checkpoint");
      expect(models[2].type).toBe("vae");
      expect(models[3].type).toBe("clip");
    });

    it("uses env var for checkpoint name", () => {
      vi.stubEnv("COMFYUI_LTX_CHECKPOINT", "custom\\model.safetensors");
      const p = new ComfyUIVideoProvider({ model: "ltx-i2v" });
      const models = (p as any).getRequiredModels();
      expect(models[0].path).toBe("custom\\model.safetensors");
      vi.unstubAllEnvs();
    });
  });

  describe("findFileInOutputs", () => {
    it("returns null for empty outputs", () => {
      const p = new ComfyUIVideoProvider();
      expect((p as any).findFileInOutputs({})).toBeNull();
    });

    it("returns null when no video file found", () => {
      const p = new ComfyUIVideoProvider();
      const outputs = { "9": { images: [{ filename: "out.png" }] } };
      expect((p as any).findFileInOutputs(outputs)).toBeNull();
    });

    it("finds mp4 file in outputs", () => {
      const p = new ComfyUIVideoProvider();
      const outputs = { "75": { files: [{ filename: "video.mp4", type: "output" }] } };
      const result = (p as any).findFileInOutputs(outputs);
      expect(result).toEqual({ filename: "video.mp4", type: "output" });
    });

    it("finds gif file in outputs", () => {
      const p = new ComfyUIVideoProvider();
      const outputs = { "75": { gifs: [{ filename: "anim.gif" }] } };
      const result = (p as any).findFileInOutputs(outputs);
      expect(result).toEqual({ filename: "anim.gif" });
    });

    it("finds webm file in outputs", () => {
      const p = new ComfyUIVideoProvider();
      const outputs = { "75": { video: [{ filename: "clip.webm" }] } };
      const result = (p as any).findFileInOutputs(outputs);
      expect(result).toEqual({ filename: "clip.webm" });
    });
  });

  describe("generateVideo", () => {
    it("throws when server is unreachable", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: false,
        serverReachable: false,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: { code: "SERVER_UNAVAILABLE", message: "Connection refused" },
      });

      const p = new ComfyUIVideoProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateVideo({
        prompt: "a cat",
        duration: 5,
        ratio: "16:9",
        initialImage: "input.png",
      })).rejects.toThrow("ComfyUI server unreachable: Connection refused");
    });

    it("throws wan requires initial image", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const p = new ComfyUIVideoProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateVideo({
        prompt: "cat",
        duration: 5,
      } as any)).rejects.toThrow("ComfyUI video provider requires a starting image");
    });

    it("passes auth headers with requests", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/prompt")) return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({ prompt_id: "p-1" }),
          text: vi.fn(),
        });
        if (url.includes("/history")) return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            "p-1": { outputs: { "75": { files: [{ filename: "out.mp4" }] } } },
          }),
        });
        if (url.includes("/view")) return Promise.resolve({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
        });
        return Promise.resolve({ ok: true });
      });

      const p = new ComfyUIVideoProvider({
        baseUrl: "http://localhost:8188",
        authToken: "secret",
      });
      await p.generateVideo({
        prompt: "cat",
        duration: 5,
        ratio: "16:9",
        initialImage: "input.png",
      }).catch(() => {});
      expect(mockFetch.mock.calls[0][0]).toContain("/upload/image");
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
    });

    it("submits workflow and polls for video result", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      vi.spyOn(ComfyUIVideoProvider.prototype as any, "pollForVideo")
        .mockResolvedValue({ filename: "result.mp4", subfolder: "video", type: "output" });

      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ prompt_id: "prompt-789" }),
          text: vi.fn(),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
        });

      const p = new ComfyUIVideoProvider({ baseUrl: "http://localhost:8188" });
      const result = await p.generateVideo({
        prompt: "a running cat",
        duration: 8,
        ratio: "16:9",
        initialImage: "cat.png",
      });

      expect(result.filePath).toContain("mock-id-456");
      expect(result.filePath).toContain(".mp4");

      const submitCall = mockFetch.mock.calls[1];
      expect(submitCall[0]).toBe("http://localhost:8188/prompt");
      expect(submitCall[1].headers["Content-Type"]).toBe("application/json");
    });

    it("throws when prompt submit fails", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: vi.fn().mockResolvedValue("Internal error"),
        });

      const p = new ComfyUIVideoProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateVideo({
        prompt: "cat",
        duration: 5,
        ratio: "16:9",
        initialImage: "input.png",
      })).rejects.toThrow("ComfyUI prompt submit failed: 500 Internal error");
    });

    it("throws when prompt_id is missing", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({}),
          text: vi.fn(),
        });

      const p = new ComfyUIVideoProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateVideo({
        prompt: "cat",
        duration: 5,
        ratio: "16:9",
        initialImage: "input.png",
      })).rejects.toThrow(/no prompt_id/);
    });

    it("throws ltx multi-guide requires starting image for 4grid", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const p = new ComfyUIVideoProvider({ baseUrl: "http://localhost:8188", model: "ltx-4grid" });
      await expect(p.generateVideo({
        prompt: "cat",
        duration: 5,
      } as any)).rejects.toThrow("LTX multi-guide requires a starting image");
    });

    it("passes signal to fetch calls", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      vi.spyOn(ComfyUIVideoProvider.prototype as any, "pollForVideo")
        .mockResolvedValue({ filename: "result.mp4", subfolder: "video", type: "output" });

      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ prompt_id: "p-signal" }),
          text: vi.fn(),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
        });

      const p = new ComfyUIVideoProvider({ baseUrl: "http://localhost:8188" });
      await p.generateVideo({ prompt: "cat", duration: 5, ratio: "16:9", initialImage: "input.png" });
      for (const call of mockFetch.mock.calls) {
        expect(call[1]).toHaveProperty("signal");
      }
    });

    it("throws on JSON parse error from submit response", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token <")),
          text: vi.fn(),
        });

      const p = new ComfyUIVideoProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateVideo({
        prompt: "cat", duration: 5, ratio: "16:9", initialImage: "input.png",
      })).rejects.toThrow(SyntaxError);
    });

    it("throws on network error", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      mockFetch.mockRejectedValue(new TypeError("fetch failed"));

      const p = new ComfyUIVideoProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateVideo({
        prompt: "cat", duration: 5, ratio: "16:9", initialImage: "input.png",
      })).rejects.toThrow(TypeError);
    });

    it("throws when poll times out", async () => {
      vi.useFakeTimers();
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/upload/image")) {
          return Promise.resolve({ ok: true });
        }
        if (url.includes("/prompt")) {
          return Promise.resolve({
            ok: true,
            json: vi.fn().mockResolvedValue({ prompt_id: "p-timeout" }),
            text: vi.fn(),
          });
        }
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({}),
        });
      });

      const p = new ComfyUIVideoProvider({ baseUrl: "http://localhost:8188" });
      let caught: any;
      const promise = p.generateVideo({
        prompt: "cat", duration: 5, ratio: "16:9", initialImage: "input.png",
      }).catch((e) => { caught = e; });
      await vi.advanceTimersByTimeAsync(1_800_100);
      vi.useRealTimers();
      expect(caught?.message).toContain("ComfyUI video generation timed out after 30 minutes");
    }, 30_000);
  });
});

import { splitTimelinePrompts, buildManualStyleSegmentLengths } from "../comfyui-video";

describe("splitTimelinePrompts (module-level)", () => {
  it("returns empty prompts for text without patterns", () => {
    const result = splitTimelinePrompts("simple text");
    expect(result.globalPrompt).toBe("");
    expect(result.localPrompts).toEqual([]);
    expect(result.segmentSeconds).toEqual([]);
  });

  it("parses PANEL format prompts", () => {
    const text = [
      "PANEL 1 (close-up): A cat sleeping",
      "PANEL 2 (wide): A dog running",
      "",
      "Scene context: sunny day",
    ].join("\n");
    const result = splitTimelinePrompts(text);
    expect(result.localPrompts).toHaveLength(2);
    expect(result.localPrompts[0]).toContain("A cat sleeping");
    expect(result.localPrompts[1]).toContain("A dog running");
  });

  it("parses Chinese storyboard format with time ranges", () => {
    const text = [
      "分镜 1: 开场(00:00.0 - 00:05.0)",
      "画面提示词: A cat walks in",
      "分镜 2: 发展(00:05.0 - 00:10.0)",
      "画面提示词: The cat sits down",
      "分镜 3: 结局(00:10.0 - 00:15.0)",
      "画面提示词: Cat sleeps",
    ].join("\n");
    const result = splitTimelinePrompts(text);
    expect(result.localPrompts).toHaveLength(3);
    expect(result.segmentSeconds).toHaveLength(3);
    expect(result.segmentSeconds[0]).toBe(5);
    expect(result.segmentSeconds[1]).toBe(5);
    expect(result.segmentSeconds[2]).toBe(5);
  });

  it("extracts global prompt from structured format", () => {
    const text = [
      "1. 总提示词",
      "中文描述: A sunny park scene with characters",
      "2. 分镜 1: 开场(00:00.0 - 00:05.0)",
      "画面提示词: Cat enters",
      "3. 剧本逻辑总结",
    ].join("\n");
    const result = splitTimelinePrompts(text);
    expect(result.globalPrompt).toContain("A sunny park");
    expect(result.localPrompts).toHaveLength(1);
    expect(result.localPrompts[0]).toContain("Cat enters");
  });

  it("extracts scene context and camera direction", () => {
    const text = [
      "PANEL 1 (close-up): A cat",
      "",
      "Scene context: A sunny park",
      "Camera direction: pan-left",
      "Style: anime style, vibrant colors",
    ].join("\n");
    const result = splitTimelinePrompts(text);
    expect(result.globalPrompt).toContain("A sunny park");
    expect(result.globalPrompt).toContain("Camera direction: pan-left");
    expect(result.globalPrompt).toContain("anime style");
  });

  it("handles text with no matching patterns gracefully", () => {
    const result = splitTimelinePrompts("");
    expect(result.localPrompts).toEqual([]);
    expect(result.segmentSeconds).toEqual([]);
    expect(result.globalPrompt).toBe("");
  });
});

describe("buildManualStyleSegmentLengths (module-level)", () => {
  it("returns 4 segments of 91,90,90,90 for 4 prompts at >=14s duration", () => {
    const result = buildManualStyleSegmentLengths(14, 24, 4);
    expect(result).toEqual([91, 90, 90, 90]);
  });

  it("returns 4 segments for 14s at higher fps", () => {
    const result = buildManualStyleSegmentLengths(14, 30, 4);
    expect(result).toEqual([91, 90, 90, 90]);
  });

  it("splits total frames evenly for fewer prompts", () => {
    // duration 10s * 24fps = 240 frames / 3 prompts = 80 each
    const result = buildManualStyleSegmentLengths(10, 24, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(80);
    expect(result[1]).toBe(80);
    expect(result[2]).toBe(80);
  });

  it("last segment gets remainder", () => {
    // duration 10s * 24fps = 240 / 7 = 34.28 -> base 34
    // 34 * 6 = 204, remainder = 36
    const result = buildManualStyleSegmentLengths(10, 24, 7);
    expect(result).toHaveLength(7);
    expect(result[6]).toBe(240 - 34 * 6);
  });

  it("returns 2 segments for 2 prompts", () => {
    const result = buildManualStyleSegmentLengths(5, 24, 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(60);
    expect(result[1]).toBe(60);
  });

  it("handles single prompt", () => {
    const result = buildManualStyleSegmentLengths(5, 24, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(120);
  });
});
