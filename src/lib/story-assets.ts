import { and, asc, desc, eq } from "drizzle-orm";
import { db, ensureAssetLibraryTables, ensureStoryPipelineTables } from "@/lib/db";
import {
  buildAssetImagePrompt,
  defaultAssetStyleSpec,
  defaultAssetVisualSpec,
  shouldPreferCompiledDisplayPrompt,
  shouldRebuildAssetDisplayPrompt,
  type AssetPromptType,
  type AssetStyleSpec,
  type AssetVisualSchema,
} from "@/lib/asset-prompt-builder";
import {
  assets,
  assetCandidates,
  assetOccurrences,
  assetVariants,
  characterAssets,
  characters,
  propAssets,
  sceneAssets,
} from "@/lib/db/schema";
import { id as genId } from "@/lib/id";

export type StoryAssetType = "character" | "scene" | "prop";

export interface ImportAssetDraft {
  name?: string;
  aliases?: string[] | string;
  frequency?: number;
  description?: string;
  visualHint?: string;
  visualConstraints?: string;
  confirmed?: boolean;
  assetId?: string;
  category?: string;
  role?: string;
  roleKey?: string;
  scope?: "main" | "guest";
  episodes?: string[];
  prompt?: string;
  negativePrompt?: string;
  variants?: unknown[];
  imageUrl?: string;
  history?: unknown[];
  mainImageName?: string;
  tags?: string[];
  faceTemplate?: unknown;
  promptMetadata?: unknown;
  styleSpec?: unknown;
  visualSchema?: unknown;
}

export interface ImportAssetVariantDraft {
  id?: string;
  name?: string;
  variantType?: string;
  type?: string;
  state?: string;
  description?: string;
  prompt?: string;
  visualConstraints?: string;
  negativePrompt?: string;
  imageUrl?: string;
  history?: unknown[];
  editInstruction?: string;
  lockedTraits?: unknown;
  changedTraits?: unknown;
  visualSchema?: unknown;
}

export interface StoryAssetPatch {
  name?: string;
  aliases?: string[] | string;
  importance?: number | string;
  description?: string;
  visualConstraints?: string;
  negativeConstraints?: string;
  firstAppearance?: string;
  confirmed?: boolean | number;
  referenceImage?: string | null;
  metadata?: Record<string, unknown> | null;
  character?: {
    characterId?: string | null;
    roleName?: string;
    age?: string;
    gender?: string;
    personality?: string;
    costume?: string;
    voice?: string;
    relationshipNotes?: string;
  };
  scene?: {
    sceneId?: string | null;
    locationType?: string;
    timeOfDay?: string;
    lighting?: string;
    weather?: string;
    layout?: string;
  };
  prop?: {
    propCategory?: string;
    ownerCharacterId?: string | null;
    sceneId?: string | null;
    state?: string;
    usageRules?: string;
  };
  variants?: ImportAssetVariantDraft[];
}

type AssetRow = typeof assets.$inferSelect;

function cleanText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function jsonString(value: unknown) {
  return JSON.stringify(value ?? []);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") return parseJson<Record<string, unknown>>(value, {});
  return {};
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => cleanText(item)).filter(Boolean))];
  }
  if (typeof value === "string") {
    if (value.trim().startsWith("[")) return normalizeStringList(parseJson<unknown>(value, []));
    return [...new Set(value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))];
  }
  return [];
}

function normalizeName(name: unknown) {
  return cleanText(name).replace(/\s+/g, " ");
}

function normalizeAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => cleanText(item)).filter(Boolean))];
  }
  if (typeof value === "string") {
    const parsed = parseJson<unknown>(value, value);
    if (Array.isArray(parsed)) return normalizeAliases(parsed);
    return value
      .split(/[,\n，、]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

const CHARACTER_STATE_PATTERNS = [
  "一身", "衣着", "衣衫", "身着", "穿着", "神情", "表情", "面容", "声音", "语气",
  "视角", "旁白", "内心独白", "电话里", "满身", "浑身",
  "风尘满面", "衣衫褴褛", "狼狈便装", "硬朗冷峻", "坚毅冷峻", "壮实紧张",
  "声音嘶哑", "紧张", "冷峻", "坚毅", "疲惫", "虚弱", "受伤", "重伤", "断腿", "警觉", "惊恐", "愤怒",
  "倒地", "眩晕倒地", "敬礼", "咆哮", "拍肩赞赏",
];

const CHARACTER_NOISE_NAMES = new Set([
  "制作提示",
  "厘清场景归属",
  "客观",
  "客观视角",
  "转场字幕",
  "监狱画面",
  "题材",
  "核心",
  "中立",
  "忠诚",
  "酷飒",
]);

const GROUP_CHARACTER_NAMES = [
  "丧尸群",
  "丧尸",
  "联盟战士",
  "战士",
  "士兵",
  "伤员",
  "幸存者",
  "难民",
  "群众",
  "村民",
  "黑衣人",
  "守卫",
  "敌兵",
  "工人",
  "暴徒",
  "混混",
  "流寇",
  "囚犯",
];

const PROP_BASE_KEYWORDS = [
  "医疗箱", "物资箱", "工具箱", "录音笔", "对讲机", "手电筒", "玻璃杯", "水杯", "茶杯", "酒杯",
  "重卡", "卡车", "汽车", "轿车", "摩托", "手枪", "步枪", "匕首", "钥匙", "手机", "电脑", "芯片",
  "地图", "文件", "照片", "合同", "戒指", "项链", "玉佩", "令牌", "杯子", "面具", "制服", "外套",
  "炸药", "炸弹", "手电", "遥控器", "水箱", "罐头", "背包", "针剂", "枪", "刀", "剑", "弓", "箱", "杯", "药", "信",
];

const SCENE_BASE_KEYWORDS = [
  "高速服务区", "证券交易所", "交易大厅", "盘山公路", "会议室", "指挥部", "派出所", "民政局",
  "急诊室", "手术室", "审讯室", "拘留室", "交易所", "军区", "营房", "宿舍", "医院", "病房",
  "诊室", "科室", "学校", "教室", "公司", "办公室", "客厅", "卧室", "厨房", "书房", "院子",
  "庭院", "地下室", "仓库", "工厂", "厂房", "车间", "实验室", "基地", "天台", "楼顶", "走廊",
  "街道", "公路", "高速", "车站", "码头", "机场", "商场", "超市", "酒吧", "餐厅", "酒店",
  "旅馆", "警局", "法院", "法庭", "监狱", "牢房", "森林", "荒野", "山林", "河边", "城堡",
  "王府", "宫殿", "客栈", "避难所", "营地", "操场", "广场", "空间", "房间", "大厅", "屋顶", "据点",
];

function uniqueByCleanName<T extends { name?: string }>(items: T[]) {
  const byName = new Map<string, T>();
  for (const item of items) {
    const name = normalizeName(item.name);
    if (!name) continue;
    if (!byName.has(name)) {
      byName.set(name, { ...item, name });
      continue;
    }
    byName.set(name, mergeDraftLike(byName.get(name)!, item));
  }
  return [...byName.values()];
}

function mergeDraftLike<T extends { name?: string; variants?: unknown[]; description?: string; frequency?: number }>(existing: T, incoming: T): T {
  return {
    ...existing,
    ...incoming,
    name: existing.name || incoming.name,
    assetId: (existing as ImportAssetDraft).assetId || (incoming as ImportAssetDraft).assetId,
    confirmed: Boolean((existing as ImportAssetDraft).confirmed || (incoming as ImportAssetDraft).confirmed),
    imageUrl: (existing as ImportAssetDraft).imageUrl || (incoming as ImportAssetDraft).imageUrl,
    prompt: (existing as ImportAssetDraft).prompt || (incoming as ImportAssetDraft).prompt,
    negativePrompt: (existing as ImportAssetDraft).negativePrompt || (incoming as ImportAssetDraft).negativePrompt,
    visualConstraints: (existing as ImportAssetDraft).visualConstraints || (incoming as ImportAssetDraft).visualConstraints,
    frequency: Math.max(Number(existing.frequency || 0), Number(incoming.frequency || 0)) || existing.frequency || incoming.frequency,
    description: String(incoming.description || "").length > String(existing.description || "").length
      ? incoming.description
      : existing.description || incoming.description,
    variants: mergeVariantDrafts(existing.variants, incoming.variants),
  };
}

function mergeVariantDrafts(...variantLists: Array<unknown[] | undefined>) {
  const seen = new Set<string>();
  const variants: ImportAssetVariantDraft[] = [];
  for (const list of variantLists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const variant = raw as ImportAssetVariantDraft;
      const name = normalizeName(variant.name || variant.id || variant.description || variant.state);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      variants.push({ ...variant, name });
    }
  }
  return variants;
}

function findLongestKeyword(value: string, keywords: string[]) {
  return [...keywords]
    .sort((a, b) => b.length - a.length)
    .find((keyword) => value.includes(keyword)) || "";
}

function normalizeVariantStateText(value: string) {
  return cleanText(value)
    .replace(/[“”"「」『』《》【】]/g, "")
    .replace(/[，。！？；、,.!?;]+/g, " ")
    .replace(/\s+/g, "")
    .replace(/^(的|被|已|已经|正在|两名|两位|一名|一位|一群|一队)/, "")
    .replace(/(滚到|落到|掉到|摔到|放在|放到|拿到|递给|旁边|地上|一旁).*$/g, "")
    .replace(/(的|后|中|状态|版本)$/g, "")
    .trim()
    .slice(0, 24);
}

function makeVariantDraft(
  assetName: string,
  stateText: string,
  assetType: StoryAssetType,
  source?: ImportAssetDraft,
): ImportAssetVariantDraft {
  const normalizedState = normalizeVariantStateText(stateText) || "剧情状态";
  const variantType = assetType === "character"
    ? inferCharacterVariantType(normalizedState)
    : assetType === "prop"
      ? inferPropVariantType(normalizedState)
      : inferSceneVariantType(normalizedState);
  const suffix = assetType === "scene" ? "变体" : "状态";
  return {
    name: `${assetName}${normalizedState}${suffix}`,
    variantType,
    state: normalizedState,
    description: assetType === "character"
      ? `${normalizedState}：同一角色的剧情状态变体，保持身份、脸型、五官和辨识度一致。`
      : assetType === "prop"
        ? `${normalizedState}：同一物品的剧情状态变体，保持核心形状、材质、比例和标志性细节一致。`
        : `${normalizedState}：同一场景的时间、天气、灯光或陈设状态变体，空间结构和主要陈设保持一致。`,
    prompt: source?.prompt || source?.visualConstraints || "",
    visualConstraints: source?.visualConstraints || source?.description || "",
  };
}

function inferCharacterVariantType(stateText: string) {
  if (/衣|服|便装|制服|装束|夹克|外套|睡衣|正装|礼服|军装|作战/.test(stateText)) return "costume";
  if (/伤|血|虚弱|疲惫|狼狈|倒地|眩晕|断腿/.test(stateText)) return "injury";
  if (/神情|表情|紧张|坚毅|冷峻|惊恐|愤怒|警觉|咆哮|敬礼/.test(stateText)) return "emotion";
  if (/丧尸|战士|士兵|伤员|群/.test(stateText)) return "group_state";
  if (/壮实|瘦弱|高大|矮小|风尘/.test(stateText)) return "body_state";
  return "appearance";
}

function inferPropVariantType(stateText: string) {
  if (/破|碎|裂|断|损|坏|旧|烧焦|磨损|撕/.test(stateText)) return "damaged";
  if (/血|污|脏|湿/.test(stateText)) return "stained";
  if (/打开|开启|展开|翻开|拆开/.test(stateText)) return "open";
  if (/关闭|合上|锁|封/.test(stateText)) return "closed";
  if (/空|满|装满|塞满|物资/.test(stateText)) return "load_state";
  if (/佩戴|戴上|穿上|披上/.test(stateText)) return "worn";
  return "condition";
}

function inferSceneVariantType(stateText: string) {
  if (/雨|暴雨|下雨|雪|暴雪|下雪|雾|烟雾|晴|阴/.test(stateText)) return "weather";
  if (/日|白天|清晨|早晨|上午|中午|午后|夜|晚上|深夜|凌晨|黄昏|傍晚/.test(stateText)) return "time_of_day";
  if (/逆光|昏暗|灯光|霓虹/.test(stateText)) return "lighting";
  if (/废弃|破败|坍塌|烧毁|爆炸|战斗/.test(stateText)) return "damage_state";
  if (/空旷|拥挤|混乱|封锁/.test(stateText)) return "set_dressing";
  return "scene_state";
}

function characterStateOnly(name: string) {
  const value = normalizeVariantStateText(name);
  if (!value) return false;
  if (/^(神情|表情|面容|声音|语气|视角|旁白|内心|电话里|敬礼|衣着|衣衫|身着|穿着|一身|满身|浑身)/.test(value)) return true;
  return CHARACTER_STATE_PATTERNS.some((pattern) => value === pattern);
}

function splitCharacterDraftName(name: string, baseNames: string[]) {
  const value = normalizeName(name)
    .replace(/^(两名|两位|一名|一位|数名|几名|多名|一群|一队)/, "")
    .replace(/(两名|两位|数名|几名|多名)$/, "");
  if (!value || CHARACTER_NOISE_NAMES.has(value) || /^景\d+$/.test(value)) return { drop: true as const };
  if (/^[一二两三四五六七八九十0-9]+人$/.test(value)) return { drop: true as const };
  if (characterStateOnly(value)) return { drop: true as const, stateText: value };

  const explicitBase = baseNames
    .filter((base) => base !== value && value.startsWith(base) && value.length > base.length)
    .sort((a, b) => b.length - a.length)[0];
  if (explicitBase) {
    const stateText = normalizeVariantStateText(value.slice(explicitBase.length));
    if (stateText && (characterStateOnly(stateText) || /敬礼|咆哮|拍肩|赞赏|倒地|断腿/.test(stateText))) {
      return { assetName: explicitBase, stateText };
    }
  }

  const groupBase = GROUP_CHARACTER_NAMES
    .filter((base) => value.startsWith(base) && value.length > base.length)
    .sort((a, b) => b.length - a.length)[0];
  if (groupBase) return { assetName: groupBase, stateText: normalizeVariantStateText(value.slice(groupBase.length)) };

  const stateMatch = CHARACTER_STATE_PATTERNS
    .filter((state) => value.endsWith(state) && value.length > state.length + 1)
    .sort((a, b) => b.length - a.length)[0];
  if (stateMatch) {
    const assetName = normalizeName(value.slice(0, value.length - stateMatch.length));
    if (assetName.length >= 2) return { assetName, stateText: stateMatch };
  }

  return { assetName: value };
}

function propVariantStateFromName(name: string, baseName: string) {
  const direct = name.match(/(未开封|未拆|完好|崭新|干净|完整|破损|破碎|碎裂|裂开|裂痕|断裂|断掉|损坏|摔坏|砸坏|烧焦|磨损|染血|沾血|血迹|污渍|脏污|打开|开启|展开|翻开|拆开|关闭|合上|锁上|封住|收起|空的|空箱|空包|空瓶|装满|满满|塞满|佩戴|戴上|穿上|披上|丢失|湿透|湿漉|旧|碎|裂|断|脏|湿|撕)/);
  if (direct) return normalizeVariantStateText(direct[1]);
  return normalizeVariantStateText(name.replace(baseName, ""));
}

function sceneVariantStateFromName(name: string, baseName: string) {
  const direct = name.match(/(白天|清晨|早晨|上午|中午|午后|夜晚|晚上|深夜|凌晨|黄昏|傍晚|雨夜|雨天|暴雨|下雨|雪夜|下雪|雾天|烟雾|晴天|阴天|逆光|昏暗|灯光|霓虹|废弃|破败|坍塌|烧毁|爆炸后|空旷|拥挤|混乱|战斗后|封锁|日|夜|雨|雪|雾)/);
  if (direct) return normalizeVariantStateText(direct[1]);
  return normalizeVariantStateText(name.replace(baseName, ""));
}

function normalizeCharacterDrafts(drafts: ImportAssetDraft[]) {
  const baseNames = drafts
    .map((draft) => normalizeName(draft.name))
    .filter((name) => name.length >= 2 && !characterStateOnly(name) && !CHARACTER_NOISE_NAMES.has(name));
  const byName = new Map<string, ImportAssetDraft>();
  for (const draft of drafts) {
    const split = splitCharacterDraftName(String(draft.name || ""), baseNames);
    if ("drop" in split && split.drop) continue;
    const assetName = normalizeName(split.assetName || draft.name);
    if (!assetName || characterStateOnly(assetName) || CHARACTER_NOISE_NAMES.has(assetName)) continue;
    const current = byName.get(assetName);
    const normalized: ImportAssetDraft = {
      ...draft,
      name: assetName,
      assetId: assetName === normalizeName(draft.name) ? draft.assetId : "",
      variants: draft.variants || [],
    };
    if (split.stateText) {
      normalized.variants = mergeVariantDrafts(normalized.variants, [
        makeVariantDraft(assetName, split.stateText, "character", draft),
      ]);
    }
    byName.set(assetName, current ? mergeDraftLike(current, normalized) : normalized);
  }
  return uniqueByCleanName([...byName.values()]);
}

function normalizeNamedAssetDrafts(drafts: ImportAssetDraft[], type: "prop" | "scene") {
  const keywords = type === "prop" ? PROP_BASE_KEYWORDS : SCENE_BASE_KEYWORDS;
  const byName = new Map<string, ImportAssetDraft>();
  for (const draft of drafts) {
    const rawName = normalizeName(draft.name);
    const baseName = findLongestKeyword(rawName, keywords) || rawName;
    if (type === "prop" && looksLikeFalsePropHit(rawName, baseName)) continue;
    if (!baseName || baseName.length < 2) continue;
    const stateText = type === "prop"
      ? propVariantStateFromName(rawName, baseName)
      : sceneVariantStateFromName(rawName, baseName);
    const shouldFoldVariant = rawName !== baseName
      && stateText
      && (type === "prop" ? inferPropVariantType(stateText) !== "condition" || /完好|完整|干净/.test(stateText) : inferSceneVariantType(stateText) !== "scene_state");
    const shouldFoldWrapper = rawName !== baseName
      && rawName.length > baseName.length + 3
      && (type === "prop"
        ? /(取出|拿起|递出|伸手|制造|缓缓|他的|她的|被彻底|残骸)/.test(rawName)
        : /(墙面|科幻|里面|外面|附近|门口|来到|进入|走进|冲进|蜿蜒|延伸|通向|通往|穿过|横跨|坐落|矗立|映入|出现|远处|尽头|两侧|角落)/.test(rawName));
    const assetName = shouldFoldVariant || shouldFoldWrapper ? baseName : rawName;
    if (!assetName || assetName.length < 2 || assetName.length > 18) continue;
    const normalized: ImportAssetDraft = {
      ...draft,
      name: assetName,
      assetId: assetName === rawName ? draft.assetId : "",
      variants: draft.variants || [],
    };
    if (shouldFoldVariant) {
      normalized.variants = mergeVariantDrafts(normalized.variants, [
        makeVariantDraft(assetName, stateText, type, draft),
      ]);
    }
    const current = byName.get(assetName);
    byName.set(assetName, current ? mergeDraftLike(current, normalized) : normalized);
  }
  return uniqueByCleanName([...byName.values()]);
}

function looksLikeFalsePropHit(name: string, baseName: string) {
  if (!name || !baseName) return false;
  if (baseName === "剑" && /(剑拔弩张|如利剑|利剑般)/.test(name)) return true;
  if (baseName.length === 1 && /(气氛|光柱|黑暗|弓身|弓着腰|弓背|微微弓身|侧身弓背|伸手)/.test(name)) return true;
  return false;
}

function normalizeImportAssetsForSync(input: {
  characters?: ImportAssetDraft[];
  items?: ImportAssetDraft[];
  environments?: ImportAssetDraft[];
}) {
  return {
    characters: normalizeCharacterDrafts(input.characters || []),
    items: normalizeNamedAssetDrafts(input.items || [], "prop"),
    environments: normalizeNamedAssetDrafts(input.environments || [], "scene"),
  };
}

function assetPromptType(type: StoryAssetType): AssetPromptType {
  if (type === "character" || type === "scene" || type === "prop") return type;
  return "prop";
}

function readRecordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function inferSpecificEraFromText(value: unknown) {
  const text = cleanText(value);
  const explicitYear = text.match(/\b(19[0-9]{2}|20[0-9]{2})\s*(?:年|China)?\b/i);
  if (explicitYear) return `${explicitYear[1]} China`;
  if (/(七十年代|七零年代|70年代|1970s|1970年代)/i.test(text)) return "1970s China";
  if (/(八十年代|八零年代|80年代|1980s|1980年代)/i.test(text)) return "1980s China";
  if (/(九十年代|九零年代|90年代|1990s|1990年代)/i.test(text)) return "1990s China";
  if (/民国|军阀|谍战|抗战|Republican-era/i.test(text)) return "Republican-era China";
  if (/古代|唐代|宋代|明代|清代|汉代|古风|仙侠|武侠|historical China/i.test(text)) return "historical China";
  if (/末世|废土|末日|灾变|丧尸|post-apocalyptic|wasteland/i.test(text)) return "post-apocalyptic wasteland China";
  return "";
}

function isGenericEraFallback(value: unknown) {
  const text = cleanText(value);
  return !text
    || /confirmed script era and location/i.test(text)
    || /realistic modern\/civilian China unless asset schema explicitly states otherwise/i.test(text)
    || /现实主义现代\/平民中国，?除非资产结构明确指定其他时代/.test(text);
}

function pickBestEraCandidate(values: unknown[]) {
  const cleaned = values.map((value) => cleanText(value)).filter(Boolean);
  const explicit = cleaned.map(inferSpecificEraFromText).find(Boolean);
  if (explicit) return explicit;
  return cleaned.find((value) => !isGenericEraFallback(value)) || "";
}

function inferEraFromDraft(draft: ImportAssetDraft) {
  const promptMetadata = asRecord(draft.promptMetadata);
  const compilerIR = asRecord(promptMetadata.compilerIR);
  const compilerConstraints = asRecord(compilerIR.constraints);
  const compilerInput = asRecord(promptMetadata.compilerInput);
  const compilerStyleSpec = asRecord(compilerInput.style_spec);
  const text = [
    draft.description,
    draft.visualHint,
    draft.visualConstraints,
    draft.prompt,
    ...(draft.tags || []),
  ].map((value) => cleanText(value)).filter(Boolean).join(" ");
  const era = pickBestEraCandidate([
    readRecordString(compilerConstraints, "era"),
    readRecordString(compilerStyleSpec, "eraConstraint"),
    readRecordString(compilerStyleSpec, "era"),
    promptMetadata.compiledFinalPrompt,
    promptMetadata.compiledDisplayPrompt,
    text,
  ]);
  if (era) return era;
  return "confirmed script era and location";
}

function normalizeAssetStyleSpec(type: StoryAssetType, draft: ImportAssetDraft): AssetStyleSpec {
  const incoming = asRecord(draft.styleSpec);
  const visualSchema = asRecord(draft.visualSchema);
  const constraints = asRecord(visualSchema.constraints);
  const promptMetadata = asRecord(draft.promptMetadata);
  const compilerIR = asRecord(promptMetadata.compilerIR);
  const compilerConstraints = asRecord(compilerIR.constraints);
  const compilerInput = asRecord(promptMetadata.compilerInput);
  const compilerStyleSpec = asRecord(compilerInput.style_spec);
  const base = defaultAssetStyleSpec();
  const era = pickBestEraCandidate([
    readRecordString(incoming, "era"),
    readRecordString(incoming, "eraConstraint"),
    readRecordString(constraints, "era"),
    readRecordString(compilerConstraints, "era"),
    readRecordString(compilerStyleSpec, "eraConstraint"),
    readRecordString(compilerStyleSpec, "era"),
    promptMetadata.compiledFinalPrompt,
    promptMetadata.compiledDisplayPrompt,
    inferEraFromDraft(draft),
  ]);
  const genre = readRecordString(incoming, "genre")
    || readRecordString(compilerConstraints, "genre")
    || readRecordString(compilerStyleSpec, "genre")
    || readRecordString(constraints, "genre")
    || base.genre
    || "realistic short-drama production asset";

  return {
    ...base,
    ...compilerStyleSpec,
    ...incoming,
    era,
    eraConstraint: pickBestEraCandidate([
      readRecordString(incoming, "eraConstraint"),
      readRecordString(incoming, "era"),
      readRecordString(compilerStyleSpec, "eraConstraint"),
      readRecordString(compilerStyleSpec, "era"),
      readRecordString(compilerConstraints, "era"),
      era,
    ]) || era,
    genre,
    style: readRecordString(incoming, "style") || base.style,
    lighting: readRecordString(incoming, "lighting") || base.lighting,
    camera: readRecordString(incoming, "camera") || base.camera,
    texture: readRecordString(incoming, "texture") || base.texture,
    mustHave: normalizeStringList(incoming.mustHave).length
      ? normalizeStringList(incoming.mustHave)
      : [
          type === "character" ? "stable character identity" : "",
          type === "scene" ? "stable empty environment identity" : "",
          type === "prop" ? "stable prop identity" : "",
        ].filter(Boolean),
    mustNotHave: normalizeStringList(incoming.mustNotHave),
    forbiddenVisualElements: normalizeStringList(incoming.forbiddenVisualElements),
  };
}

function normalizeAssetVisualSchema(draft: ImportAssetDraft): AssetVisualSchema | null {
  const schema = asRecord(draft.visualSchema);
  return Object.keys(schema).length ? schema as AssetVisualSchema : null;
}

function defaultAssetNegativeConstraints(type: StoryAssetType) {
  const common = [
    "text",
    "logo",
    "watermark",
    "UI",
    "subtitle",
    "caption",
    "low resolution",
    "distorted anatomy",
    "wrong era",
    "wrong genre",
    "unrelated branded object",
  ];
  if (type === "character") {
    return [...common, "extra people", "duplicate character", "inconsistent face", "inconsistent clothing"].join(", ");
  }
  if (type === "scene") {
    return [...common, "people", "human silhouette", "character portrait", "unrelated prop close-up"].join(", ");
  }
  return [...common, "people", "hands", "held object scene", "background environment", "reflected lettering"].join(", ");
}

function defaultAssetDescription(type: StoryAssetType, name: string) {
  if (type === "character") return `${name} reusable character asset profile.`;
  if (type === "scene") return `${name} reusable empty scene environment asset profile.`;
  return `${name} reusable prop asset profile.`;
}

function standardChecklist(type: StoryAssetType, draft: ImportAssetDraft, built: ReturnType<typeof buildAssetImagePrompt>) {
  const variants = Array.isArray(draft.variants) ? draft.variants : [];
  const checks = {
    canonicalName: Boolean(normalizeName(draft.name)),
    taxonomy: type === "character" || type === "scene" || type === "prop",
    description: Boolean(cleanText(draft.description)),
    visualConstraints: Boolean(cleanText(draft.visualConstraints || draft.visualHint || draft.prompt)),
    negativeConstraints: Boolean(cleanText(draft.negativePrompt)),
    defaultVariant: true,
    sourceEvidence: Boolean(cleanText(draft.description || draft.visualConstraints || draft.visualHint || draft.name)),
    promptCompilerPassed: built.validation_report.passed,
    variantsReviewed: variants.every((variant) => {
      const record = asRecord(variant);
      return Boolean(readRecordString(record, "name") || readRecordString(record, "description") || readRecordString(record, "state"));
    }),
  };
  return {
    ...checks,
    readyForLock: Object.values(checks).every(Boolean),
  };
}

function standardizeImportAssetDraft(type: StoryAssetType, draft: ImportAssetDraft): ImportAssetDraft {
  const name = normalizeName(draft.name);
  if (!name) return draft;

  const styleSpec = normalizeAssetStyleSpec(type, draft);
  const visualSchema = normalizeAssetVisualSchema(draft);
  const rebuildDisplayPrompt = shouldRebuildAssetDisplayPrompt(draft.prompt);
  const reusablePromptSource = rebuildDisplayPrompt ? "" : draft.prompt;
  const description = cleanText(draft.description || draft.visualHint || draft.visualConstraints || defaultAssetDescription(type, name));
  const visualConstraints = cleanText(draft.visualConstraints || draft.visualHint || reusablePromptSource || description);
  const negativePrompt = cleanText(draft.negativePrompt || defaultAssetNegativeConstraints(type));
  const sourcePrompt = cleanText(reusablePromptSource);
  const faceTemplate = asRecord(draft.faceTemplate);
  const built = buildAssetImagePrompt({
    asset: {
      id: draft.assetId || name,
      type: assetPromptType(type),
      name,
      role: draft.role || draft.roleKey || draft.scope || draft.category || "",
      category: draft.category || type,
      prompt: sourcePrompt,
      description,
      visualHint: draft.visualHint || "",
      visualConstraints,
      negativeConstraints: negativePrompt,
      tags: draft.tags || [],
      faceTemplate: Object.keys(faceTemplate).length
        ? {
            label: cleanText(faceTemplate.label),
            url: cleanText(faceTemplate.url),
            note: cleanText(faceTemplate.note),
          }
        : null,
      visualSchema,
    },
    visualSpec: defaultAssetVisualSpec(assetPromptType(type), "1536x1024"),
    styleSpec,
  });
  const builtDisplayPrompt = cleanText(built.compiled_display_prompt);
  const displayPrompt = shouldPreferCompiledDisplayPrompt(sourcePrompt, builtDisplayPrompt)
    ? builtDisplayPrompt
    : sourcePrompt || builtDisplayPrompt || cleanText(draft.visualConstraints || draft.visualHint || description);
  const previousPromptMetadata = asRecord(draft.promptMetadata);
  const checklist = standardChecklist(type, {
    ...draft,
    name,
    description,
    visualConstraints,
    negativePrompt,
  }, built);

  return {
    ...draft,
    name,
    description,
    visualConstraints,
    negativePrompt,
    prompt: displayPrompt,
    promptMetadata: {
      ...previousPromptMetadata,
      standardVersion: "asset_library_standard_v1",
      displayPromptLanguage: "zh",
      generationPromptLanguage: "en_structured",
      promptBuilder: "asset_prompt_compiler_v2",
      compiler: built.compiler_ir.compiler,
      compilerInput: built.compiler_input,
      compilerIR: built.compiler_ir,
      compiledFinalPrompt: built.compiled_final_prompt,
      compiledNegativePrompt: built.compiled_negative_prompt,
      compiledDisplayPrompt: built.compiled_display_prompt,
      validationReport: built.validation_report,
      checklist,
    },
    styleSpec,
    visualSchema,
  };
}

function normalizeVariantDrafts(type: StoryAssetType, draft: ImportAssetDraft) {
  const rawVariants = Array.isArray(draft.variants)
    ? draft.variants
        .map((item) => item && typeof item === "object" ? item as ImportAssetVariantDraft : null)
        .filter((item): item is ImportAssetVariantDraft => Boolean(item))
    : [];
  const defaultName = type === "character"
    ? "default_look"
    : type === "scene"
      ? "default_scene_state"
      : "default_prop_state";
  const defaultState = cleanText(draft.visualConstraints || draft.visualHint || draft.description || draft.role || draft.category || "default");
  const defaultVariant: ImportAssetVariantDraft = {
    name: defaultName,
    variantType: "default",
    state: defaultState,
    description: draft.description,
    prompt: draft.prompt || "",
    visualConstraints: draft.visualConstraints || draft.visualHint || draft.description,
    negativePrompt: draft.negativePrompt,
    imageUrl: draft.imageUrl,
    history: draft.history,
    lockedTraits: {
      name: draft.name,
      aliases: normalizeAliases(draft.aliases),
      type,
    },
    changedTraits: {
      state: defaultState,
    },
    visualSchema: draft.visualSchema,
  };

  const seen = new Set<string>();
  return [defaultVariant, ...rawVariants]
    .map((variant, index) => {
      const name = normalizeName(variant.name || variant.id || (index === 0 ? defaultName : `variant_${index}`));
      return {
        ...variant,
        name,
        variantType: normalizeName(variant.variantType || variant.type || (index === 0 ? "default" : "state")),
      };
    })
    .filter((variant) => {
      const key = variant.name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function importanceLabel(score: number) {
  if (score >= 80) return "core";
  if (score >= 50) return "important";
  if (score >= 20) return "temporary";
  return "background";
}

async function createResolvedCandidate(
  projectId: string,
  type: StoryAssetType,
  draft: ImportAssetDraft,
  assetId: string,
) {
  const now = new Date();
  const name = normalizeName(draft.name);
  const normalizedName = name.toLowerCase();
  const existingRows = await db
    .select()
    .from(assetCandidates)
    .where(and(
      eq(assetCandidates.projectId, projectId),
      eq(assetCandidates.assetType, type),
      eq(assetCandidates.mergedAssetId, assetId),
    ))
    .orderBy(asc(assetCandidates.createdAt));
  const existing = existingRows.find((row) => {
    const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
    return row.normalizedName === normalizedName
      && metadata.source === "import_asset_draft"
      && (!draft.assetId || metadata.sourceAssetId === draft.assetId);
  }) ?? existingRows.find((row) => row.normalizedName === normalizedName);
  const previousMetadata = parseJson<Record<string, unknown>>(existing?.metadata, {});
  const incomingSourceAssetId = draft.assetId && draft.assetId !== assetId
    ? draft.assetId
    : "";

  const values = {
    projectId,
    assetType: type,
    name,
    normalizedName,
    aliases: normalizeAliases(draft.aliases),
    role: cleanText(draft.role || draft.roleKey || draft.scope || draft.category),
    description: cleanText(draft.description),
    evidenceText: cleanText(draft.description || draft.visualConstraints || draft.visualHint || name),
    confidence: Math.max(50, Math.min(95, importanceScore(undefined, draft))),
    source: "ai" as const,
    status: "merged" as const,
    mergedAssetId: assetId,
    metadata: {
      source: "import_asset_draft",
      standardVersion: "asset_library_standard_v1",
      sourceAssetId: incomingSourceAssetId || previousMetadata.sourceAssetId || draft.assetId || "",
      episodes: draft.episodes || [],
      visualHint: draft.visualHint || "",
      importanceLabel: importanceLabel(importanceScore(undefined, draft)),
      promptMetadata: draft.promptMetadata || null,
    },
    updatedAt: now,
  };

  if (existing) {
    const [candidate] = await db
      .update(assetCandidates)
      .set(values)
      .where(eq(assetCandidates.id, existing.id))
      .returning();
    return candidate;
  }

  const [candidate] = await db
    .insert(assetCandidates)
    .values({
      id: genId(),
      ...values,
      createdAt: now,
    })
    .returning();
  return candidate;
}

async function createAssetOccurrence(
  projectId: string,
  assetId: string,
  draft: ImportAssetDraft,
  candidateId?: string | null,
) {
  const evidenceText = cleanText(draft.description || draft.visualConstraints || draft.visualHint || draft.name);
  const metadata = {
    source: "import_asset_draft",
    standardVersion: "asset_library_standard_v1",
    episodes: draft.episodes || [],
    visualHint: draft.visualHint || "",
    promptMetadata: draft.promptMetadata || null,
  };
  const existingRows = await db
    .select()
    .from(assetOccurrences)
    .where(eq(assetOccurrences.assetId, assetId))
    .orderBy(asc(assetOccurrences.createdAt));
  const existing = existingRows.find((row) => {
    const rowMetadata = parseJson<Record<string, unknown>>(row.metadata, {});
    return row.candidateId === (candidateId ?? null)
      && rowMetadata.source === "import_asset_draft";
  });

  if (existing) {
    const [occurrence] = await db
      .update(assetOccurrences)
      .set({
        projectId,
        assetId,
        candidateId: candidateId ?? null,
        occurrenceType: "mention",
        evidenceText,
        importance: importanceScore(undefined, draft),
        metadata,
      })
      .where(eq(assetOccurrences.id, existing.id))
      .returning();
    return occurrence;
  }

  const [occurrence] = await db
    .insert(assetOccurrences)
    .values({
      id: genId(),
      projectId,
      assetId,
      candidateId: candidateId ?? null,
      occurrenceType: "mention",
      evidenceText,
      importance: importanceScore(undefined, draft),
      metadata,
      createdAt: new Date(),
    })
    .returning();
  return occurrence;
}

async function syncAssetVariants(
  projectId: string,
  type: StoryAssetType,
  assetId: string,
  draft: ImportAssetDraft,
  source?: {
    candidateId?: string | null;
    occurrenceId?: string | null;
  },
) {
  const now = new Date();
  const rows = [];
  for (const variant of normalizeVariantDrafts(type, draft)) {
    const values = {
      projectId,
      assetId,
      sourceCandidateId: source?.candidateId ?? null,
      sourceOccurrenceId: source?.occurrenceId ?? null,
      variantType: cleanText(variant.variantType || variant.type || "state"),
      name: normalizeName(variant.name),
      state: cleanText(variant.state || variant.description || variant.editInstruction || draft.visualConstraints || draft.visualHint),
      lockedTraits: variant.lockedTraits ?? {
        assetName: draft.name,
        assetType: type,
        baseDescription: draft.description || "",
        baseVisualConstraints: draft.visualConstraints || "",
        baseNegativeConstraints: draft.negativePrompt || "",
        styleSpec: draft.styleSpec || null,
        visualSchema: draft.visualSchema || null,
      },
      changedTraits: variant.changedTraits ?? {
        prompt: variant.prompt || "",
        editInstruction: variant.editInstruction || "",
        state: variant.state || variant.description || "",
      },
      visualConstraints: cleanText(variant.visualConstraints || variant.description || draft.visualConstraints || draft.visualHint || draft.description),
      negativeConstraints: cleanText(variant.negativePrompt || draft.negativePrompt),
      referenceImage: variant.imageUrl || (variant.variantType === "default" ? draft.imageUrl : null) || null,
      status: draft.confirmed ? "approved" as const : variant.imageUrl ? "generated" as const : "draft" as const,
      metadata: {
        source: "import_asset_draft",
        standardVersion: "asset_library_standard_v1",
        sourceVariantId: variant.id || "",
        history: variant.history || [],
        visualSchema: variant.visualSchema || null,
        promptMetadata: draft.promptMetadata || null,
      },
      updatedAt: now,
    };

    await db
      .insert(assetVariants)
      .values({
        id: genId(),
        ...values,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [assetVariants.assetId, assetVariants.name],
        set: values,
      });

    const [row] = await db
      .select()
      .from(assetVariants)
      .where(and(eq(assetVariants.assetId, assetId), eq(assetVariants.name, values.name)));
    if (row) rows.push(row);
  }
  return rows;
}

export function importanceScore(value: unknown, draft?: ImportAssetDraft) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)));
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "core") return 100;
    if (normalized === "important") return 70;
    if (normalized === "temporary") return 35;
    if (normalized === "background") return 10;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return importanceScore(numeric);
  }

  const frequency = Number(draft?.frequency ?? 0);
  const roleText = `${draft?.role ?? ""} ${draft?.roleKey ?? ""} ${draft?.scope ?? ""}`;
  if (/lead|main|主角|男主|女主|core/i.test(roleText)) return 100;
  if (frequency >= 10) return 80;
  if (frequency >= 5) return 60;
  if (frequency >= 2) return 35;
  return 15;
}

