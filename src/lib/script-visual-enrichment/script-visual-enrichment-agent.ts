import { generateText } from "ai";
import {
  createLanguageModel,
  extractJSON,
  resolveLanguageModelConfigs,
  supportsOpenAIJsonMode,
} from "@/lib/ai/ai-sdk";
import { callAgent, validateAgentOutput } from "@/lib/ai/agent-caller";
import { cleanScriptText, structureScriptText } from "@/lib/script-structure";
import { validateEnrichmentPatches } from "./enrichment-validator";
import type {
  AddedVisualDetails,
  EnrichmentAssetCandidate,
  EnrichmentContext,
  EnrichmentImportance,
  EnrichmentPatch,
  EnrichmentSourceType,
  NormalizedAsset,
  NormalizedBeat,
  NormalizedProductionBible,
  NormalizedScene,
  ScriptVisualEnrichmentPreviewInput,
  ScriptVisualEnrichmentPreviewResult,
} from "./types";

const MAX_LOCAL_BEATS = 120;
const AI_ENRICHMENT_TIMEOUT_MS = 60_000;
const MAX_PROMPT_SCENES = 10;
const MAX_PROMPT_ASSETS = 60;
const MIN_AI_OUTPUT_TOKENS = 3200;
const AI_OUTPUT_TOKENS_PER_BEAT = 900;
const MAX_AI_OUTPUT_TOKENS = 8000;

const SYSTEM_PROMPT = `You are the Script Visual Enrichment Agent in a short-drama production pipeline.

Position:
Raw Script -> Basic Parser (Episode / Scene / Beat) -> Script Visual Enrichment Agent -> Enrichment Validator -> Human Review -> Asset Extraction -> Shot Generator -> Storyboard.

Your job:
Before asset extraction, enrich coarse script beats into shootable visual descriptions.

Allowed:
- room and scene details
- character blocking, standing/sitting posture
- action details
- visible expression and emotion
- ordinary life props
- light, weather, atmosphere
- era/location/style details from the production bible
- visual details that help asset extraction and storyboard generation

Forbidden:
- adding key plot
- adding key characters
- changing relationships
- changing outcomes
- adding key props as plot turns
- adding core dialogue information
- changing source facts
- writing final image/video prompts
- writing storyboard or shot list
- generating video

Principle:
Only fill "how to shoot it"; never change "what happened".

Output strict JSON only:
{
  "patches": [
    {
      "scene_id": "",
      "beat_id": "",
      "original_text": "",
      "enriched_text": "",
      "added_visual_details": {
        "location_detail": "",
        "blocking": "",
        "props": [],
        "set_dressing": [],
        "wardrobe_detail": "",
        "action_detail": "",
        "emotion": "",
        "lighting": "",
        "atmosphere": ""
      },
      "asset_candidates": [
        {
          "name": "",
          "type": "character | scene | prop | set_dressing | prompt_detail",
          "importance": "core | important | temporary | background | prompt_only"
        }
      ],
      "source_type": "explicit | inferred_from_context | default_from_bible",
      "confidence": 0,
      "needs_human_review": true,
      "reason": ""
    }
  ]
}

Asset importance rules:
- core: protagonist, core scene, truly key prop
- important: important supporting character, important scene, plot-moving prop
- temporary: one-off visible person/object
- background: set dressing
- prompt_only: details that should enter prompts but not the asset library

Do not make ordinary meals, bowls, chopsticks, cups, lamps, curtains, dust, sunlight, or mood into core assets.`;

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unique(values: Array<string | undefined | null>) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

function pad(value: number, length = 3) {
  return String(value).padStart(length, "0");
}

function compact(value: unknown, maxLength = 220) {
  const text = clean(value);
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    }),
    timeout,
  ]);
}

function clampConfidence(value: unknown, fallback = 0.72) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeImportance(value: unknown, fallback: EnrichmentImportance = "temporary"): EnrichmentImportance {
  const text = clean(value).toLowerCase();
  if (text === "core" || text === "important" || text === "temporary" || text === "background" || text === "prompt_only") {
    return text;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric >= 80) return "core";
    if (numeric >= 50) return "important";
    if (numeric >= 20) return "temporary";
    return "background";
  }
  return fallback;
}

