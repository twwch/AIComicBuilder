import { describe, it, expect, vi, beforeEach } from "vitest";
import { ASXSImageProvider } from "../asxs-image";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "mock-id-456") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => Buffer.from("fake-image-bytes")),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    createReadStream: vi.fn(() => ({ pipe: vi.fn() })),
    createWriteStream: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => Buffer.from("fake-image-bytes")),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  createReadStream: vi.fn(() => ({ pipe: vi.fn() })),
  createWriteStream: vi.fn(),
}));

const mockGenerate = vi.hoisted(() => vi.fn());
const mockClient = vi.hoisted(() => ({ apiKey: undefined, baseURL: undefined, images: { generate: mockGenerate } }));
vi.mock("openai", () => {
  function MockOpenAI(opts?: Record<string, unknown>) {
    if (opts) {
      mockClient.apiKey = (opts as any).apiKey;
      mockClient.baseURL = (opts as any).baseURL;
    }
    return mockClient;
  }
  return {
    default: MockOpenAI,
    toFile: vi.fn((_buf, _name, _opts) => ({ buffer: _buf, filename: _name, type: _opts?.type })),
  };
});

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

describe("ASXSImageProvider", () => {
  describe("constructor", () => {
    it("uses default values when no params given", () => {
      vi.stubEnv("ASXS_API_KEY", "");
      vi.stubEnv("ASXS_BASE_URL", "");
      vi.stubEnv("ASXS_IMAGE_MODEL", "");
      vi.stubEnv("UPLOAD_DIR", "");
      const p = new ASXSImageProvider();
      expect((p as any).model).toBe("gpt-image-2");
      expect((p as any).uploadDir).toBe("./uploads");
      expect((p as any).client.baseURL).toBe("https://api.asxs.top/v1");
      vi.unstubAllEnvs();
    });

    it("uses env vars when params not given", () => {
      vi.stubEnv("ASXS_API_KEY", "env-key");
      vi.stubEnv("ASXS_BASE_URL", "https://env.asxs.top/v1");
      vi.stubEnv("ASXS_IMAGE_MODEL", "env-model");
      vi.stubEnv("UPLOAD_DIR", "/tmp/uploads");
      const p = new ASXSImageProvider();
      expect((p as any).model).toBe("env-model");
      expect((p as any).uploadDir).toBe("/tmp/uploads");
      expect((p as any).client.apiKey).toBe("env-key");
      vi.unstubAllEnvs();
    });

    it("uses constructor params over env vars", () => {
      vi.stubEnv("ASXS_API_KEY", "env-key");
      vi.stubEnv("ASXS_BASE_URL", "https://env.asxs.top/v1");
      const p = new ASXSImageProvider({ apiKey: "ctor-key", baseUrl: "https://ctor.asxs.top/v1" });
      expect((p as any).client.apiKey).toBe("ctor-key");
      expect((p as any).client.baseURL).toBe("https://ctor.asxs.top/v1");
      vi.unstubAllEnvs();
    });

    it("creates client with empty apiKey when no key provided", () => {
      vi.stubEnv("ASXS_API_KEY", "");
      vi.stubEnv("ASXS_BASE_URL", "");
      vi.stubEnv("IMAGEGEN_API_KEY", "");
      vi.stubEnv("OPENAI_API_KEY", "");
      const p = new ASXSImageProvider();
      expect((p as any).client.apiKey).toBe("");
      vi.unstubAllEnvs();
    });
  });

  describe("generateText", () => {
    it("throws because ASXS does not support text", async () => {
      const p = new ASXSImageProvider();
      await expect(p.generateText()).rejects.toThrow("does not support text");
    });
  });

  describe("generateImage", () => {
    it("returns file path on successful b64_json response", async () => {
      mockGenerate.mockResolvedValueOnce({
        data: [{ b64_json: "aW1hZ2U=" }],
      });
      const p = new ASXSImageProvider();
      const result = await p.generateImage("a cat");
      expect(result).toContain("mock-id-456.png");
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it("returns file path on successful url response", async () => {
      mockGenerate.mockResolvedValueOnce({
        data: [{ url: "https://example.com/img.png" }],
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "image/png" }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const p = new ASXSImageProvider();
      const result = await p.generateImage("a cat");
      expect(result).toContain("mock-id-456.png");
    });

    it("retries on transient error and succeeds", async () => {
      mockGenerate
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce({ data: [{ b64_json: "aW1hZ2U=" }] });
      const p = new ASXSImageProvider();
      const result = await p.generateImage("a cat");
      expect(result).toContain("mock-id-456.png");
      expect(mockGenerate).toHaveBeenCalledTimes(2);
    });

    it("bails out early on 403 quota error without retries", async () => {
      const quotaErr = Object.assign(new Error("余额不足"), { status: 403 });
      mockGenerate.mockRejectedValue(quotaErr);
      const p = new ASXSImageProvider();
      await expect(p.generateImage("a cat")).rejects.toThrow("余额不足");
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it("bails out on 401 auth error without retries", async () => {
      const authErr = Object.assign(new Error("unauthorized"), { status: 401 });
      mockGenerate.mockRejectedValue(authErr);
      const p = new ASXSImageProvider();
      await expect(p.generateImage("a cat")).rejects.toThrow("unauthorized");
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it("bails out on 429 rate limit error without retries", async () => {
      const rateErr = Object.assign(new Error("too many"), { status: 429 });
      mockGenerate.mockRejectedValue(rateErr);
      const p = new ASXSImageProvider();
      await expect(p.generateImage("a cat")).rejects.toThrow("too many");
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });

    it("throws on unexpected response shape from SDK", async () => {
      mockGenerate.mockReset();
      mockGenerate.mockResolvedValue({ data: [{ something: "unexpected" }] });
      const p = new ASXSImageProvider();
      await expect(p.generateImage("a cat")).rejects.toThrow("No image data returned");
    }, 15000);

    it("passes abort signal to download fetch", async () => {
      mockGenerate.mockResolvedValueOnce({ data: [{ url: "https://example.com/img.png" }] });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "image/png" }),
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      });
      const p = new ASXSImageProvider();
      await p.generateImage("a cat");
      expect(mockFetch).toHaveBeenCalled();
      const [, options] = mockFetch.mock.calls[0];
      expect(options).toBeDefined();
      expect((options as Record<string, unknown>).signal).toBeDefined();
    });

    it("falls back without refs when refs phase fails", async () => {
      mockGenerate
        .mockRejectedValueOnce(new Error("refs failed"))
        .mockRejectedValueOnce(new Error("refs retry failed"))
        .mockResolvedValueOnce({ data: [{ b64_json: "aW1hZ2U=" }] });
      const p = new ASXSImageProvider();
      const result = await p.generateImage("a cat", { referenceImages: ["ref1.jpg"] });
      expect(result).toContain("mock-id-456.png");
      expect(mockGenerate).toHaveBeenCalledTimes(3);
    });

    it("throws after all fallback attempts exhausted", async () => {
      mockGenerate.mockRejectedValue(new Error("always fails"));
      const p = new ASXSImageProvider();
      await expect(p.generateImage("a cat")).rejects.toThrow("always fails");
      expect(mockGenerate).toHaveBeenCalledTimes(5);
    }, 10000);

    it("passes size and quality options", async () => {
      mockGenerate.mockResolvedValue({ data: [{ b64_json: "aW1hZ2U=" }] });
      const p = new ASXSImageProvider();
      await p.generateImage("a cat", { size: "1536x1024", quality: "hd" });
      const callParams = mockGenerate.mock.calls[0][0];
      expect(callParams.size).toBe("1536x1024");
      expect(callParams.quality).toBe("hd");
    });

    it("resolves aspect ratio to size", async () => {
      mockGenerate.mockResolvedValue({ data: [{ b64_json: "aW1hZ2U=" }] });
      const p = new ASXSImageProvider();
      await p.generateImage("a cat", { aspectRatio: "9:16" });
      const callParams = mockGenerate.mock.calls[0][0];
      expect(callParams.size).toBe("1024x1536");
    });

    it("includes reference images in first attempt when provided", async () => {
      mockGenerate.mockResolvedValue({ data: [{ b64_json: "aW1hZ2U=" }] });
      const p = new ASXSImageProvider();
      await p.generateImage("a cat", { referenceImages: ["ref1.jpg", "ref2.jpg"] });
      const callParams = mockGenerate.mock.calls[0][0];
      expect(callParams.reference_images).toBeDefined();
      expect(Array.isArray(callParams.reference_images)).toBe(true);
    });
  });
});