function typeFromTab(tab: "characters" | "items" | "environments" | StoryAssetType): StoryAssetType {
  if (tab === "characters") return "character";
  if (tab === "items") return "prop";
  if (tab === "environments") return "scene";
  return tab;
}

async function findExistingAsset(projectId: string, type: StoryAssetType, name: string, sourceAssetId?: string) {
  const existing = await db
    .select()
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.type, type)))
    .orderBy(asc(assets.createdAt));

  const normalizedName = name.toLowerCase();
  return existing.find((row) => {
    if (sourceAssetId && row.id === sourceAssetId) return true;
    if (row.name.toLowerCase() === normalizedName) return true;
    const aliases = normalizeAliases(row.aliases);
    if (aliases.some((alias) => alias.toLowerCase() === normalizedName)) return true;
    const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
    return Boolean(sourceAssetId && metadata.sourceAssetId === sourceAssetId);
  });
}

function buildMetadata(type: StoryAssetType, draft: ImportAssetDraft, previous?: AssetRow | null) {
  const previousMetadata = parseJson<Record<string, unknown>>(previous?.metadata, {});
  const incomingSourceAssetId = draft.assetId && draft.assetId !== previous?.id
    ? draft.assetId
    : "";
  const role = cleanText(draft.role);
  const isUnnamedCharacterRole = type === "character" && /无名配角|群体角色/.test(role);
  return {
    ...previousMetadata,
    standardVersion: "asset_library_standard_v1",
    lifecycleStage: draft.confirmed ? "approved_draft" : "draft_needs_review",
    sourceAssetId: incomingSourceAssetId || previousMetadata.sourceAssetId || draft.assetId || "",
    category: draft.category || previousMetadata.category || type,
    role: draft.role || previousMetadata.role || "",
    roleKey: isUnnamedCharacterRole ? "" : draft.roleKey || previousMetadata.roleKey || "",
    scope: draft.scope || previousMetadata.scope || "",
    frequency: Number(draft.frequency ?? previousMetadata.frequency ?? 0),
    episodes: draft.episodes || previousMetadata.episodes || [],
    prompt: draft.prompt || previousMetadata.prompt || "",
    negativePrompt: draft.negativePrompt || previousMetadata.negativePrompt || "",
    promptMetadata: draft.promptMetadata || previousMetadata.promptMetadata || null,
    styleSpec: draft.styleSpec || previousMetadata.styleSpec || null,
    visualSchema: draft.visualSchema || previousMetadata.visualSchema || null,
    variants: draft.variants || previousMetadata.variants || [],
    imageHistory: draft.history || previousMetadata.imageHistory || [],
    mainImageName: draft.mainImageName || previousMetadata.mainImageName || "",
    tags: draft.tags || previousMetadata.tags || [],
    faceTemplate: isUnnamedCharacterRole ? null : draft.faceTemplate || previousMetadata.faceTemplate || null,
    importanceLabel: importanceLabel(importanceScore(undefined, draft)),
    review: {
      confirmed: Boolean(draft.confirmed),
      requiredBeforeLock: true,
      checklist: asRecord(draft.promptMetadata).checklist || previousMetadata.review && asRecord(previousMetadata.review).checklist || null,
    },
  };
}