function normalizeAssetType(value: unknown): NormalizedAsset["type"] | "" {
  const text = clean(value).toLowerCase();
  if (text === "character" || text === "characters") return "character";
  if (text === "scene" || text === "scenes" || text === "environment" || text === "environments") return "scene";
  if (text === "prop" || text === "props" || text === "item" || text === "items") return "prop";
  return "";
}

function normalizeAliases(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map((item) => clean(item)));
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return normalizeAliases(parsed);
  } catch {
    // Fall through to delimiter split.
  }
  return unique(value.split(/[,，、/\n]/g));
}

function normalizeAsset(value: unknown): NormalizedAsset | null {
  const record = toRecord(value);
  const type = normalizeAssetType(record.type || record.assetType || record.category);
  const name = readString(record, ["name", "title", "label"]);
  if (!type || !name) return null;
  return {
    id: readString(record, ["id", "asset_id", "assetId"]) || `${type}_${name}`,
    type,
    name,
    aliases: normalizeAliases(record.aliases),
    importance: normalizeImportance(record.importance, type === "character" ? "important" : "temporary"),
    description: readString(record, ["description", "visualConstraints", "visual_constraints", "visualHint", "prompt"]),
  };
}

function normalizeScene(value: unknown, index: number): NormalizedScene | null {
  const record = toRecord(value);
  const id = readString(record, ["id", "scene_id", "sceneId"]) || `scene_${pad(index + 1, 4)}`;
  const title = readString(record, ["title", "sceneTitle", "setting", "location_name", "locationName", "name"]);
  const description = readString(record, ["description", "summary", "scene_summary", "sceneSummary"]);
  const text = readString(record, ["text", "script", "source_text", "sourceText", "content"]) || description;
  if (!title && !text) return null;
  return {
    id,
    episode_id: readString(record, ["episode_id", "episodeId"]) || "",
    title: title || `Scene ${index + 1}`,
    text,
    location: readString(record, ["location", "location_name", "locationName", "setting"]) || title,
    description,
  };
}

function normalizeProductionBible(value: unknown): NormalizedProductionBible {
  const record = toRecord(value);
  const bible = {
    title: readString(record, ["title"]),
    worldSetting: readString(record, ["worldSetting", "world_setting"]),
    visualStyle: readString(record, ["visualStyle", "visual_style"]),
    eraConstraints: readString(record, ["eraConstraints", "era_constraints"]),
    locationRules: readString(record, ["locationRules", "location_rules"]),
    characterRules: readString(record, ["characterRules", "character_rules"]),
    sceneRules: readString(record, ["sceneRules", "scene_rules"]),
    propRules: readString(record, ["propRules", "prop_rules"]),
    complianceRules: readString(record, ["complianceRules", "compliance_rules"]),
  };
  return {
    ...bible,
    rawText: Object.values(bible).filter(Boolean).join("\n"),
  };
}

function readBeatText(record: Record<string, unknown>) {
  const direct = readString(record, [
    "original_text",
    "originalText",
    "text",
    "source_text",
    "sourceText",
    "content",
    "summary",
    "description",
  ]);
  if (direct) return direct;
  return unique([
    readString(record, ["action", "motionScript"]),
    readString(record, ["dialogue", "dialogue_text", "dialogueText"]),
  ]).join(" ");
}

function normalizeBeat(value: unknown, index: number, scenes: NormalizedScene[]): NormalizedBeat | null {
  const record = toRecord(value);
  const sceneId = readString(record, ["scene_id", "sceneId"]) || scenes[0]?.id || "scene_0001";
  const scene = scenes.find((item) => item.id === sceneId) || scenes[0];
  const text = readBeatText(record);
  if (!text) return null;
  return {
    id: readString(record, ["beat_id", "beatId", "id"]) || `${sceneId}_beat_${pad(index + 1)}`,
    scene_id: sceneId,
    episode_id: readString(record, ["episode_id", "episodeId"]) || scene?.episode_id || "",
    text,
    scene_title: scene?.title || "",
    scene_text: scene?.text || "",
  };
}

function splitBeatText(text: string, maxSegments = 12) {
  const compacted = cleanScriptText(text);
  if (!compacted) return [];
  const paragraphs = compacted
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4);
  const base = paragraphs.length > 1
    ? paragraphs
    : [...compacted.matchAll(/[^。！？!?；;\n]+[。！？!?；;]?/g)]
        .map((match) => match[0].trim())
        .filter((item) => item.length >= 4);
  return (base.length ? base : [compacted]).slice(0, maxSegments);
}

