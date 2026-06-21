import { describe, it, expect, vi, beforeEach } from "vitest";
import { ComfyUIImageProvider } from "../comfyui-image";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "mock-id-123") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(() => Buffer.from("fake-image-bytes")),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    createWriteStream: vi.fn(),
  },
  readFileSync: vi.fn(() => Buffer.from("fake-image-bytes")),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock("@/lib/comfyui/preflight", () => ({
  preflightWorkflow: vi.fn(),
}));

import { preflightWorkflow } from "@/lib/comfyui/preflight";

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

describe("ComfyUIImageProvider", () => {
  describe("constructor", () => {
    it("uses default values when no params given", () => {
      vi.stubEnv("COMFYUI_BASE_URL", "");
      vi.stubEnv("COMFYUI_MODEL", "");
      vi.stubEnv("UPLOAD_DIR", "");
      vi.stubEnv("COMFYUI_AUTH_TOKEN", "");
      vi.stubEnv("COMFYUI_AUTH_COOKIE", "");
      const p = new ComfyUIImageProvider();
      expect((p as any).baseUrl).toBe("https://2wdf3izjfh-8188.cnb.run");
      expect((p as any).model).toBe("hidream-o1-comfyui");
      expect((p as any).uploadDir).toBe("./uploads");
      vi.unstubAllEnvs();
    });

    it("uses env vars when params not given", () => {
      vi.stubEnv("COMFYUI_BASE_URL", "http://localhost:8188");
      vi.stubEnv("COMFYUI_MODEL", "z-image-turbo-comfyui");
      vi.stubEnv("UPLOAD_DIR", "/tmp/uploads");
      vi.stubEnv("COMFYUI_AUTH_TOKEN", "env-token");
      vi.stubEnv("COMFYUI_AUTH_COOKIE", "env-cookie");
      const p = new ComfyUIImageProvider();
      expect((p as any).baseUrl).toBe("http://localhost:8188");
      expect((p as any).model).toBe("z-image-turbo-comfyui");
      expect((p as any).uploadDir).toBe("/tmp/uploads");
      expect((p as any).authToken).toBe("env-token");
      expect((p as any).authCookie).toBe("env-cookie");
      vi.unstubAllEnvs();
    });

    it("uses constructor params over env vars", () => {
      vi.stubEnv("COMFYUI_BASE_URL", "http://env:8188");
      vi.stubEnv("COMFYUI_MODEL", "env-model");
      vi.stubEnv("COMFYUI_AUTH_TOKEN", "env-token");
      const p = new ComfyUIImageProvider({
        baseUrl: "http://param:8188",
        model: "param-model",
        authToken: "param-token",
      });
      expect((p as any).baseUrl).toBe("http://param:8188");
      expect((p as any).model).toBe("param-model");
      expect((p as any).authToken).toBe("param-token");
      vi.unstubAllEnvs();
    });

    it("strips trailing slash from baseUrl", () => {
      const p = new ComfyUIImageProvider({ baseUrl: "http://example.com:8188/" });
      expect((p as any).baseUrl).toBe("http://example.com:8188");
    });
  });

  describe("getAuthHeaders", () => {
    it("returns empty object when no auth configured", () => {
      const p = new ComfyUIImageProvider();
      expect((p as any).getAuthHeaders()).toEqual({});
    });

    it("includes Bearer token when authToken is set", () => {
      const p = new ComfyUIImageProvider({ authToken: "abc123" });
      expect((p as any).getAuthHeaders()).toEqual({ Authorization: "Bearer abc123" });
    });

    it("includes Cookie when authCookie is set", () => {
      const p = new ComfyUIImageProvider({ authCookie: "session=xyz" });
      expect((p as any).getAuthHeaders()).toEqual({ Cookie: "session=xyz" });
    });

    it("includes both token and cookie", () => {
      const p = new ComfyUIImageProvider({ authToken: "abc", authCookie: "xyz" });
      expect((p as any).getAuthHeaders()).toEqual({
        Authorization: "Bearer abc",
        Cookie: "xyz",
      });
    });
  });

  describe("generateText", () => {
    it("throws because image provider does not support text", async () => {
      const p = new ComfyUIImageProvider();
      await expect(p.generateText("hello")).rejects.toThrow(
        "ComfyUI image provider does not support text generation",
      );
    });
  });

  describe("buildReferenceBoardPrompt", () => {
    it("returns prompt unchanged when labels is empty", () => {
      const p = new ComfyUIImageProvider();
      const result = (p as any).buildReferenceBoardPrompt("hello", [], []);
      expect(result).toBe("hello");
    });

    it("builds reference board when labels provided", () => {
      const p = new ComfyUIImageProvider();
      const result = (p as any).buildReferenceBoardPrompt(
        "Generate a comic panel",
        ["character A", "background"],
        ["person", "scene"],
      );
      expect(result).toContain("Generate a comic panel");
      expect(result).toContain("Reference 1 (person): character A");
      expect(result).toContain("Reference 2 (scene): background");
      expect(result).toContain("Preserve identity, costume, pose intent");
    });

    it("uses 'reference' as default role when roles not provided", () => {
      const p = new ComfyUIImageProvider();
      const result = (p as any).buildReferenceBoardPrompt(
        "Generate",
        ["item"],
        [],
      );
      expect(result).toContain("Reference 1 (reference): item");
    });
  });

  describe("buildWorkflow", () => {
    it("returns correct structure for default workflow", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildWorkflow("a cat", { aspectRatio: "16:9" });
      expect(wf["57:27"].inputs.text).toBe("a cat");
      expect(wf["57:13"].inputs.width).toBe(1536);
      expect(wf["57:13"].inputs.height).toBe(1024);
      expect(wf["9"].class_type).toBe("SaveImage");
      expect(wf["57:3"].class_type).toBe("KSampler");
      expect(wf["57:3"].inputs.steps).toBe(8);
    });

    it("uses 9:16 dimensions when specified", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildWorkflow("a cat", { aspectRatio: "9:16" });
      expect(wf["57:13"].inputs.width).toBe(1024);
      expect(wf["57:13"].inputs.height).toBe(1536);
    });

    it("generates seed for KSampler", () => {
      const p = new ComfyUIImageProvider();
      const wf1 = (p as any).buildWorkflow("a cat");
      const wf2 = (p as any).buildWorkflow("a cat");
      expect(wf1["57:3"].inputs.seed).not.toBe(wf2["57:3"].inputs.seed);
    });
  });

  describe("buildQwenEditWorkflow", () => {
    it("returns correct structure for qwen-edit workflow", () => {
      const p = new ComfyUIImageProvider();
      const base = { name: "base.png" };
      const refs = [{ name: "ref1.png" }, { name: "ref2.png" }];
      const wf = (p as any).buildQwenEditWorkflow(
        "edit this panel",
        { aspectRatio: "4:3", referenceLabels: ["person", "bg"], referenceRoles: ["person", "scene"] },
        base,
        refs,
      );
      expect(wf["49"].class_type).toBe("LoadImage");
      expect(wf["49"].inputs.image).toBe("base.png");
      expect(wf["102"].class_type).toBe("SaveImage");
      expect(wf["247"].class_type).toBe("GetImageSize");
      expect(wf["248"].inputs["自定义宽"]).toBe(1024);
      expect(wf["248"].inputs["自定义高"]).toBe(768);
      expect(wf["221"].class_type).toBe("CheckpointLoaderSimple");
      expect(wf["222"].class_type).toBe("LoraLoaderModelOnly");
    });

    it("uses base image name as secondary when no extra references", () => {
      const p = new ComfyUIImageProvider();
      const base = { name: "base.png" };
      const wf = (p as any).buildQwenEditWorkflow("edit", {}, base, []);
      expect(wf["246"].inputs.image).toBe("base.png");
    });

    it("uses first reference as secondary when available", () => {
      const p = new ComfyUIImageProvider();
      const base = { name: "base.png" };
      const refs = [{ name: "ref1.png" }];
      const wf = (p as any).buildQwenEditWorkflow("edit", {}, base, refs);
      expect(wf["246"].inputs.image).toBe("ref1.png");
    });
  });

  describe("buildHiDreamO1Workflow", () => {
    it("returns correct structure for default workflow (no references)", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildHiDreamO1Workflow("a majestic dragon", { aspectRatio: "16:9" });
      expect(wf["6"].class_type).toBe("CheckpointLoaderSimple");
      expect(wf["6"].inputs.ckpt_name).toBe("hidream_o1_image_dev_mxfp8.safetensors");
      expect(wf["124"].class_type).toBe("ModelNoiseScale");
      expect(wf["124"].inputs.noise_scale).toBe(7.6);
      expect(wf["112"].class_type).toBe("BasicScheduler");
      expect(wf["125"].class_type).toBe("SamplerLCM");
      expect(wf["125"].inputs.s_noise).toBe(1);
      expect(wf["125"].inputs.s_noise_end).toBe(1);
      expect(wf["125"].inputs.noise_clip_std).toBe(2.5);
      expect(wf["110"].class_type).toBe("CLIPTextEncode");
      expect(wf["110"].inputs.text).toBe("a majestic dragon");
      expect(wf["188"].class_type).toBe("CLIPTextEncode");
      expect(wf["188"].inputs.text).toContain("duplicate characters");
      expect(wf["156"].class_type).toBe("EmptyHiDreamO1LatentImage");
      expect(wf["105"].class_type).toBe("VAEDecode");
      expect(wf["227"].class_type).toBe("SaveImage");
      expect(wf["108"].class_type).toBe("SamplerCustom");
      expect(wf["108"].inputs.cfg).toBe(1);
      expect(wf["108"].inputs.sampler).toEqual(["125", 0]);
      expect(wf["108"].inputs.positive).toEqual(["110", 0]);
      expect(wf["108"].inputs.negative).toEqual(["188", 0]);
      expect(wf["232"]).toBeUndefined();
      expect(wf["230"]).toBeUndefined();
      expect(wf["154"]).toBeUndefined();
      expect(wf["104"]).toBeUndefined();
      expect(wf["152"]).toBeUndefined();
      expect(wf["153"]).toBeUndefined();
    });

    it("includes reference nodes when references provided", () => {
      const p = new ComfyUIImageProvider();
      const refs = [{ name: "char.png" }, { name: "style.png" }];
      const wf = (p as any).buildHiDreamO1Workflow("a character", {}, refs);
      expect(wf["154"].class_type).toBe("PrimitiveBoolean");
      expect(wf["154"].inputs.value).toBe(true);
      expect(wf["104"].class_type).toBe("HiDreamO1ReferenceImages");
      expect(wf["104"].inputs.positive).toEqual(["110", 0]);
      expect(wf["104"].inputs.negative).toEqual(["188", 0]);
      expect(wf["104"].inputs["images.image_1"]).toEqual(["300", 0]);
      expect(wf["104"].inputs["images.image_2"]).toEqual(["301", 0]);
      expect(wf["152"].class_type).toBe("ComfySwitchNode");
      expect(wf["152"].inputs.on_false).toEqual(["110", 0]);
      expect(wf["152"].inputs.on_true).toEqual(["104", 0]);
      expect(wf["153"].class_type).toBe("ComfySwitchNode");
      expect(wf["153"].inputs.on_false).toEqual(["188", 0]);
      expect(wf["153"].inputs.on_true).toEqual(["104", 1]);
      expect(wf["300"].class_type).toBe("LoadImage");
      expect(wf["300"].inputs.image).toBe("char.png");
      expect(wf["301"].class_type).toBe("LoadImage");
      expect(wf["301"].inputs.image).toBe("style.png");
      expect(wf["108"].inputs.positive).toEqual(["152", 0]);
      expect(wf["108"].inputs.negative).toEqual(["153", 0]);
    });

    it("maps 16:9 aspect ratio to 2560x1440", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildHiDreamO1Workflow("test", { aspectRatio: "16:9" });
      expect(wf["156"].inputs.width).toBe(2560);
      expect(wf["156"].inputs.height).toBe(1440);
    });

    it("maps 9:16 aspect ratio to 1440x2560", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildHiDreamO1Workflow("test", { aspectRatio: "9:16" });
      expect(wf["156"].inputs.width).toBe(1440);
      expect(wf["156"].inputs.height).toBe(2560);
    });

    it("maps 1:1 aspect ratio to 2048x2048", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildHiDreamO1Workflow("test", { aspectRatio: "1:1" });
      expect(wf["156"].inputs.width).toBe(2048);
      expect(wf["156"].inputs.height).toBe(2048);
    });

    it("maps 4:3 aspect ratio to 2304x1728", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildHiDreamO1Workflow("test", { aspectRatio: "4:3" });
      expect(wf["156"].inputs.width).toBe(2304);
      expect(wf["156"].inputs.height).toBe(1728);
    });

    it("maps 3:2 aspect ratio to 2496x1664", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildHiDreamO1Workflow("test", { aspectRatio: "3:2" });
      expect(wf["156"].inputs.width).toBe(2496);
      expect(wf["156"].inputs.height).toBe(1664);
    });

    it("maps 2:3 aspect ratio to 1664x2496", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildHiDreamO1Workflow("test", { aspectRatio: "2:3" });
      expect(wf["156"].inputs.width).toBe(1664);
      expect(wf["156"].inputs.height).toBe(2496);
    });

    it("uses 28 steps when quality is 'default'", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildHiDreamO1Workflow("test", { quality: "default" });
      expect(wf["112"].inputs.steps).toBe(28);
    });

    it("uses 28 steps when quality is 'hd'", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildHiDreamO1Workflow("test", { quality: "hd" as any });
      expect(wf["112"].inputs.steps).toBe(28);
    });

    it("uses 20 steps when quality is not 'default'", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildHiDreamO1Workflow("test", { quality: "quality" });
      expect(wf["112"].inputs.steps).toBe(20);
    });

    it("uses 28 steps when quality is undefined", () => {
      const p = new ComfyUIImageProvider();
      const wf = (p as any).buildHiDreamO1Workflow("test", {});
      expect(wf["112"].inputs.steps).toBe(28);
    });

    it("generates different seeds for different calls", () => {
      const p = new ComfyUIImageProvider();
      const wf1 = (p as any).buildHiDreamO1Workflow("test");
      const wf2 = (p as any).buildHiDreamO1Workflow("test");
      expect(wf1["108"].inputs.noise_seed).not.toBe(wf2["108"].inputs.noise_seed);
    });
  });

  describe("generateImage", () => {
    it("throws when server is unreachable", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: false,
        serverReachable: false,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: { code: "SERVER_UNAVAILABLE", message: "Connection refused" },
      });

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateImage("a cat")).rejects.toThrow(
        "ComfyUI server unreachable: Connection refused",
      );
    });

    it("throws when qwen-edit model has no base image", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const p = new ComfyUIImageProvider({
        baseUrl: "http://localhost:8188",
        model: "qwen-edit-comfyui",
      });
      await expect(p.generateImage("edit", {})).rejects.toThrow(
        "ComfyUI qwen-edit requires an editBaseImage or at least one reference image",
      );
    });

    it("submits workflow and polls for result (non-qwen)", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const submitResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ prompt_id: "prompt-123" }),
        text: vi.fn(),
      };
      const historyResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          "prompt-123": {
            outputs: {
              "9": { images: [{ filename: "output.png", subfolder: "", type: "output" }] },
            },
          },
        }),
      };
      const viewResponse = {
        ok: true,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      };

      mockFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(historyResponse)
        .mockResolvedValueOnce(viewResponse);

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188", model: "z-image-turbo-comfyui" });
      const result = await p.generateImage("a cat");

      expect(result).toContain("mock-id-123");
      expect(result).toContain(".png");

      const submitCall = mockFetch.mock.calls[0];
      expect(submitCall[0]).toBe("http://localhost:8188/prompt");
      expect(JSON.parse(submitCall[1].body).prompt["57:27"].inputs.text).toBe("a cat");

      const historyCall = mockFetch.mock.calls[1];
      expect(historyCall[0]).toBe("http://localhost:8188/history/prompt-123");
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

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("Internal error"),
      });

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188", model: "z-image-turbo-comfyui" });
      await expect(p.generateImage("a cat")).rejects.toThrow(
        "ComfyUI image prompt submit failed: 500 Internal error",
      );
    });

    it("throws when prompt_id is missing in response", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ error: "no prompt_id" }),
        text: vi.fn(),
      });

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateImage("a cat")).rejects.toThrow(
        /no prompt_id/,
      );
    });

    it("polls until image output is found", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const submitResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ prompt_id: "prompt-456" }),
        text: vi.fn(),
      };
      const historyEmptyResponse = { ok: true, json: vi.fn().mockResolvedValue({}) };
      const historyReadyResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          "prompt-456": {
            outputs: {
              "9": { images: [{ filename: "final.png" }] },
            },
          },
        }),
      };
      const viewResponse = {
        ok: true,
        headers: new Map([["content-type", "image/jpeg"]]),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(20)),
      };

      mockFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(historyEmptyResponse)
        .mockResolvedValueOnce(historyReadyResponse)
        .mockResolvedValueOnce(viewResponse);

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      const result = await p.generateImage("a cat");
      expect(result).toContain(".jpg");
    });

    it("submits hidream-o1 workflow and polls for result", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const submitResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ prompt_id: "hidream-789" }),
        text: vi.fn(),
      };
      const historyResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          "hidream-789": {
            outputs: {
              "227": { images: [{ filename: "hidream_output.png" }] },
            },
          },
        }),
      };
      const viewResponse = {
        ok: true,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(15)),
      };

      mockFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(historyResponse)
        .mockResolvedValueOnce(viewResponse);

      const p = new ComfyUIImageProvider({
        baseUrl: "http://localhost:8188",
        model: "hidream-o1-comfyui",
      });
      const result = await p.generateImage("a majestic dragon");

      expect(result).toContain("mock-id-123");
      const submitCall = mockFetch.mock.calls[0];
      expect(submitCall[0]).toBe("http://localhost:8188/prompt");
      const submitBody = JSON.parse(submitCall[1].body);
      expect(submitBody.prompt["6"].class_type).toBe("CheckpointLoaderSimple");
      expect(submitBody.prompt["110"].inputs.text).toBe("a majestic dragon");
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

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ prompt_id: "p-1" }),
        text: vi.fn(),
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          "p-1": { outputs: { "9": { images: [{ filename: "out.png" }] } } },
        }),
      });
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      });

      const p = new ComfyUIImageProvider({
        baseUrl: "http://localhost:8188",
        authToken: "secret",
      });
      await p.generateImage("a cat").catch(() => {});
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
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

      const submitResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ prompt_id: "p-signal" }),
        text: vi.fn(),
      };
      const historyResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          "p-signal": {
            outputs: {
              "9": { images: [{ filename: "out.png" }] },
            },
          },
        }),
      };
      const viewResponse = {
        ok: true,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      };

      mockFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(historyResponse)
        .mockResolvedValueOnce(viewResponse);

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      await p.generateImage("a cat");
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token < in JSON")),
        text: vi.fn(),
      });

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateImage("a cat")).rejects.toThrow(SyntaxError);
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

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      await expect(p.generateImage("a cat")).rejects.toThrow(TypeError);
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

      const p = new ComfyUIImageProvider({ baseUrl: "http://localhost:8188" });
      let caught: any;
      const promise = p.generateImage("a cat").catch((e) => { caught = e; });
      await vi.advanceTimersByTimeAsync(240_100);
      vi.useRealTimers();
      expect(caught?.message).toContain("ComfyUI image generation timed out after 4 minutes");
    });

    it("submits ernie-image workflow and polls for result", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const submitResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ prompt_id: "ernie-1" }),
        text: vi.fn(),
      };
      const historyResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          "ernie-1": {
            outputs: {
              "73": { images: [{ filename: "ernie_output.png" }] },
            },
          },
        }),
      };
      const viewResponse = {
        ok: true,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(15)),
      };

      mockFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(historyResponse)
        .mockResolvedValueOnce(viewResponse);

      const p = new ComfyUIImageProvider({
        baseUrl: "http://localhost:8188",
        model: "ernie-image-comfyui",
      });
      const result = await p.generateImage("a futuristic city skyline");

      expect(result).toContain("mock-id-123");
      const submitCall = mockFetch.mock.calls[0];
      expect(submitCall[0]).toBe("http://localhost:8188/prompt");
      const submitBody = JSON.parse(submitCall[1].body);
      expect(submitBody.prompt["88:66"].class_type).toBe("UNETLoader");
      expect(submitBody.prompt["88:66"].inputs.unet_name).toBe("ernie-image.safetensors");
      expect(submitBody.prompt["88:62"].class_type).toBe("CLIPLoader");
      expect(submitBody.prompt["88:62"].inputs.clip_name).toBe("ministral-3-3b.safetensors");
      expect(submitBody.prompt["88:63"].class_type).toBe("VAELoader");
      expect(submitBody.prompt["88:63"].inputs.vae_name).toBe("flux2-vae.safetensors");
      expect(submitBody.prompt["88:78"].inputs.value).toBe("a futuristic city skyline");
      expect(submitBody.prompt["88:70"].class_type).toBe("KSampler");
      expect(submitBody.prompt["88:70"].inputs.steps).toBe(20);
      expect(submitBody.prompt["88:70"].inputs.cfg).toBe(4.0);
      expect(submitBody.prompt["88:70"].inputs.sampler_name).toBe("euler");
      expect(submitBody.prompt["73"].inputs.filename_prefix).toBe("ernie-image");
    });

    it("uses turbo settings when model id is ernie-image-turbo", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const submitResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ prompt_id: "ernie-turbo-1" }),
        text: vi.fn(),
      };
      const historyResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          "ernie-turbo-1": {
            outputs: {
              "73": { images: [{ filename: "ernie_turbo_output.png" }] },
            },
          },
        }),
      };
      const viewResponse = {
        ok: true,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
      };

      mockFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(historyResponse)
        .mockResolvedValueOnce(viewResponse);

      const p = new ComfyUIImageProvider({
        baseUrl: "http://localhost:8188",
        model: "ernie-image-turbo-comfyui",
      });
      await p.generateImage("a fast cat");

      const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(submitBody.prompt["88:66"].inputs.unet_name).toBe("ernie-image-turbo.safetensors");
      expect(submitBody.prompt["88:70"].inputs.steps).toBe(8);
      expect(submitBody.prompt["88:70"].inputs.cfg).toBe(1.0);
      expect(submitBody.prompt["88:70"].inputs.sampler_name).toBe("res_multistep");
      expect(submitBody.prompt["73"].inputs.filename_prefix).toBe("ernie-image-turbo");
    });

    it("respects explicit workflowFamily=ernie-image-comfyui", async () => {
      vi.mocked(preflightWorkflow).mockResolvedValue({
        ok: true,
        serverReachable: true,
        missingNodeTypes: [],
        missingModels: [],
        warnings: [],
        error: null,
      });

      const submitResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ prompt_id: "ernie-explicit" }),
        text: vi.fn(),
      };
      const historyResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          "ernie-explicit": {
            outputs: { "73": { images: [{ filename: "out.png" }] } },
          },
        }),
      };
      const viewResponse = {
        ok: true,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      };
      mockFetch
        .mockResolvedValueOnce(submitResponse)
        .mockResolvedValueOnce(historyResponse)
        .mockResolvedValueOnce(viewResponse);

      const p = new ComfyUIImageProvider({
        baseUrl: "http://localhost:8188",
        model: "z-image-turbo-comfyui",
      });
      await p.generateImage("test", { workflowFamily: "ernie-image-comfyui" });

      const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(submitBody.prompt["88:66"].class_type).toBe("UNETLoader");
      expect(submitBody.prompt["88:66"].inputs.unet_name).toBe("ernie-image.safetensors");
    });
  });
});