async function syncSubtypeRow(
  assetId: string,
  type: StoryAssetType,
  draft: ImportAssetDraft,
  links?: { characterIdByName?: Map<string, string> },
) {
  if (type === "character") {
    const characterId = links?.characterIdByName?.get(normalizeName(draft.name).toLowerCase()) ?? null;
    await db
      .insert(characterAssets)
      .values({
        assetId,
        characterId,
        roleName: draft.role || draft.scope || "",
        costume: draft.visualHint || "",
        relationshipNotes: Array.isArray(draft.episodes) ? draft.episodes.join(", ") : "",
      })
      .onConflictDoUpdate({
        target: characterAssets.assetId,
        set: {
          characterId,
          roleName: draft.role || draft.scope || "",
          costume: draft.visualHint || "",
          relationshipNotes: Array.isArray(draft.episodes) ? draft.episodes.join(", ") : "",
        },
      });
    return;
  }

  if (type === "scene") {
    await db
      .insert(sceneAssets)
      .values({
        assetId,
        locationType: draft.role || draft.category || "",
        lighting: draft.visualHint || "",
        layout: draft.description || "",
      })
      .onConflictDoUpdate({
        target: sceneAssets.assetId,
        set: {
          locationType: draft.role || draft.category || "",
          lighting: draft.visualHint || "",
          layout: draft.description || "",
        },
      });
    return;
  }

  await db
    .insert(propAssets)
    .values({
      assetId,
      propCategory: draft.role || draft.category || "",
      state: draft.visualHint || "",
      usageRules: draft.description || "",
    })
    .onConflictDoUpdate({
      target: propAssets.assetId,
      set: {
        propCategory: draft.role || draft.category || "",
        state: draft.visualHint || "",
        usageRules: draft.description || "",
      },
    });
}