function deriveScenesFromScript(script: string): NormalizedScene[] {
  const text = cleanScriptText(script);
  if (!text) return [];
  const structured = structureScriptText(text, {
    minSize: 900,
    maxSize: 1800,
    overlap: 0,
  });
  return structured.scenes.map((scene, index) => ({
    id: scene.id || `scene_${pad(index + 1, 4)}`,
    episode_id: `episode_${pad(scene.episodeIndex || 1)}`,
    title: scene.title || `Scene ${index + 1}`,
    text: scene.text,
    location: scene.title || "",
    description: scene.text.slice(0, 240),
  }));
}

function deriveBeatsFromScenes(scenes: NormalizedScene[], maxBeats: number) {
  const beats: NormalizedBeat[] = [];
  for (const scene of scenes) {
    const pieces = splitBeatText(scene.text || scene.description, 18);
    for (const piece of pieces) {
      if (beats.length >= maxBeats) return beats;
      beats.push({
        id: `${scene.id}_beat_${pad(beats.length + 1)}`,
        scene_id: scene.id,
        episode_id: scene.episode_id,
        text: piece,
        scene_title: scene.title,
        scene_text: scene.text,
      });
    }
  }
  return beats;
}

export function normalizeEnrichmentInput(input: ScriptVisualEnrichmentPreviewInput): EnrichmentContext {
  const script = cleanScriptText(input.script || "");
  const explicitScenes = readArray(input.scenes).map(normalizeScene).filter((item): item is NormalizedScene => Boolean(item));
  const scenes = explicitScenes.length ? explicitScenes : deriveScenesFromScript(script);
  const assets = readArray(input.assets).map(normalizeAsset).filter((item): item is NormalizedAsset => Boolean(item));
  const maxBeats = Math.max(1, Math.min(input.maxBeats ?? MAX_LOCAL_BEATS, MAX_LOCAL_BEATS));
  const explicitBeats = readArray(input.beats)
    .map((beat, index) => normalizeBeat(beat, index, scenes))
    .filter((item): item is NormalizedBeat => Boolean(item));
  const beats = (explicitBeats.length ? explicitBeats : deriveBeatsFromScenes(scenes, maxBeats)).slice(0, maxBeats);
  const productionBible = normalizeProductionBible(input.productionBible);
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));

  return {
    script,
    episodes: readArray(input.episodes),
    scenes,
    beats,
    assets,
    productionBible,
    sceneById,
    knownCharacters: new Set(assets.filter((asset) => asset.type === "character").flatMap((asset) => [asset.name, ...asset.aliases])),
    knownScenes: new Set(assets.filter((asset) => asset.type === "scene").flatMap((asset) => [asset.name, ...asset.aliases])),
    knownProps: new Set(assets.filter((asset) => asset.type === "prop").flatMap((asset) => [asset.name, ...asset.aliases])),
  };
}

function textHasHistoricBible(bible: NormalizedProductionBible) {
  const text = bible.rawText;
  return /七十年代|八十年代|九十年代|70年代|80年代|90年代|民国|旧|年代感|乡镇|农村/.test(text) && !/现代|当代/.test(text);
}

function inferCharacterNames(text: string, context: EnrichmentContext) {
  const known = [...context.knownCharacters].filter((name) => text.includes(name));
  const speakers = [...text.matchAll(/^([\u4e00-\u9fa5A-Za-z0-9_]{2,16})\s*[:：]/gm)].map((match) => match[1]);
  const actionNames = [...text.matchAll(/([\u4e00-\u9fa5]{2,5})(?=在|坐|站|走|看|说|问|低头|抬头|吃|拿|推|躺|哭|笑|沉默|夹|端)/g)]
    .map((match) => match[1])
    .filter((name) => !/众人|男人|女人|孩子|老人|医生|护士|老师|同学|服务员/.test(name));
  return unique([...known, ...speakers, ...actionNames]).slice(0, 4);
}

