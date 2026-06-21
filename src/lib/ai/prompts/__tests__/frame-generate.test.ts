import { describe, expect, it } from "vitest";
import { frameGenerateFirstDef, frameGenerateLastDef, SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT } from "../registry-frame";

describe("frame generation prompt definitions", () => {
  it("prevents first frames from copying reference sheet layouts", () => {
    const prompt = frameGenerateFirstDef.buildFullPrompt({}, {
      sceneDescription: "A palace hall",
      startFrameDesc: "Hero stands near the throne",
      characterDescriptions: "Hero: blue robe",
    });

    expect(prompt).toContain("单帧画面契约");
    expect(prompt).toContain("只有一个取景、一个透视、一套连续的环境光");
    expect(prompt).toContain("参考图只用于识别角色身份");
    expect(prompt).toContain("输出必须重新构图为电影镜头");
    expect(SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT).toContain("contact sheet");
    expect(SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT).toContain("collage");
    expect(SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT).toContain("thumbnail grid");
    expect(SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT).toContain("character reference sheet");
    expect(SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT).toContain("duplicate characters");
    expect(SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT).toContain("cloned character");
    expect(SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT).toContain("twin characters");
    expect(prompt).not.toContain("联系表");
    expect(prompt).not.toContain("拼贴图");
    expect(prompt).not.toContain("缩略图行");
  });

  it("omits character reference-sheet language when no character image references are passed", () => {
    const prompt = frameGenerateFirstDef.buildFullPrompt({}, {
      sceneDescription: "A forest race field",
      startFrameDesc: "Rabbit and turtle stand on the starting line",
      characterDescriptions: "Rabbit: white fur, red vest. Turtle: green shell, straw hat.",
      hasCharacterImageReferences: false,
    });

    expect(prompt).toContain("角色外观必须严格遵守文字描述");
    expect(prompt).not.toContain("每张附带的参考图是一张角色设定图");
    expect(prompt).not.toContain("展示4个视角");
    expect(prompt).not.toContain("名字印在每张设定图底部");
    expect(prompt).not.toContain("输出的画风必须与角色设定图一致");
  });

  it("prevents last frames from copying character reference layouts", () => {
    const prompt = frameGenerateLastDef.buildFullPrompt({}, {
      sceneDescription: "A palace hall",
      endFrameDesc: "Hero reaches the door",
      characterDescriptions: "Hero: blue robe",
    });

    expect(prompt).toContain("单帧画面契约");
    expect(prompt).toContain("所有角色必须自然处在同一个场景空间里");
    expect(prompt).toContain("参考图只提供身份、外貌、服装、配饰和画风信息");
    expect(prompt).toContain("输出必须重新构图为同一个电影场景镜头");
    expect(SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT).toContain("UI interface");
    expect(SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT).toContain("model sheet");
    expect(prompt).not.toContain("联系表版式");
  });

  it("omits extra character reference-sheet instructions from last frames when no character refs are passed", () => {
    const prompt = frameGenerateLastDef.buildFullPrompt({}, {
      sceneDescription: "A forest race field",
      endFrameDesc: "Rabbit and turtle face the track",
      characterDescriptions: "Rabbit: white fur, red vest. Turtle: green shell, straw hat.",
      hasCharacterImageReferences: false,
    });

    expect(prompt).toContain("角色身份、外貌、服装、配饰和画风以文字角色描述为准");
    expect(prompt).not.toContain("其余附带图像是角色设定图");
    expect(prompt).not.toContain("每张4个视角");
    expect(prompt).not.toContain("名字印在底部");
  });

  it("enforces the multi-character count contract on first frames", () => {
    const prompt = frameGenerateFirstDef.buildFullPrompt({}, {
      sceneDescription: "A forest race field",
      startFrameDesc: "Rabbit and turtle stand on the starting line",
      characterDescriptions: "Rabbit: white fur, red vest. Turtle: green shell, straw hat.",
    });

    expect(prompt).toContain("多角色精确渲染");
    expect(prompt).toContain("恰好出现 N 位角色");
    expect(prompt).toContain("严禁复制、克隆、变形同一位角色");
    expect(prompt).toContain("N 个角色描述 = N 个角色实体");
  });

  it("enforces the multi-character count contract on last frames", () => {
    const prompt = frameGenerateLastDef.buildFullPrompt({}, {
      sceneDescription: "A forest race field",
      endFrameDesc: "Rabbit and turtle face the track",
      characterDescriptions: "Rabbit: white fur, red vest. Turtle: green shell, straw hat.",
    });

    expect(prompt).toContain("多角色精确渲染");
    expect(prompt).toContain("恰好出现 N 位角色");
    expect(prompt).toContain("物种锁定");
  });
});