export async function upsertStoryAsset(
  projectId: string,
  type: StoryAssetType,
  draft: ImportAssetDraft,
  links?: { characterIdByName?: Map<string, string> },
) {
  ensureAssetLibraryTables();
  ensureStoryPipelineTables();

  const standardizedDraft = standardizeImportAssetDraft(type, draft);
  const name = normalizeName(standardizedDraft.name);
  if (!name) return null;

  const existing = await findExistingAsset(projectId, type, name, standardizedDraft.assetId);
  const now = new Date();
  const score = importanceScore(undefined, standardizedDraft);
  const metadata = buildMetadata(type, standardizedDraft, existing);
  const values = {
    projectId,
    type,
    name,
    aliases: jsonString(normalizeAliases(standardizedDraft.aliases)),
    importance: score,
    description: cleanText(standardizedDraft.description),
    visualConstraints: cleanText(standardizedDraft.visualConstraints || standardizedDraft.visualHint || standardizedDraft.description),
    negativeConstraints: cleanText(standardizedDraft.negativePrompt),
    firstAppearance: Array.isArray(standardizedDraft.episodes) ? standardizedDraft.episodes[0] ?? "" : "",
    confirmed: standardizedDraft.confirmed ? 1 : existing?.confirmed ?? 0,
    referenceImage: standardizedDraft.imageUrl || existing?.referenceImage || null,
    metadata,
    updatedAt: now,
  };

  let record: AssetRow;
  if (existing) {
    [record] = await db
      .update(assets)
      .set({
        ...values,
        version: (existing.version ?? 1) + 1,
      })
      .where(eq(assets.id, existing.id))
      .returning();
  } else {
    [record] = await db
      .insert(assets)
      .values({
        id: genId(),
        ...values,
        createdAt: now,
      })
      .returning();
  }

  await syncSubtypeRow(record.id, type, standardizedDraft, links);
  const candidate = await createResolvedCandidate(projectId, type, standardizedDraft, record.id);
  const occurrence = await createAssetOccurrence(projectId, record.id, standardizedDraft, candidate.id);
  await syncAssetVariants(projectId, type, record.id, standardizedDraft, {
    candidateId: candidate.id,
    occurrenceId: occurrence.id,
  });
  return record;
}