function inferSceneName(beat: NormalizedBeat, context: EnrichmentContext) {
  const scene = context.sceneById.get(beat.scene_id);
  const text = `${beat.text} ${scene?.title || ""} ${scene?.location || ""}`;
  const known = [...context.knownScenes].find((name) => text.includes(name));
  if (known) return known;
  const locationMatch = text.match(/(?:在|来到|走进|坐在)([\u4e00-\u9fa5A-Za-z0-9]{2,18}(?:客厅|卧室|厨房|院子|门口|医院|病房|办公室|会议室|学校|教室|餐厅|饭桌|车内|街道|走廊))/);
  if (locationMatch?.[1]) return locationMatch[1];
  if (scene?.location && scene.location.length <= 24 && !/^Scene\s+\d+/i.test(scene.location)) return scene.location;
  if (scene?.title && scene.title.length <= 24 && !/^Scene\s+\d+/i.test(scene.title)) return scene.title;
  return "";
}

function inferLocationDetail(beat: NormalizedBeat, context: EnrichmentContext) {
  const sceneName = inferSceneName(beat, context);
  if (/吃饭|用餐|吃粥|饭桌|餐桌/.test(beat.text)) {
    if (sceneName) return `${sceneName}里靠近饭桌的位置被作为主要活动区域。`;
    return "室内饭桌边被作为主要活动区域。";
  }
  if (sceneName) return `画面发生在${sceneName}，空间信息需要清楚交代。`;
  return "画面以原文所在空间为准，补足可见的入口、墙面和人物活动区域。";
}

function inferBlocking(text: string, characterNames: string[]) {
  const subject = characterNames[0] || "人物";
  if (/吃饭|用餐|吃粥|饭桌|餐桌/.test(text)) return `${subject}坐在饭桌边，身体略向桌面前倾。`;
  if (/坐/.test(text)) return `${subject}保持坐姿，身体朝向当前交流或动作对象。`;
  if (/站/.test(text)) return `${subject}站在画面主要行动线上，重心落在前脚。`;
  if (/走|跑|冲|离开|进门|出门/.test(text)) return `${subject}沿场景动线移动，动作方向在画面中保持明确。`;
  if (/躺|睡/.test(text)) return `${subject}处在低位姿态，周围留出可读的空间关系。`;
  if (/看|盯|望/.test(text)) return `${subject}的视线落在原文指向的人或物上。`;
  return characterNames.length ? `${subject}位于画面主体位置，站位服务于原文动作。` : "";
}

function inferProps(text: string, context: EnrichmentContext) {
  const props = new Set<string>();
  const setDressing = new Set<string>();
  const bibleHistoric = textHasHistoricBible(context.productionBible);

  if (/吃饭|用餐|吃粥|饭桌|餐桌/.test(text)) {
    setDressing.add(bibleHistoric ? "旧木饭桌" : "饭桌");
    props.add(bibleHistoric ? "搪瓷碗" : "碗");
    props.add(bibleHistoric ? "竹筷" : "筷子");
    props.add("简单饭菜");
  }
  if (/喝水|倒水|茶|杯/.test(text)) props.add("水杯");
  if (/写|签字|记/.test(text)) props.add("纸笔");
  if (/医院|病房|看病|病历/.test(text)) props.add("病历夹");
  if (/门口|进门|出门|开门/.test(text)) setDressing.add("门框");
  if (/客厅/.test(text)) {
    setDressing.add("沙发");
    setDressing.add("茶几");
  }
  if (/厨房/.test(text)) setDressing.add("灶台");

  for (const prop of context.knownProps) {
    if (text.includes(prop)) props.add(prop);
  }

  return {
    props: [...props].slice(0, 8),
    setDressing: [...setDressing].slice(0, 8),
  };
}

function inferActionDetail(text: string, characterNames: string[]) {
  const subject = characterNames[0] || "人物";
  if (/吃饭|用餐|吃粥/.test(text)) return `${subject}低头吃饭，手部动作放慢，餐具停留在桌面附近。`;
  if (/哭|流泪/.test(text)) return `${subject}眼眶发红，动作收紧，但不额外改变事件结果。`;
  if (/笑/.test(text)) return `${subject}嘴角和眼神出现可见笑意，动作保持原文节奏。`;
  if (/沉默|不说话/.test(text)) return `${subject}短暂停住动作，用视线和姿态表现沉默。`;
  if (/拿|递|放|推/.test(text)) return `${subject}的手部动作清晰可见，道具位置与动作方向一致。`;
  if (/看|盯|望/.test(text)) return `${subject}先停住身体，再把视线落到原文对象上。`;
  return "";
}

