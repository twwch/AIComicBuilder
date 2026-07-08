import type { NormalizedStoryboardShot, StoryboardProductionBibleInput, StoryboardStyle } from "./types";
import { compactText, readString, toRecord } from "./prompt-sanitizer";

function bibleMetadataValue(bible: StoryboardProductionBibleInput | null | undefined, keys: string[]) {
  return readString(toRecord(bible?.metadata), keys);
}

function detectEra(bible?: StoryboardProductionBibleInput | null) {
  const evidence = [
    bibleMetadataValue(bible, ["era", "period", "time", "year"]),
    bible?.eraConstraints,
    bible?.worldSetting,
    bible?.locationRules,
    bible?.sceneRules,
    bible?.visualStyle,
  ].filter(Boolean).join(" ");
  const year = evidence.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/)?.[1];
  const decade = evidence.match(/\b(18|19|20)(\d)0s\b/i);
  const chineseDecade = evidence.match(/([一二三四五六七八九零〇\d]{2})年代|(\d{2})年代/);
  const china = /中国|Chinese|China/i.test(evidence) ? "China" : "";
  if (year) return [year, china].filter(Boolean).join(" ");
  if (decade) return [`${decade[1]}${decade[2]}0s`, china].filter(Boolean).join(" ");
  if (chineseDecade && /80|八十/.test(chineseDecade[0])) return ["1980s", china || "China"].join(" ");
  if (/八十年代|80年代|1980年代|1980s/i.test(evidence)) return ["1980s", china || "China"].join(" ");
  const clean = compactText(evidence, 180);
  if (clean && !/production-bible|asset_bound|constraint_default|placeholder/i.test(clean)) return clean;
  return "realistic short-drama period setting";
}

function detectVisualStyle(bible?: StoryboardProductionBibleInput | null) {
  return compactText(
    bibleMetadataValue(bible, ["genre", "visualStyle", "style"]) ||
    bible?.visualStyle ||
    "realistic Chinese short-drama storyboard",
    180,
  );
}

export function resolveLightingStyle(input: {
  shot: NormalizedStoryboardShot;
  sceneText?: string;
  frameDescription: string;
  productionBible?: StoryboardProductionBibleInput | null;
}): StoryboardStyle {
  const evidence = [
    input.frameDescription,
    input.shot.source_text,
    input.shot.composition,
    input.sceneText,
    input.productionBible?.locationRules,
    input.productionBible?.sceneRules,
  ].filter(Boolean).join(" ");

  const isNight = /夜|晚上|夜晚|深夜|黑夜|night|midnight|dark/i.test(evidence);
  const isDay = /白天|日间|清晨|上午|下午|daylight|morning|afternoon/i.test(evidence);
  const isRain = /雨|暴雨|大雨|雨水|storm|rain|rainy|downpour/i.test(evidence);
  const isSnow = /雪|snow|snowy|blizzard/i.test(evidence);
  const hasHeadlights = /车灯|远光灯|前照灯|headlight|headlamp/i.test(evidence);
  const isIndoor = /室内|房间|客厅|卧室|医院|办公室|indoor|interior|room|hallway/i.test(evidence);
  const hasPractical = /灯泡|台灯|烛光|霓虹|路灯|lamp|candle|neon|streetlight/i.test(evidence);
  const hasFire = /火|火光|燃烧|flame|firelight|burning/i.test(evidence);

  const lighting: string[] = [];
  const atmosphere: string[] = [];

  if (isNight) {
    lighting.push("night lighting", "low-key lighting");
    atmosphere.push("dark atmosphere");
  } else if (isIndoor && isDay) {
    lighting.push("soft indoor daylight");
  } else if (isIndoor) {
    lighting.push("practical indoor lighting");
  } else if (isDay) {
    lighting.push("daylight-balanced realistic lighting");
  }

  if (isRain) {
    lighting.push("wet surface reflections");
    atmosphere.push("rain mist", "storm atmosphere");
  }
  if (isSnow) {
    atmosphere.push("cold air haze", "snow-muted atmosphere");
  }
  if (hasHeadlights) {
    lighting.push("headlight-dominated lighting", "strong backlight");
    atmosphere.push("wet-road reflections when surfaces are wet");
  }
  if (hasPractical) lighting.push("visible practical light sources");
  if (hasFire) {
    lighting.push("firelight contrast");
    atmosphere.push("smoke or heat haze only if already implied");
  }

  if (lighting.length === 0) {
    lighting.push("scene-motivated realistic lighting");
  }
  if (atmosphere.length === 0) {
    atmosphere.push(isIndoor ? "controlled interior atmosphere" : "grounded location atmosphere");
  }

  return {
    visual_style: detectVisualStyle(input.productionBible),
    lighting: Array.from(new Set(lighting)).join(", "),
    atmosphere: Array.from(new Set(atmosphere)).join(", "),
    era: detectEra(input.productionBible),
  };
}