export async function syncImportAssets(
  projectId: string,
  input: {
    characters?: ImportAssetDraft[];
    items?: ImportAssetDraft[];
    environments?: ImportAssetDraft[];
  },
  links?: { characterIdByName?: Map<string, string> },
) {
  const normalizedInput = normalizeImportAssetsForSync(input);
  const created: AssetRow[] = [];
  for (const draft of normalizedInput.characters) {
    const row = await upsertStoryAsset(projectId, "character", draft, links);
    if (row) created.push(row);
  }
  for (const draft of normalizedInput.items) {
    const row = await upsertStoryAsset(projectId, "prop", draft, links);
    if (row) created.push(row);
  }
  for (const draft of normalizedInput.environments) {
    const row = await upsertStoryAsset(projectId, "scene", draft, links);
    if (row) created.push(row);
  }
  return created;
}

export async function pruneStaleImportDraftAssets(
  projectId: string,
  keepAssetIds: Set<string>,
  types: StoryAssetType[] = ["character", "scene", "prop"],
) {
  ensureAssetLibraryTables();
  ensureStoryPipelineTables();

  const rows = await db
    .select()
    .from(assets)
    .where(eq(assets.projectId, projectId))
    .orderBy(asc(assets.createdAt));
  let deletedCount = 0;
  for (const row of rows) {
    if (!types.includes(row.type)) continue;
    if (keepAssetIds.has(row.id)) continue;
    if (row.confirmed === 1 || row.referenceImage) continue;
    const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
    const sourceAssetId = String(metadata.sourceAssetId || "");
    if (!/^(char|prop|scene)_/.test(sourceAssetId)) continue;
    await db.delete(assets).where(eq(assets.id, row.id));
    deletedCount += 1;
  }
  return deletedCount;
}