function inferEmotion(text: string) {
  if (/疲惫|累|憔悴/.test(text)) return "神情疲惫，动作带有迟缓感。";
  if (/紧张|害怕|慌/.test(text)) return "表情紧绷，呼吸和肩颈状态显得拘谨。";
  if (/愤怒|生气|怒/.test(text)) return "眉眼压低，身体姿态带有克制的对抗感。";
  if (/难过|委屈|哭|流泪/.test(text)) return "情绪低落，眼神下沉。";
  if (/高兴|开心|笑/.test(text)) return "表情放松，眼神有亮度。";
  return "表情保持原文情绪，不额外强化剧情判断。";
}

function inferLighting(text: string, context: EnrichmentContext) {
  const bible = context.productionBible.rawText;
  if (/夜|晚上|深夜|夜色/.test(text)) return "夜间光线以室内灯光或环境弱光为主。";
  if (/雨|下雨/.test(text)) return "光线偏冷，环境带有雨天反光。";
  if (/早晨|清晨/.test(text)) return "光线偏柔和，带有清晨自然光。";
  if (/傍晚|黄昏/.test(text)) return "光线偏低，带有傍晚暖色侧光。";
  if (/昏暗|阴暗/.test(bible)) return "光线遵循 production_bible 的低照度氛围。";
  return "光线以自然光或日常室内灯光为主。";
}

function inferAtmosphere(text: string, context: EnrichmentContext) {
  const bible = context.productionBible.rawText;
  if (/压抑|沉重|紧张/.test(text + bible)) return "氛围压抑克制，画面留出安静的情绪空间。";
  if (/温馨|轻松/.test(text + bible)) return "氛围生活化、柔和。";
  if (/雨|夜|疲惫|沉默/.test(text)) return "氛围安静，带有轻微疲惫感。";
  return "氛围保持现实生活质感，避免夸张戏剧化。";
}

function inferWardrobe(text: string, context: EnrichmentContext) {
  const bible = context.productionBible.rawText;
  if (/校服|制服|军装|婚纱|西装|病号服/.test(text)) return "服装沿用原文明确设定，不新增身份信息。";
  if (textHasHistoricBible(context.productionBible)) return "服装保持 production_bible 的年代质感，避免现代潮牌和电子配饰。";
  if (/现代|都市|职场/.test(bible)) return "服装保持日常现代现实质感，不新增品牌化细节。";
  return "";
}

function makeAssetCandidates(params: {
  beat: NormalizedBeat;
  context: EnrichmentContext;
  characterNames: string[];
  sceneName: string;
  props: string[];
  setDressing: string[];
  sourceType: EnrichmentSourceType;
}) {
  const candidates: EnrichmentAssetCandidate[] = [];
  const push = (candidate: EnrichmentAssetCandidate) => {
    if (!candidate.name) return;
    const key = `${candidate.type}:${candidate.name}`.toLowerCase();
    if (candidates.some((item) => `${item.type}:${item.name}`.toLowerCase() === key)) return;
    candidates.push(candidate);
  };

  for (const name of params.characterNames) {
    const existing = params.context.assets.find((asset) => asset.type === "character" && [asset.name, ...asset.aliases].includes(name));
    push({
      name,
      type: "character",
      importance: existing?.importance === "core" ? "core" : "important",
    });
  }

  if (params.sceneName) {
    const existing = params.context.assets.find((asset) => asset.type === "scene" && [asset.name, ...asset.aliases].includes(params.sceneName));
    push({
      name: params.sceneName,
      type: "scene",
      importance: existing?.importance === "core" ? "core" : params.sourceType === "explicit" ? "important" : "background",
    });
  }

  for (const name of params.props) {
    const existing = params.context.assets.find((asset) => asset.type === "prop" && [asset.name, ...asset.aliases].includes(name));
    const ordinary = /碗|筷|饭菜|水杯|纸笔/.test(name);
    push({
      name,
      type: "prop",
      importance: existing?.importance || (ordinary ? "prompt_only" : "temporary"),
    });
  }

  for (const name of params.setDressing) {
    push({
      name,
      type: "set_dressing",
      importance: "background",
    });
  }

  return candidates.slice(0, 14);
}

