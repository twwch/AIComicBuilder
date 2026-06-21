import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectWhere = vi.hoisted(() => vi.fn());
const mockSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockSelectWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));

const mockUpdateWhere = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: mockUpdateWhere })));
const mockUpdate = vi.hoisted(() => vi.fn(() => ({ set: mockUpdateSet })));

const mockGenerateImage = vi.hoisted(() => vi.fn());
const mockResolvePrompt = vi.hoisted(() => vi.fn());
const mockDetectFamily = vi.hoisted(() => vi.fn());
const mockLoadLegacy = vi.hoisted(() => vi.fn());
const mockPatchAsset = vi.hoisted(() => vi.fn());
const mockExtractError = vi.hoisted(() => vi.fn());
const mockExtractPortrait = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect, update: mockUpdate },
}));

vi.mock("@/lib/ai/prompts/character-image", () => ({
  detectImageModelFamily: mockDetectFamily,
}));

vi.mock("@/lib/ai/provider-factory", () => ({
  resolveImageProvider: vi.fn(() => ({ generateImage: mockGenerateImage })),
}));

vi.mock("@/lib/ai/prompts/resolver", () => ({
  resolvePrompt: mockResolvePrompt,
}));

vi.mock("@/lib/shot-asset-utils", () => ({
  loadShotLegacyViewsBatch: mockLoadLegacy,
  patchAsset: mockPatchAsset,
}));

vi.mock("@/lib/generate-utils", () => ({
  extractErrorMessage: mockExtractError,
}));

vi.mock("@/lib/character-ref-utils", () => ({
  extractCharacterReferencePortrait: mockExtractPortrait,
}));

vi.mock("@/lib/ai/ai-sdk", () => ({
  createLanguageModel: vi.fn(),
  extractJSON: vi.fn(),
}));

import { handleSingleCharacterImage } from "../character";

const MOCK_CHARACTER = {
  id: "char-1",
  projectId: "proj-1",
  name: "英雄",
  description: "一位勇敢的战士，穿着红色铠甲",
  visualHint: "",
  referenceImage: null,
  referenceImageHistory: "[]",
  referenceImageSingle: null,
  referenceLayout: null,
  scope: "main" as const,
  performanceStyle: "",
  heightCm: 180,
  bodyType: "athletic",
  isStale: 0,
  episodeId: null,
};

const BASE_MODEL_CONFIG = {
  image: {
    protocol: "comfyui",
    baseUrl: "http://localhost:8188",
    apiKey: "test-key",
    modelId: "hidream_o1_image_mxfp8.safetensors",
  },
};