export async function listProjectAssets(projectId: string, type?: StoryAssetType) {
  ensureAssetLibraryTables();
  ensureStoryPipelineTables();

  const rows = type
    ? await db
        .select()
        .from(assets)
        .where(and(eq(assets.projectId, projectId), eq(assets.type, type)))
        .orderBy(asc(assets.type), desc(assets.importance), asc(assets.name))
    : await db
        .select()
        .from(assets)
        .where(eq(assets.projectId, projectId))
        .orderBy(asc(assets.type), desc(assets.importance), asc(assets.name));

  return Promise.all(rows.map(enrichAsset));
}

async function enrichAsset(row: AssetRow) {
  let sourceRows = await db
    .select()
    .from(assetOccurrences)
    .where(eq(assetOccurrences.assetId, row.id))
    .orderBy(asc(assetOccurrences.createdAt));
  if (sourceRows.length === 0) {
    await createAssetOccurrence(row.projectId, row.id, {
      name: row.name,
      description: row.description,
      prompt: row.visualConstraints,
      negativePrompt: row.negativeConstraints,
      imageUrl: row.referenceImage ?? undefined,
      confirmed: Boolean(row.confirmed),
    });
    sourceRows = await db
      .select()
      .from(assetOccurrences)
      .where(eq(assetOccurrences.assetId, row.id))
      .orderBy(asc(assetOccurrences.createdAt));
  }

  let variantRows = await db
    .select()
    .from(assetVariants)
    .where(eq(assetVariants.assetId, row.id))
    .orderBy(asc(assetVariants.createdAt));
  if (variantRows.length === 0) {
    variantRows = await syncAssetVariants(row.projectId, row.type, row.id, {
      name: row.name,
      aliases: row.aliases,
      description: row.description,
      prompt: row.visualConstraints,
      negativePrompt: row.negativeConstraints,
      imageUrl: row.referenceImage ?? undefined,
      confirmed: Boolean(row.confirmed),
    }, {
      occurrenceId: sourceRows[0]?.id,
    });
  }
  const base = {
    ...row,
    aliases: normalizeAliases(row.aliases),
    importanceLabel: importanceLabel(row.importance ?? 0),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    variants: variantRows,
    sources: sourceRows,
  };

  if (row.type === "character") {
    const [detail] = await db
      .select()
      .from(characterAssets)
      .where(eq(characterAssets.assetId, row.id));
    return { ...base, detail };
  }
  if (row.type === "scene") {
    const [detail] = await db
      .select()
      .from(sceneAssets)
      .where(eq(sceneAssets.assetId, row.id));
    return { ...base, detail };
  }
  const [detail] = await db
    .select()
    .from(propAssets)
    .where(eq(propAssets.assetId, row.id));
  return { ...base, detail };
}