function sourceTypeForBeat(beat: NormalizedBeat, details: AddedVisualDetails, context: EnrichmentContext): EnrichmentSourceType {
  if (details.wardrobe_detail && details.wardrobe_detail.includes("production_bible")) return "default_from_bible";
  if (textHasHistoricBible(context.productionBible) && /旧木|搪瓷|竹筷|年代/.test(JSON.stringify(details))) return "default_from_bible";
  const scene = context.sceneById.get(beat.scene_id);
  if (scene && (details.location_detail.includes(scene.title) || details.location_detail.includes(scene.location)) && !beat.text.includes(scene.title)) {
    return "inferred_from_context";
  }
  if (details.props.length || details.set_dressing.length || details.lighting || details.atmosphere) return "inferred_from_context";
  return "explicit";
}

function buildEnrichedText(original: string, details: AddedVisualDetails) {
  const pieces = [
    details.location_detail,
    details.blocking,
    details.props.length ? `画面中可见${details.props.join("、")}。` : "",
    details.set_dressing.length ? `周围保留${details.set_dressing.join("、")}等环境陈设。` : "",
    details.wardrobe_detail,
    details.action_detail,
    details.emotion,
    details.lighting,
    details.atmosphere,
  ].map((item) => item.trim()).filter(Boolean);

  const joined = unique(pieces).join("");
  const source = original.trim();
  if (!source) return joined;
  if (source.length <= 80) return `${source}${joined ? ` ${joined}` : ""}`;
  return `${source}${joined ? `\n视觉补全：${joined}` : ""}`;
}

function buildLocalPatch(beat: NormalizedBeat, context: EnrichmentContext): EnrichmentPatch {
  const characterNames = inferCharacterNames(beat.text, context);
  const sceneName = inferSceneName(beat, context);
  const propDetails = inferProps(`${beat.text}\n${beat.scene_text}`, context);
  const details: AddedVisualDetails = {
    location_detail: inferLocationDetail(beat, context),
    blocking: inferBlocking(beat.text, characterNames),
    props: propDetails.props,
    set_dressing: propDetails.setDressing,
    wardrobe_detail: inferWardrobe(beat.text, context),
    action_detail: inferActionDetail(beat.text, characterNames),
    emotion: inferEmotion(beat.text),
    lighting: inferLighting(`${beat.text}\n${beat.scene_text}`, context),
    atmosphere: inferAtmosphere(`${beat.text}\n${beat.scene_text}`, context),
  };
  const source_type = sourceTypeForBeat(beat, details, context);
  const confidence = source_type === "explicit" ? 0.82 : beat.text.length < 18 ? 0.64 : 0.72;
  const needs_human_review = source_type !== "explicit" || confidence < 0.7 || beat.text.length < 18;

  return {
    scene_id: beat.scene_id,
    beat_id: beat.id,
    original_text: beat.text,
    enriched_text: buildEnrichedText(beat.text, details),
    added_visual_details: details,
    asset_candidates: makeAssetCandidates({
      beat,
      context,
      characterNames,
      sceneName,
      props: propDetails.props,
      setDressing: propDetails.setDressing,
      sourceType: source_type,
    }),
    source_type,
    confidence,
    needs_human_review,
    reason: needs_human_review
      ? "原文较简略，补全包含低风险视觉默认值或同场景推断，建议人工确认。"
      : "仅补充可拍摄的视觉细节，不改变剧情事实。",
  };
}

function buildLocalPatches(context: EnrichmentContext): EnrichmentPatch[] {
  return context.beats.map((beat) => buildLocalPatch(beat, context));
}

function normalizeDetails(value: unknown): AddedVisualDetails {
  const record = toRecord(value);
  return {
    location_detail: readString(record, ["location_detail", "locationDetail"]),
    blocking: readString(record, ["blocking"]),
    props: readArray(record.props).map(clean).filter(Boolean),
    set_dressing: readArray(record.set_dressing || record.setDressing).map(clean).filter(Boolean),
    wardrobe_detail: readString(record, ["wardrobe_detail", "wardrobeDetail"]),
    action_detail: readString(record, ["action_detail", "actionDetail"]),
    emotion: readString(record, ["emotion"]),
    lighting: readString(record, ["lighting"]),
    atmosphere: readString(record, ["atmosphere"]),
  };
}

