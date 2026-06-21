import { describe, it, expect } from "vitest";
import { buildVideoPrompt, buildReferenceVideoPrompt } from "../video-generate";
import { buildRefVideoPromptRequest } from "../ref-video-prompt-generate";

describe("buildVideoPrompt", () => {
  it("builds a bare minimum prompt", () => {
    const result = buildVideoPrompt({
      videoScript: "A person walks down the street",
      cameraDirection: "static",
    });
    expect(result).toContain("A person walks down the street");
    expect(result).toContain("Camera Movement");
    expect(result).toContain("static");
  });

  it("caps duration at 10", () => {
    const result = buildVideoPrompt({
      videoScript: "Test scene",
      cameraDirection: "pan left",
      duration: 60,
    });
    expect(result).toContain("15s");
  });

  it("includes duration line when present", () => {
    const result = buildVideoPrompt({
      videoScript: "Test",
      cameraDirection: "static",
      duration: 8,
    });
    expect(result).toContain("8s");
  });

  it("includes character appearance hints", () => {
    const result = buildVideoPrompt({
      videoScript: "Hero walks in",
      cameraDirection: "track",
      characters: [
        { name: "Hero", visualHint: "red cape, blue suit" },
        { name: "Villain", visualHint: "dark armor" },
      ],
    });
    expect(result).toContain("Character Appearance");
    expect(result).toContain("Hero(red cape, blue suit)");
    expect(result).toContain("Villain(dark armor)");
  });

  it("includes visual style line", () => {
    const result = buildVideoPrompt({
      videoScript: "Scene",
      cameraDirection: "static",
      visualStyle: "写实电影摄影 / 胶片质感",
    });
    expect(result).toContain("Visual Style");
    expect(result).toContain("写实电影摄影 / 胶片质感");
  });

  it("includes Wan strategy line when family=wan", () => {
    const result = buildVideoPrompt({
      videoScript: "Test",
      cameraDirection: "static",
      family: "wan",
    });
    expect(result).toContain("keep the subject stable");
    expect(result).toContain("single continuous action line");
  });

  it("includes Seedance strategy line when family=seedance", () => {
    const result = buildVideoPrompt({
      videoScript: "Test",
      cameraDirection: "static",
      family: "seedance",
    });
    expect(result).toContain("camera motion");
    expect(result).toContain("environmental reactions");
  });

  it("omits strategy line when family=ltx", () => {
    const result = buildVideoPrompt({
      videoScript: "Test",
      cameraDirection: "static",
      family: "ltx",
    });
    expect(result).not.toContain("策略");
    expect(result).not.toContain("strategy");
  });

  it("includes on-screen dialogues", () => {
    const result = buildVideoPrompt({
      videoScript: "Dialogue scene",
      cameraDirection: "close-up",
      dialogues: [
        { characterName: "Hero", text: "Hello", offscreen: false },
      ],
    });
    expect(result).toContain("【对白口型】");
    expect(result).toContain('Hero: "Hello"');
  });

  it("includes off-screen dialogues", () => {
    const result = buildVideoPrompt({
      videoScript: "Voiceover scene",
      cameraDirection: "static",
      dialogues: [
        { characterName: "Narrator", text: "And so it begins", offscreen: true },
      ],
    });
    expect(result).toContain("【画外音】");
    expect(result).toContain('Narrator: "And so it begins"');
  });

  it("includes frame anchors for first segment", () => {
    const result = buildVideoPrompt({
      videoScript: "Scene",
      cameraDirection: "static",
      startFrameDesc: "Door opens",
      endFrameDesc: "Hero enters",
      segmentContext: { index: 0, total: 2 },
    });
    expect(result).toContain("[帧锚点]");
    expect(result).toContain("首帧：");
    expect(result).toContain("Door opens");
    expect(result).toContain("尾帧：");
    expect(result).toContain("Hero enters");
  });

  it("omits startFrameDesc for non-first segments", () => {
    const result = buildVideoPrompt({
      videoScript: "Mid scene",
      cameraDirection: "static",
      startFrameDesc: "Should not appear",
      endFrameDesc: "Final pose",
      segmentContext: { index: 1, total: 2 },
    });
    expect(result).not.toContain("Should not appear");
    expect(result).toContain("Final pose");
  });

  it("uses Chinese labels for Chinese script", () => {
    const result = buildVideoPrompt({
      videoScript: "一个英雄走在街道上",
      cameraDirection: "固定机位",
    });
    expect(result).toContain("镜头运动");
    expect(result).toContain("：固定机位。");
  });

  it("uses English labels for English script", () => {
    const result = buildVideoPrompt({
      videoScript: "A hero walks down the street",
      cameraDirection: "static",
    });
    expect(result).toContain("A hero walks down the street");
    expect(result).toContain("Camera Movement");
  });

  it("builds segment-aware interpolation header", () => {
    const first = buildVideoPrompt({
      videoScript: "Test",
      cameraDirection: "static",
      segmentContext: { index: 0, total: 3 },
    });
    expect(first).toContain("[Segment 1/3]");

    const mid = buildVideoPrompt({
      videoScript: "Test",
      cameraDirection: "static",
      segmentContext: { index: 1, total: 3 },
    });
    expect(mid).toContain("[Segment 2/3]");

    const last = buildVideoPrompt({
      videoScript: "Test",
      cameraDirection: "static",
      segmentContext: { index: 2, total: 3 },
    });
    expect(last).toContain("[Segment 3/3]");
  });
});