describe("handleSingleCharacterImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when characterId is missing", async () => {
    const res = await handleSingleCharacterImage("proj-1", "user-1", {}, undefined);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "No characterId provided" });
  });

  it("returns 400 when no image model configured", async () => {
    const res = await handleSingleCharacterImage("proj-1", "user-1", { characterId: "char-1" }, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "No image model configured" });
  });

  it("returns 404 when character not found", async () => {
    mockSelectWhere.mockResolvedValueOnce([]);
    const res = await handleSingleCharacterImage("proj-1", "user-1", { characterId: "char-1" }, BASE_MODEL_CONFIG);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Character not found" });
  });

  it("generates HiDream-O1 image successfully with correct routing", async () => {
    mockSelectWhere.mockResolvedValueOnce([MOCK_CHARACTER]);
    mockDetectFamily.mockReturnValue("hidream");
    mockResolvePrompt.mockResolvedValue("a brave warrior in red armor");
    mockGenerateImage.mockResolvedValue("characters/char-1-default.png");
    mockSelectWhere.mockResolvedValueOnce([]);
    mockLoadLegacy.mockResolvedValue(new Map());

    const res = await handleSingleCharacterImage("proj-1", "user-1", { characterId: "char-1" }, BASE_MODEL_CONFIG);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ characterId: "char-1", imagePath: "characters/char-1-default.png", status: "ok", staleShots: 0, referenceLayout: "four-view" });

    expect(mockDetectFamily).toHaveBeenCalledWith("comfyui", "hidream_o1_image_mxfp8.safetensors");
    expect(mockResolvePrompt).toHaveBeenCalledWith(
      "character_image_hidream_o1",
      { userId: "user-1", projectId: "proj-1" },
      { characterName: "英雄", description: "一位勇敢的战士，穿着红色铠甲", referenceLayout: "four-view" }
    );
    expect(mockGenerateImage).toHaveBeenCalledWith(
      "a brave warrior in red armor",
      expect.objectContaining({
        size: "2560x1440",
        aspectRatio: "16:9",
        quality: "hd",
        workflowFamily: "hidream-o1-comfyui",
      })
    );
    expect(mockUpdateSet).toHaveBeenCalledWith({
      referenceImage: "characters/char-1-default.png",
      referenceImageSingle: null,
      referenceLayout: "four-view",
      referenceImageHistory: expect.stringContaining("characters/char-1-default.png"),
    });
  });

  it("passes reference images to generateImage when character has history", async () => {
    const charWithRefs = {
      ...MOCK_CHARACTER,
      referenceImage: "ref-old.png",
      referenceImageHistory: JSON.stringify(["ref1.png", "ref2.png"]),
    };
    mockSelectWhere.mockResolvedValueOnce([charWithRefs]);
    mockDetectFamily.mockReturnValue("hidream");
    mockResolvePrompt.mockResolvedValue("prompt");
    mockGenerateImage.mockResolvedValue("characters/char-1-v2.png");
    mockSelectWhere.mockResolvedValueOnce([]);
    mockLoadLegacy.mockResolvedValue(new Map());

    const res = await handleSingleCharacterImage("proj-1", "user-1", { characterId: "char-1" }, BASE_MODEL_CONFIG);

    expect(res.status).toBe(200);
    expect(mockGenerateImage).toHaveBeenCalledWith(
      "prompt",
      expect.objectContaining({
        referenceImages: ["ref-old.png", "ref1.png", "ref2.png"],
        workflowFamily: "hidream-o1-comfyui",
      })
    );
  });

  it("returns 500 when generateImage throws", async () => {
    mockSelectWhere.mockResolvedValueOnce([MOCK_CHARACTER]);
    mockDetectFamily.mockReturnValue("hidream");
    mockResolvePrompt.mockResolvedValue("prompt");
    mockExtractError.mockReturnValue("Generation failed: test error");
    mockGenerateImage.mockRejectedValue(new Error("test error"));

    const res = await handleSingleCharacterImage("proj-1", "user-1", { characterId: "char-1" }, BASE_MODEL_CONFIG);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ characterId: "char-1", status: "error", error: "Generation failed: test error" });
  });

  it("marks stale shots when character name appears in shot referenceImages", async () => {
    mockSelectWhere.mockResolvedValueOnce([MOCK_CHARACTER]);
    mockDetectFamily.mockReturnValue("hidream");
    mockResolvePrompt.mockResolvedValue("prompt");
    mockGenerateImage.mockResolvedValue("characters/char-1.png");

    mockSelectWhere.mockResolvedValueOnce([{ id: "shot-1" }, { id: "shot-2" }]);
    const refItem1 = { id: "ref-asset-1", characters: ["英雄"], status: "completed", fileUrl: "old.png" };
    const refItem2 = { id: "ref-asset-2", characters: ["英雄"], status: "completed", fileUrl: "old2.png" };
    const refItem3 = { id: "ref-asset-3", characters: ["Other"], status: "completed", fileUrl: "other.png" };
    mockLoadLegacy.mockResolvedValue(new Map([
      ["shot-1", { referenceImages: [refItem1, refItem2] }],
      ["shot-2", { referenceImages: [refItem3] }],
    ]));

    const res = await handleSingleCharacterImage("proj-1", "user-1", { characterId: "char-1" }, BASE_MODEL_CONFIG);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staleShots).toBe(1);
    expect(mockPatchAsset).toHaveBeenCalledTimes(2);
    expect(mockPatchAsset).toHaveBeenCalledWith("ref-asset-1", { status: "pending", fileUrl: null });
    expect(mockPatchAsset).toHaveBeenCalledWith("ref-asset-2", { status: "pending", fileUrl: null });
  });

  it("routes ernie-image-comfyui correctly to ERNIE workflow family", async () => {
    const ernieConfig = {
      ...BASE_MODEL_CONFIG,
      image: { ...BASE_MODEL_CONFIG.image, protocol: "comfyui", modelId: "ernie-image-comfyui" },
    };
    mockSelectWhere.mockResolvedValueOnce([MOCK_CHARACTER]);
    mockDetectFamily.mockReturnValue("ernie");
    mockResolvePrompt.mockResolvedValue("a brave warrior in red armor");
    mockGenerateImage.mockResolvedValue("characters/char-1-ernie.png");
    mockSelectWhere.mockResolvedValueOnce([]);
    mockLoadLegacy.mockResolvedValue(new Map());

    const res = await handleSingleCharacterImage("proj-1", "user-1", { characterId: "char-1" }, ernieConfig);

    expect(res.status).toBe(200);
    expect(mockDetectFamily).toHaveBeenCalledWith("comfyui", "ernie-image-comfyui");
    expect(mockResolvePrompt).toHaveBeenCalledWith(
      "character_image_hidream_o1",
      { userId: "user-1", projectId: "proj-1" },
      { characterName: "英雄", description: "一位勇敢的战士，穿着红色铠甲", referenceLayout: "four-view" }
    );
    expect(mockGenerateImage).toHaveBeenCalledWith(
      "a brave warrior in red armor",
      expect.objectContaining({
        workflowFamily: "ernie-image-comfyui",
      })
    );
  });
});
