import { describe, it, expect } from "vitest";
import { detectImageModelFamily } from "../character-image";

describe("detectImageModelFamily", () => {
  it("returns 'gpt' for gpt-image model", () => {
    expect(detectImageModelFamily("openai", "gpt-image-2")).toBe("gpt");
    expect(detectImageModelFamily(undefined, "gpt-image-2")).toBe("gpt");
  });

  it("returns 'agnes' for agnes protocol or model", () => {
    expect(detectImageModelFamily("agnes", "agnes-v1")).toBe("agnes");
    expect(detectImageModelFamily(undefined, "agnes-v1")).toBe("agnes");
  });

  it("returns 'sensenova' for sensenova protocol or model", () => {
    expect(detectImageModelFamily("sensenova", "sensenova-v1")).toBe("sensenova");
    expect(detectImageModelFamily(undefined, "sensenova-v1")).toBe("sensenova");
  });

  it("returns 'ideogram4' for ideogram4 protocol or model", () => {
    expect(detectImageModelFamily("ideogram4", "ideogram4-v1")).toBe("ideogram4");
    expect(detectImageModelFamily(undefined, "ideogram4-comfyui")).toBe("ideogram4");
    expect(detectImageModelFamily(undefined, "ideogram-4")).toBe("ideogram4");
  });

  it("returns 'hidream' for hidream model", () => {
    expect(detectImageModelFamily("comfyui", "hidream-o1-comfyui")).toBe("hidream");
    expect(detectImageModelFamily(undefined, "hidream_o1_xyz")).toBe("hidream");
  });

  it("returns 'ernie' for ernie model", () => {
    expect(detectImageModelFamily("comfyui", "ernie-image-comfyui")).toBe("ernie");
    expect(detectImageModelFamily("comfyui", "ernie-image-turbo-comfyui")).toBe("ernie");
    expect(detectImageModelFamily(undefined, "ernie-image-turbo")).toBe("ernie");
  });

  it("returns 'other' for unknown models", () => {
    expect(detectImageModelFamily("comfyui", "z-image-turbo-comfyui")).toBe("other");
    expect(detectImageModelFamily("openai", "dall-e-3")).toBe("other");
    expect(detectImageModelFamily(undefined, undefined)).toBe("other");
  });
});