function normalizeCandidate(value: unknown): EnrichmentAssetCandidate | null {
  const record = toRecord(value);
  const name = readString(record, ["name"]);
  const type = readString(record, ["type"]).replace(/\s+/g, "") as EnrichmentAssetCandidate["type"];
  if (!name) return null;
  if (type !== "character" && type !== "scene" && type !== "prop" && type !== "set_dressing" && type !== "prompt_detail") {
    return null;
  }
  return {
    name,
    type,
    importance: normalizeImportance(record.importance, type === "prompt_detail" ? "prompt_only" : "temporary"),
  };
}

function normalizePatch(value: unknown, context: EnrichmentContext, index: number): EnrichmentPatch | null {
  const record = toRecord(value);
  const original = readString(record, ["original_text", "originalText"]);
  const beatId = readString(record, ["beat_id", "beatId"]);
  const beat = context.beats.find((item) => item.id === beatId || item.text === original) || context.beats[index];
  if (!beat && !original) return null;
  const details = normalizeDetails(record.added_visual_details || record.addedVisualDetails);
  const sourceType = readString(record, ["source_type", "sourceType"]) as EnrichmentSourceType;
  return {
    scene_id: readString(record, ["scene_id", "sceneId"]) || beat?.scene_id || "",
    beat_id: beatId || beat?.id || `beat_${pad(index + 1)}`,
    original_text: original || beat?.text || "",
    enriched_text: readString(record, ["enriched_text", "enrichedText"]) || buildEnrichedText(original || beat?.text || "", details),
    added_visual_details: details,
    asset_candidates: readArray(record.asset_candidates || record.assetCandidates)
      .map(normalizeCandidate)
      .filter((item): item is EnrichmentAssetCandidate => Boolean(item)),
    source_type: sourceType === "explicit" || sourceType === "inferred_from_context" || sourceType === "default_from_bible"
      ? sourceType
      : "inferred_from_context",
    confidence: clampConfidence(record.confidence),
    needs_human_review: Boolean(record.needs_human_review ?? record.needsHumanReview ?? true),
    reason: readString(record, ["reason"]) || "AI enrichment patch normalized for validation.",
  };
}

