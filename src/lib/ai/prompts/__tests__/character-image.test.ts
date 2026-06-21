import { describe, it, expect } from "vitest";
import { characterImageHiDreamO1Def, characterImageIdeogram4Def, characterImageSimpleDef } from "../registry-character";

describe("characterImageHiDreamO1Def", () => {
  it("builds prompt with character name and description", () => {
    const result = characterImageHiDreamO1Def.buildFullPrompt({}, {
      characterName: "Hero",
      description: "Tall muscular warrior with a broadsword",
    });
    expect(result).toContain("Hero");
    expect(result).toContain("Tall muscular warrior with a broadsword");
    expect(result).toContain("four-view");
    expect(result).toContain("turnaround");
    expect(result).toContain("2x2 grid");
  });

  it("handles empty params gracefully", () => {
    const result = characterImageHiDreamO1Def.buildFullPrompt({}, {});
    expect(result).not.toContain("undefined");
    expect(result).toContain("four-view");
  });

  it("includes pure white background instruction", () => {
    const result = characterImageHiDreamO1Def.buildFullPrompt({}, {
      characterName: "Test",
      description: "Test description",
    });
    expect(result).toContain("pure white background");
  });

  it("describes all four views in default layout", () => {
    const result = characterImageHiDreamO1Def.buildFullPrompt({}, {
      characterName: "A",
      description: "B",
    });
    expect(result).toContain("Front view");
    expect(result).toContain("Back view");
    expect(result).toContain("Side profile");
    expect(result).toContain("Three-quarter view");
  });

  it("emits a single-portrait prompt when referenceLayout is single", () => {
    const result = characterImageHiDreamO1Def.buildFullPrompt({}, {
      characterName: "Solo",
      description: "Lone wanderer",
      referenceLayout: "single",
    });
    expect(result).toContain("Single");
    expect(result).toContain("single-portrait");
    expect(result).not.toContain("2x2 grid");
    expect(result).not.toContain("Three-quarter view");
  });

  it("emits a three-view horizontal strip when referenceLayout is three-view", () => {
    const result = characterImageHiDreamO1Def.buildFullPrompt({}, {
      characterName: "Tri",
      description: "Triple threat",
      referenceLayout: "three-view",
    });
    expect(result).toContain("three-view");
    expect(result).toContain("horizontal strip");
    expect(result).toContain("Front view");
    expect(result).toContain("Side profile");
    expect(result).toContain("Back view");
    expect(result).not.toContain("Three-quarter view");
  });
});

describe("characterImageIdeogram4Def", () => {
  it("returns JSON string with character info", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "Hero",
      description: "A tall warrior",
    });
    const parsed = JSON.parse(result);
    expect(parsed.high_level_description).toContain("Hero");
    expect(parsed.high_level_description).toContain("turnaround sheet");
    expect(parsed.style_description.aesthetics).toContain("Disney-Pixar");
  });

  it("strips Chinese characters from description", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "英雄",
      description: "一个高大的战士，身穿铠甲",
    });
    const parsed = JSON.parse(result);
    expect(parsed.high_level_description).not.toContain("一个高大的战士");
    expect(parsed.compositional_deconstruction.elements[0].desc).not.toContain("一个高大的战士");
  });

  it("keeps English description when no Chinese", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "Hero",
      description: "Tall warrior in armor",
    });
    const parsed = JSON.parse(result);
    expect(parsed.high_level_description).toContain("Tall warrior in armor");
  });

  it("has exactly 4 elements in compositional_deconstruction for four-view", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "Hero",
      description: "Warrior",
    });
    const parsed = JSON.parse(result);
    expect(parsed.compositional_deconstruction.elements).toHaveLength(4);
  });

  it("uses 1000x1000 canvas pixel bbox", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "Hero",
      description: "Warrior",
    });
    const parsed = JSON.parse(result);
    const elements = parsed.compositional_deconstruction.elements;
    for (const el of elements) {
      expect(el.bbox[0]).toBeGreaterThanOrEqual(0);
      expect(el.bbox[1]).toBeGreaterThanOrEqual(0);
      expect(el.bbox[2]).toBeLessThanOrEqual(1000);
      expect(el.bbox[3]).toBeLessThanOrEqual(1000);
    }
  });

  it("emits a single-portrait layout with one full-bleed element when referenceLayout is single", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "Solo",
      description: "Lone wanderer",
      referenceLayout: "single",
    });
    const parsed = JSON.parse(result);
    expect(parsed.compositional_deconstruction.elements).toHaveLength(1);
    expect(parsed.compositional_deconstruction.elements[0].bbox).toEqual([10, 10, 990, 990]);
    expect(parsed.high_level_description).toContain("character portrait");
  });

  it("emits a three-view strip layout when referenceLayout is three-view", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "Tri",
      description: "Triple threat",
      referenceLayout: "three-view",
    });
    const parsed = JSON.parse(result);
    expect(parsed.compositional_deconstruction.elements).toHaveLength(3);
    expect(parsed.high_level_description).toContain("three-view");
  });
});

describe("characterImageSimpleDef", () => {
  it("builds a Chinese prompt that reflects the default four-view layout", () => {
    const result = characterImageSimpleDef.buildFullPrompt({}, {
      characterName: "Mario",
      description: "Plumber with red hat",
    });
    expect(result).toContain("角色四视图设定图");
    expect(result).toContain("2x2 网格");
    expect(result).toContain("Mario");
    expect(result).toContain("Plumber with red hat");
  });

  it("emits a single-portrait prompt when referenceLayout is single", () => {
    const result = characterImageSimpleDef.buildFullPrompt({}, {
      characterName: "Mario",
      description: "Plumber with red hat",
      referenceLayout: "single",
    });
    expect(result).toContain("角色全身立绘");
    expect(result).not.toContain("四视图设定图");
  });

  it("emits a three-view strip prompt when referenceLayout is three-view", () => {
    const result = characterImageSimpleDef.buildFullPrompt({}, {
      characterName: "Mario",
      description: "Plumber with red hat",
      referenceLayout: "three-view",
    });
    expect(result).toContain("角色三视图设定图");
    expect(result).toContain("水平排版");
  });
});