export async function assertAssetInProject(projectId: string, assetId: string) {
  ensureAssetLibraryTables();
  ensureStoryPipelineTables();

  const [row] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)));
  return row ?? null;
}

export async function getProjectAsset(projectId: string, assetId: string) {
  ensureAssetLibraryTables();
  ensureStoryPipelineTables();

  const row = await assertAssetInProject(projectId, assetId);
  return row ? enrichAsset(row) : null;
}

export async function patchStoryAsset(projectId: string, assetId: string, patch: StoryAssetPatch) {
  ensureAssetLibraryTables();
  ensureStoryPipelineTables();

  const existing = await assertAssetInProject(projectId, assetId);
  if (!existing) return null;

  const existingMetadata = parseJson<Record<string, unknown>>(existing.metadata, {});
  const metadata = patch.metadata === undefined
    ? existingMetadata
    : { ...existingMetadata, ...patch.metadata };

  const [updated] = await db
    .update(assets)
    .set({
      ...(patch.name !== undefined && { name: normalizeName(patch.name) }),
      ...(patch.aliases !== undefined && { aliases: jsonString(normalizeAliases(patch.aliases)) }),
      ...(patch.importance !== undefined && { importance: importanceScore(patch.importance) }),
      ...(patch.description !== undefined && { description: cleanText(patch.description) }),
      ...(patch.visualConstraints !== undefined && { visualConstraints: cleanText(patch.visualConstraints) }),
      ...(patch.negativeConstraints !== undefined && { negativeConstraints: cleanText(patch.negativeConstraints) }),
      ...(patch.firstAppearance !== undefined && { firstAppearance: cleanText(patch.firstAppearance) }),
      ...(patch.confirmed !== undefined && { confirmed: patch.confirmed ? 1 : 0 }),
      ...(patch.referenceImage !== undefined && { referenceImage: patch.referenceImage }),
      ...(patch.metadata !== undefined && { metadata }),
      version: (existing.version ?? 1) + 1,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId))
    .returning();

  if (updated.type === "character" && patch.character) {
    await db
      .insert(characterAssets)
      .values({ assetId, ...patch.character })
      .onConflictDoUpdate({ target: characterAssets.assetId, set: patch.character });
  } else if (updated.type === "scene" && patch.scene) {
    await db
      .insert(sceneAssets)
      .values({ assetId, ...patch.scene })
      .onConflictDoUpdate({ target: sceneAssets.assetId, set: patch.scene });
  } else if (updated.type === "prop" && patch.prop) {
    await db
      .insert(propAssets)
      .values({ assetId, ...patch.prop })
      .onConflictDoUpdate({ target: propAssets.assetId, set: patch.prop });
  }

  if (patch.variants !== undefined) {
    await syncAssetVariants(projectId, updated.type, updated.id, {
      name: updated.name,
      aliases: updated.aliases,
      description: updated.description,
      prompt: updated.visualConstraints,
      negativePrompt: updated.negativeConstraints,
      imageUrl: updated.referenceImage ?? undefined,
      confirmed: Boolean(updated.confirmed),
      variants: patch.variants,
    });
  }

  return enrichAsset(updated);
}

export async function deleteStoryAsset(projectId: string, assetId: string) {
  ensureAssetLibraryTables();
  ensureStoryPipelineTables();

  const existing = await assertAssetInProject(projectId, assetId);
  if (!existing) return false;
  await db.delete(assets).where(eq(assets.id, assetId));
  return true;
}

export async function findCharacterIdByName(projectId: string) {
  const rows = await db.select().from(characters).where(eq(characters.projectId, projectId));
  return new Map(rows.map((row) => [row.name.toLowerCase().trim(), row.id]));
}

export { typeFromTab };