describe("buildReferenceVideoPrompt", () => {
  it("builds a prompt with videoScript and camera", () => {
    const result = buildReferenceVideoPrompt({
      videoScript: "A cat jumps",
      cameraDirection: "track right",
    });
    expect(result).toContain("A cat jumps");
    expect(result).toContain("Camera Movement");
    expect(result).toContain("track right");
  });

  it("includes visual style", () => {
    const result = buildReferenceVideoPrompt({
      videoScript: "Scene",
      cameraDirection: "static",
      visualStyle: "3D国漫渲染",
    });
    expect(result).toContain("Visual Style");
    expect(result).toContain("3D国漫渲染");
  });

  it("caps duration at 10", () => {
    const result = buildReferenceVideoPrompt({
      videoScript: "Test",
      cameraDirection: "static",
      duration: 45,
    });
    expect(result).toContain("15s");
  });

  it("includes Wan strategy", () => {
    const result = buildReferenceVideoPrompt({
      videoScript: "Test",
      cameraDirection: "static",
      family: "wan",
    });
    expect(result).toContain("keep the subject stable");
  });

  it("includes dialogues with labels", () => {
    const result = buildReferenceVideoPrompt({
      videoScript: "Talk",
      cameraDirection: "close-up",
      dialogues: [
        { characterName: "A", text: "Hi" },
      ],
    });
    expect(result).toContain("【对白口型】");
  });
});

describe("buildRefVideoPromptRequest", () => {
  it("builds basic prompt with characters and scenes", () => {
    const result = buildRefVideoPromptRequest({
      motionScript: "Hero walks through forest",
      cameraDirection: "track",
      duration: 8,
      characters: [{ name: "Hero", index: 1 }],
      sceneFrames: [{ label: "Forest", index: 2 }],
    });
    expect(result).toContain("剧本动作");
    expect(result).toContain("Hero walks through forest");
    expect(result).toContain("@图片1");
    expect(result).toContain("@图片2");
    expect(result).toContain("Forest");
  });

  it("caps duration at 10 for generic model", () => {
    const result = buildRefVideoPromptRequest({
      motionScript: "Test",
      cameraDirection: "static",
      duration: 30,
      characters: [],
      sceneFrames: [],
    });
    expect(result).toContain("15s");
  });

  it("caps duration at 10 for wan family", () => {
    const result = buildRefVideoPromptRequest({
      motionScript: "Test",
      cameraDirection: "static",
      duration: 30,
      characters: [],
      sceneFrames: [],
      family: "wan",
    });
    expect(result).toContain("15s");
  });

  it("caps duration at 10 for ltx family", () => {
    const result = buildRefVideoPromptRequest({
      motionScript: "Test",
      cameraDirection: "static",
      duration: 30,
      characters: [],
      sceneFrames: [],
      family: "ltx",
    });
    expect(result).toContain("15s");
  });

  it("includes visual style reference", () => {
    const result = buildRefVideoPromptRequest({
      motionScript: "Test",
      cameraDirection: "static",
      duration: 5,
      characters: [],
      sceneFrames: [],
      visualStyle: "赛博朋克 / 霓虹夜景",
    });
    expect(result).toContain("视觉风格参考");
    expect(result).toContain("赛博朋克 / 霓虹夜景");
  });

  it("includes dialogues inline", () => {
    const result = buildRefVideoPromptRequest({
      motionScript: "Scene",
      cameraDirection: "static",
      duration: 5,
      characters: [{ name: "Hero", index: 1 }],
      sceneFrames: [],
      dialogues: [
        { characterName: "Hero", text: "I am here" },
      ],
    });
    expect(result).toContain('Hero: "I am here"');
  });

  it("includes Wan-specific rule when family=wan", () => {
    const result = buildRefVideoPromptRequest({
      motionScript: "Test",
      cameraDirection: "static",
      duration: 5,
      characters: [],
      sceneFrames: [],
      family: "wan",
    });
    expect(result).toContain("Wan");
    expect(result).toContain("单主体稳定");
  });

  it("includes Seedance-specific rule when family=seedance", () => {
    const result = buildRefVideoPromptRequest({
      motionScript: "Test",
      cameraDirection: "static",
      duration: 5,
      characters: [],
      sceneFrames: [],
      family: "seedance",
    });
    expect(result).toContain("Seedance");
    expect(result).toContain("导演散文");
  });

  it("includes ComfyUI-specific rules when mode=comfyui", () => {
    const result = buildRefVideoPromptRequest({
      motionScript: "Test",
      cameraDirection: "static",
      duration: 8,
      characters: [],
      sceneFrames: [],
      mode: "comfyui",
    });
    expect(result).toContain("ComfyUI");
    expect(result).toContain("480:832");
  });

  it("adds no-character warning when character list is empty", () => {
    const result = buildRefVideoPromptRequest({
      motionScript: "Landscape pan",
      cameraDirection: "pan",
      duration: 5,
      characters: [],
      sceneFrames: [{ label: "Mountain", index: 1 }],
    });
    expect(result).toContain("没有角色登场");
  });

  it("adds multi-scene guidance when multiple scene frames", () => {
    const result = buildRefVideoPromptRequest({
      motionScript: "Journey",
      cameraDirection: "track",
      duration: 10,
      characters: [{ name: "Traveler", index: 3 }],
      sceneFrames: [
        { label: "Village", index: 1 },
        { label: "Forest", index: 2 },
      ],
    });
    expect(result).toContain("2 张场景参考图");
  });
});
