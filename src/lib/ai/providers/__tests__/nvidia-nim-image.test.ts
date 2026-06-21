import { describe, it, expect, vi, beforeEach } from "vitest";
import { NvidiaNimImageProvider } from "../nvidia-nim-image";

vi.mock("@/lib/id", () => ({ id: vi.fn(() => "nim-img-id") }));

vi.mock("node:stream/promises", () => ({ pipeline: vi.fn(() => Promise.resolve()) }));

const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(() => true), mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn() },
  existsSync: vi.fn(() => true), mkdirSync: mockMkdirSync, writeFileSync: mockWriteFileSync, createWriteStream: vi.fn(),
}));

let fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockMkdirSync.mockClear();
  mockWriteFileSync.mockClear();
  fetchCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, options?: RequestInit) => {
      fetchCalls.push({ url, options });
      if (url.includes("nvcf.nvidia.com") && url.includes("/status/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: "completed",
              image: { url: "https://cdn.example.com/img.png" },
            }),
        });
      }
      if (url.includes("cdn.example.com")) {
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        });
      }
      if (url.includes("ai.api.nvidia.com/v1/cosmos/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "nim-img-req-1" }),
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
  }>,
) {
  return new NvidiaNimImageProvider({
    apiKey: "test-key",
    baseUrl: "https://ai.api.nvidia.com",
    uploadDir: "./uploads-test",
    pollIntervalMs: 0,
    ...params,
  });
}

describe("NvidiaNimImageProvider", () => {
  it("throws on text generation (image-only provider)", async () => {
    const provider = makeProvider();
    await expect(provider.generateText("hello")).rejects.toThrow(/does not support text/);
  });

  it("submits text-to-image to /v1/cosmos/<model>", async () => {
    const provider = makeProvider({ model: "nvidia/cosmos-predict2-2b-text2image" });
    const filepath = await provider.generateImage("a cat", { aspectRatio: "1:1" });
    expect(filepath).toContain("nim-img-id");
    expect(filepath).toMatch(/\.png$/);
    const submit = fetchCalls.find((c) => c.url.includes("ai.api.nvidia.com/v1/cosmos/"));
    expect(submit).toBeDefined();
    const body = JSON.parse(submit!.options!.body as string);
    expect(body.prompt).toBe("a cat");
    expect(body.width).toBe(1024);
    expect(body.height).toBe(1024);
    expect(body.num_inference_steps).toBe(20);
    expect(body.guidance_scale).toBe(3.0);
  });

  it("uses higher steps/cfg for non-turbo models", async () => {
    const provider = makeProvider({ model: "nvidia/cosmos-predict2-14b-text2image" });
    await provider.generateImage("a cat", { aspectRatio: "1:1" });
    const submit = fetchCalls.find((c) => c.url.includes("ai.api.nvidia.com/v1/cosmos/"));
    const body = JSON.parse(submit!.options!.body as string);
    expect(body.num_inference_steps).toBe(35);
    expect(body.guidance_scale).toBe(7.0);
  });

  it("maps aspect ratio to dimensions", async () => {
    const provider = makeProvider();
    await provider.generateImage("x", { aspectRatio: "16:9" });
    const submit = fetchCalls.find((c) => c.url.includes("ai.api.nvidia.com/v1/cosmos/"));
    const body = JSON.parse(submit!.options!.body as string);
    expect(body.width).toBe(1280);
    expect(body.height).toBe(720);
  });

  it("parses explicit size string", async () => {
    const provider = makeProvider();
    await provider.generateImage("x", { size: "768x1024" });
    const submit = fetchCalls.find((c) => c.url.includes("ai.api.nvidia.com/v1/cosmos/"));
    const body = JSON.parse(submit!.options!.body as string);
    expect(body.width).toBe(768);
    expect(body.height).toBe(1024);
  });

  it("includes negative_prompt when provided", async () => {
    const provider = makeProvider();
    await provider.generateImage("x", { negativePrompt: "blurry, low quality" });
    const submit = fetchCalls.find((c) => c.url.includes("ai.api.nvidia.com/v1/cosmos/"));
    const body = JSON.parse(submit!.options!.body as string);
    expect(body.negative_prompt).toBe("blurry, low quality");
  });

  it("polls NVCF status after submit", async () => {
    const provider = makeProvider();
    await provider.generateImage("x");
    const pollCall = fetchCalls.find((c) => c.url.includes("nvcf.nvidia.com"));
    expect(pollCall).toBeDefined();
    expect(pollCall!.url).toContain("/v2/nvcf/pexec/status/nim-img-req-1");
  });

  it("throws on submit HTTP error", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("oops") }),
      ) as any,
    );
    const provider = makeProvider();
    await expect(provider.generateImage("x")).rejects.toThrow(/500/);
  });

  it("throws on generation failure during poll", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("nvcf.nvidia.com")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ status: "failed", message: "safety block" }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "req-x" }),
        });
      }) as any,
    );
    const provider = makeProvider();
    await expect(provider.generateImage("x")).rejects.toThrow(/safety block/);
  });

  it("saves base64 image from poll response", async () => {
    const b64 = Buffer.from("fake-png").toString("base64");
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("nvcf.nvidia.com")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ status: "completed", image: { base64: b64 } }),
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
    const filepath = await provider.generateImage("x");
    expect(filepath).toMatch(/\.png$/);
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});