function patchesFromAiText(text: string, context: EnrichmentContext) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(text)) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AI returned invalid or truncated JSON: ${message}`);
  }
  const record = toRecord(parsed);
  const rawPatches = Array.isArray(parsed) ? parsed : readArray(record.patches);
  return rawPatches
    .map((item, index) => normalizePatch(item, context, index))
    .filter((item): item is EnrichmentPatch => Boolean(item));
}

function buildPromptScenes(context: EnrichmentContext) {
  const beatSceneIds = new Set(context.beats.map((beat) => beat.scene_id).filter(Boolean));
  const relatedScenes = context.scenes.filter((scene) => beatSceneIds.has(scene.id));
  return (relatedScenes.length ? relatedScenes : context.scenes).slice(0, MAX_PROMPT_SCENES);
}

function buildPromptAssets(context: EnrichmentContext) {
  const beatText = context.beats.map((beat) => beat.text).join("\n");
  return context.assets
    .filter((asset) => [asset.name, ...asset.aliases].some((name) => name && beatText.includes(name)))
    .slice(0, MAX_PROMPT_ASSETS);
}

function buildAgentPrompt(context: EnrichmentContext) {
  const promptScenes = buildPromptScenes(context);
  const promptAssets = buildPromptAssets(context);
  return [
    "Enrich the following parsed script beats. Output JSON only.",
    "Only return patches for the listed Beats. Keep enriched_text concise: preserve original_text and add no more than 1-2 visual sentences.",
    "Return compact JSON in a single object with a patches array. Do not pretty print. Keep each added visual detail under 30 Chinese characters when possible.",
    "",
    "Production bible:",
    JSON.stringify({
      title: context.productionBible.title,
      worldSetting: compact(context.productionBible.worldSetting, 500),
      visualStyle: compact(context.productionBible.visualStyle, 300),
      eraConstraints: compact(context.productionBible.eraConstraints, 300),
      locationRules: compact(context.productionBible.locationRules, 300),
      sceneRules: compact(context.productionBible.sceneRules, 300),
      propRules: compact(context.productionBible.propRules, 300),
    }, null, 2),
    "",
    "Known assets:",
    JSON.stringify(promptAssets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      name: asset.name,
      aliases: asset.aliases,
      importance: asset.importance,
      description: compact(asset.description, 180),
    })), null, 2),
    "",
    "Scenes:",
    JSON.stringify(promptScenes.map((scene) => ({
      id: scene.id,
      episode_id: scene.episode_id,
      title: scene.title,
      location: scene.location,
      description: compact(scene.description || scene.text, 260),
    })), null, 2),
    "",
    "Beats:",
    JSON.stringify(context.beats.map((beat) => ({
      beat_id: beat.id,
      scene_id: beat.scene_id,
      episode_id: beat.episode_id,
      original_text: beat.text,
      scene_title: beat.scene_title,
    })), null, 2),
  ].join("\n");
}

async function buildAiPatches(context: EnrichmentContext, input: ScriptVisualEnrichmentPreviewInput) {
  if (input.agentConfig) {
    const rawText = await withTimeout(
      callAgent(input.agentConfig, `${SYSTEM_PROMPT}\n\n${buildAgentPrompt(context)}`),
      AI_ENRICHMENT_TIMEOUT_MS,
      "Script visual enrichment agent",
    );
    validateAgentOutput("script_visual_enrichment", rawText);
    const patches = patchesFromAiText(rawText, context);
    if (patches.length === 0) throw new Error("Bound enrichment agent returned no patches");
    return patches;
  }

  const configs = resolveLanguageModelConfigs(input.modelConfig?.text);
  if (configs.length === 0) throw new Error("No text model configured for script visual enrichment");
  const prompt = buildAgentPrompt(context);
  const errors: string[] = [];
  const maxOutputTokens = Math.min(
    MAX_AI_OUTPUT_TOKENS,
    Math.max(MIN_AI_OUTPUT_TOKENS, context.beats.length * AI_OUTPUT_TOKENS_PER_BEAT),
  );

  for (const config of configs) {
    try {
      const result = await generateText({
        model: createLanguageModel(config),
        system: SYSTEM_PROMPT,
        prompt,
        providerOptions: supportsOpenAIJsonMode(config)
          ? { openai: { response_format: { type: "json_object" as const } } }
          : undefined,
        temperature: 0.15,
        maxRetries: 0,
        maxOutputTokens,
        timeout: AI_ENRICHMENT_TIMEOUT_MS,
      });
      const patches = patchesFromAiText(result.text, context);
      if (patches.length === 0) throw new Error("AI returned no enrichment patches");
      return patches;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`Script visual enrichment agent failed: ${errors.at(-1) || "unknown error"}`);
}

export async function generateScriptVisualEnrichmentPreview(
  input: ScriptVisualEnrichmentPreviewInput,
): Promise<ScriptVisualEnrichmentPreviewResult> {
  const context = normalizeEnrichmentInput(input);
  const shouldUseAI = input.useAI === false
    ? false
    : Boolean(input.agentConfig || input.useAI || input.modelConfig?.text);
  let patches: EnrichmentPatch[];
  let warnings: string[] = [];

  if (shouldUseAI) {
    try {
      patches = await buildAiPatches(context, input);
    } catch (error) {
      if (input.fallbackToLocal === false) {
        throw error;
      }
      patches = buildLocalPatches(context);
      warnings = [`script_visual_enrichment_agent_fallback: ${error instanceof Error ? error.message : String(error)}`];
    }
  } else {
    patches = buildLocalPatches(context);
  }

  const validation = validateEnrichmentPatches(patches, context);
  validation.warnings.unshift(...warnings);
  if (warnings.length > 0 && validation.status === "valid") {
    validation.status = "needs_review";
  }
  const acceptedIds = new Set(validation.accepted_patches.map((patch) => patch.beat_id));
  const rejectedIds = new Set(validation.rejected_patches.map((patch) => patch.beat_id));

  return {
    patches,
    validation,
    stats: {
      total_beats: context.beats.length,
      enriched_beats: patches.filter((patch) => acceptedIds.has(patch.beat_id)).length,
      needs_review: patches.filter((patch) => patch.needs_human_review && !rejectedIds.has(patch.beat_id)).length,
      invalid: patches.filter((patch) => rejectedIds.has(patch.beat_id)).length,
    },
  };
}
