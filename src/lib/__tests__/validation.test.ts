import { describe, it, expect } from "vitest";
import {
  ProjectSchema,
  EpisodeSchema,
  ShotSchema,
  ProviderConfigSchema,
  UploadModelConfigSchema,
  GenerateRequestSchema,
  parseOrThrow,
} from "@/lib/validation";

describe("ProjectSchema", () => {
  it("accepts valid project", () => {
    expect(ProjectSchema.parse({ title: "My Comic" })).toMatchObject({ title: "My Comic" });
  });

  it("rejects empty title", () => {
    expect(() => ProjectSchema.parse({ title: "" })).toThrow();
  });

  it("rejects title > 200 chars", () => {
    expect(() => ProjectSchema.parse({ title: "x".repeat(201) })).toThrow();
  });

  it("defaults script to empty string", () => {
    expect(ProjectSchema.parse({ title: "Test" }).script).toBe("");
  });
});

describe("EpisodeSchema", () => {
  it("accepts valid episode", () => {
    expect(EpisodeSchema.parse({ title: "Episode 1" })).toMatchObject({ title: "Episode 1" });
  });

  it("rejects empty title", () => {
    expect(() => EpisodeSchema.parse({ title: "" })).toThrow();
  });
});

describe("ShotSchema", () => {
  it("requires episodeId", () => {
    expect(() => ShotSchema.parse({})).toThrow();
  });

  it("accepts valid shot", () => {
    expect(ShotSchema.parse({ episodeId: "abc123" })).toMatchObject({ episodeId: "abc123" });
  });
});

describe("ProviderConfigSchema", () => {
  const valid = { protocol: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-xxx", modelId: "gpt-4" };

  it("accepts valid config", () => {
    expect(ProviderConfigSchema.parse(valid)).toMatchObject(valid);
  });

  it("rejects missing protocol", () => {
    const { protocol, ...rest } = valid;
    expect(() => ProviderConfigSchema.parse(rest)).toThrow();
  });

  it("accepts optional secretKey", () => {
    expect(ProviderConfigSchema.parse({ ...valid, secretKey: "sk-123" }).secretKey).toBe("sk-123");
  });

  it("rejects empty modelId", () => {
    expect(() => ProviderConfigSchema.parse({ ...valid, modelId: "" })).toThrow();
  });
});

describe("UploadModelConfigSchema", () => {
  it("requires text provider", () => {
    expect(() => UploadModelConfigSchema.parse({})).toThrow();
  });

  it("accepts valid config", () => {
    const valid = { text: { protocol: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-xxx", modelId: "gpt-4" } };
    expect(UploadModelConfigSchema.parse(valid)).toMatchObject(valid);
  });
});

describe("GenerateRequestSchema", () => {
  it("accepts valid generate request", () => {
    const valid = { action: "script_outline" };
    expect(GenerateRequestSchema.parse(valid).action).toBe("script_outline");
  });

  it("rejects invalid action", () => {
    expect(() => GenerateRequestSchema.parse({ action: "invalid_action" })).toThrow();
  });
});

describe("parseOrThrow", () => {
  it("returns parsed data on success", () => {
    expect(parseOrThrow(ProjectSchema, { title: "Test" })).toMatchObject({ title: "Test" });
  });

  it("throws with readable message on failure", () => {
    expect(() => parseOrThrow(ProjectSchema, { title: "" })).toThrow(/title/);
  });
});
