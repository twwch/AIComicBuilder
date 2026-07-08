"use client";

import { useEffect, useState, useCallback, useRef, use, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Upload, FileText, Users, Layers, Sparkles,
  Loader2, Check, X, ArrowLeft, AlertCircle,
  ImageIcon, Images, Plus, ChevronDown, History, Download,
  Pencil, Maximize2, Trash2, Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
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
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { toast } from "sonner";

const ACCEPTED = ".txt,.docx,.pdf,.md,.markdown";
const MAX_SIZE = 20 * 1024 * 1024;

interface ExtractedCharacter {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
  visualConstraints?: string;
  background?: string;
  scope: "main" | "guest";
  confirmed?: boolean;
  assetId?: string;
  role?: string;
  roleKey?: string;
  episodes?: string[];
  prompt?: string;
  negativePrompt?: string;
  variants?: AssetVariant[];
  imageUrl?: string;
  audioUrl?: string;
  history?: Array<Record<string, unknown>>;
  mainImageName?: string;
  editInstruction?: string;
  tags?: string[];
  faceTemplate?: { label?: string; url?: string; note?: string } | null;
  promptMetadata?: Record<string, unknown>;
  visualSchema?: AssetVisualSchema | null;
  styleSpec?: AssetStyleSpec | null;
}

interface AssetVariant {
  id?: string;
  name: string;
  variantType?: string;
  description?: string;
  prompt?: string;
  imageUrl?: string;
  history?: Array<Record<string, unknown>>;
  editInstruction?: string;
}

interface ExtractedAsset {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
  visualConstraints?: string;
  background?: string;
  confirmed?: boolean;
  assetId?: string;
  category?: string;
  role?: string;
  roleKey?: string;
  episodes?: string[];
  prompt?: string;
  negativePrompt?: string;
  variants?: AssetVariant[];
  imageUrl?: string;
  audioUrl?: string;
  history?: Array<Record<string, unknown>>;
  mainImageName?: string;
  editInstruction?: string;
  tags?: string[];
  faceTemplate?: { label?: string; url?: string; note?: string } | null;
  promptMetadata?: Record<string, unknown>;
  visualSchema?: AssetVisualSchema | null;
  styleSpec?: AssetStyleSpec | null;
}

interface IntakeJobStatus {
  status: "queued" | "running" | "awaiting_review" | "confirmed" | "failed" | "cancelled";
  progress: number;
  current_stage: string;
  candidate_text?: string;
  error_message?: string;
  confirmed_script_version_id?: string;
  story_analysis?: StoryAssetAnalysis | null;
  issue_summary?: {
    total?: number;
    high?: number;
    medium?: number;
    low?: number;
  };
  stages?: Array<{
    stage: string;
    sequence: number;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    issues?: Array<{
      stage?: string;
      severity?: "high" | "medium" | "low";
      category?: string;
      message?: string;
      text?: string;
      suggestion?: string;
      lineNumber?: number;
      episodeTitle?: string;
      sceneTitle?: string;
      context?: string;
    }>;
    result?: unknown;
    error_message?: string;
  }>;
}

function isActiveIntakeStatus(status?: IntakeJobStatus | null) {
  return status?.status === "queued" || status?.status === "running";
}

type AssetTab = "characters" | "items" | "environments" | "voices";
type WorkbenchAsset = ExtractedAsset & { scope?: "main" | "guest" };
type SyncedProjectAsset = {
  id: string;
  type: "character" | "prop" | "scene" | string;
  name: string;
  metadata?: Record<string, unknown>;
};
type StepStatus = Record<Step, "idle" | "running" | "done" | "error">;

const CHARACTER_FACE_TEMPLATES: Record<string, NonNullable<ExtractedCharacter["faceTemplate"]>> = {
  maleLead: {
    label: "男主角真人模板",
    url: "/templates/male-lead-template.jpg",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态，禁止漫画风、二次元和插画感。",
  },
  femaleLead: {
    label: "女主角真人模板",
    url: "/templates/female-lead-template.png",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态，禁止漫画风、二次元和插画感。",
  },
  maleSupport: {
    label: "男配角真人模板",
    url: "/templates/male-support-template.png",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态，禁止漫画风、二次元和插画感。",
  },
  femaleSupport: {
    label: "女配角真人模板",
    url: "/templates/female-support-template.png",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态，禁止漫画风、二次元和插画感。",
  },
};

const PROMPT_OVERALL_AESTHETIC = "真人实拍摄影质感，自然皮肤毛孔与织物纹理，影棚级光影，35mm 胶片质地。";
function normalizeImportedCharacters(characters: ExtractedCharacter[], projectStyleGuide = "") {
  return characters.map((character) => normalizeImportedCharacter(character, projectStyleGuide));
}

function normalizeImportedItems(items: ExtractedAsset[], projectStyleGuide = "") {
  return items.map((item) => normalizeImportedItem(item, projectStyleGuide));
}

function normalizeImportedEnvironments(environments: ExtractedAsset[], projectStyleGuide = "") {
  return environments.map((environment) => normalizeImportedEnvironment(environment, projectStyleGuide));
}

function normalizeImportedItem(item: ExtractedAsset, projectStyleGuide = ""): ExtractedAsset {
  const compiledPrompt = compileImportAssetPrompt("prop", item, projectStyleGuide);
  const displayPrompt = resolveDisplayAssetPrompt(
    item.prompt,
    compiledPrompt.displayPrompt || buildItemPromptTemplate(item, projectStyleGuide),
  );
  return {
    ...item,
    prompt: displayPrompt,
    negativePrompt: compiledPrompt.negativePrompt || item.negativePrompt,
    promptMetadata: mergePromptMetadata(item.promptMetadata, compiledPrompt),
  };
}

function normalizeImportedEnvironment(environment: ExtractedAsset, projectStyleGuide = ""): ExtractedAsset {
  const compiledPrompt = compileImportAssetPrompt("scene", environment, projectStyleGuide);
  const displayPrompt = resolveDisplayAssetPrompt(
    environment.prompt,
    compiledPrompt.displayPrompt || buildEnvironmentPromptTemplate(environment, projectStyleGuide),
  );
  return {
    ...environment,
    prompt: displayPrompt,
    negativePrompt: compiledPrompt.negativePrompt || environment.negativePrompt,
    promptMetadata: mergePromptMetadata(environment.promptMetadata, compiledPrompt),
  };
}

function normalizeImportedCharacter(character: ExtractedCharacter, projectStyleGuide = ""): ExtractedCharacter {
  const roleKey = inferCharacterRoleKey(character);
  const faceTemplate = CHARACTER_FACE_TEMPLATES[roleKey] || character.faceTemplate || null;
  const profile = sanitizeCharacterProfile(character);
  const background = buildCharacterBackground(character, profile);
  const variants = character.variants?.length
    ? character.variants
    : buildExpectedCharacterVariants(character, faceTemplate, profile);
  const visualConstraints = ensureCharacterVisualConstraints(character, faceTemplate, roleKey);
  const compiledPrompt = compileImportAssetPrompt(
    "character",
    { ...character, description: profile, background, visualConstraints, roleKey, faceTemplate },
    projectStyleGuide,
  );
  const displayPrompt = resolveDisplayAssetPrompt(
    character.prompt,
    compiledPrompt.displayPrompt || buildCharacterPromptTemplate({ ...character, roleKey, faceTemplate }, profile, background, visualConstraints, projectStyleGuide),
  );

  return {
    ...character,
    description: profile,
    background,
    roleKey,
    faceTemplate,
    visualConstraints,
    prompt: displayPrompt,
    negativePrompt: compiledPrompt.negativePrompt || character.negativePrompt,
    promptMetadata: mergePromptMetadata(character.promptMetadata, compiledPrompt),
    variants,
  };
}

function compileImportAssetPrompt(
  assetType: AssetPromptType,
  asset: WorkbenchAsset,
  projectStyleGuide = "",
) {
  const existingPrompt = String(asset.prompt || "").trim();
  const sourcePrompt = isCompiledEnglishAssetPrompt(existingPrompt) || isLegacyAssetPrompt(existingPrompt) || shouldRebuildAssetDisplayPrompt(existingPrompt)
    ? ""
    : existingPrompt;

  const styleSpec = buildImportAssetStyleSpec(asset, projectStyleGuide);
  const built = buildAssetImagePrompt({
    asset: {
      id: asset.assetId || asset.name || "",
      type: assetType,
      name: asset.name || "asset",
      role: asset.role || asset.category || asset.scope || "",
      category: asset.category || (assetType === "character" ? "characters" : assetType === "prop" ? "items" : "environments"),
      prompt: sourcePrompt,
      description: asset.description || "",
      visualHint: asset.visualHint || "",
      visualConstraints: asset.visualConstraints || "",
      negativeConstraints: asset.negativePrompt || "",
      tags: [
        ...(asset.tags || []),
        asset.role || "",
        asset.roleKey || "",
        asset.scope || "",
      ].filter(Boolean),
      faceTemplate: asset.faceTemplate || null,
      visualSchema: asset.visualSchema || null,
    },
    variant: null,
    visualSpec: defaultAssetVisualSpec(assetType, assetType === "character" ? "1536x1024" : "1536x1024"),
    styleSpec,
  });

  return {
    prompt: built.compiled_final_prompt || existingPrompt,
    negativePrompt: built.compiled_negative_prompt || asset.negativePrompt || "",
    compilerInput: built.compiler_input,
    compilerIR: built.compiler_ir,
    validationReport: built.validation_report,
    compiledFinalPrompt: built.compiled_final_prompt,
    compiledNegativePrompt: built.compiled_negative_prompt,
    compiledDisplayPrompt: built.compiled_display_prompt,
    displayPrompt: built.compiled_display_prompt,
  };
}

function resolveDisplayAssetPrompt(prompt: unknown, fallback: string) {
  const existingPrompt = String(prompt || "").trim();
  if (shouldPreferCompiledDisplayPrompt(existingPrompt, fallback)) return fallback;
  return existingPrompt;
}

function mergePromptMetadata(
  metadata: Record<string, unknown> | undefined,
  compiled: ReturnType<typeof compileImportAssetPrompt>,
): Record<string, unknown> {
  return {
    ...(metadata || {}),
    displayPromptLanguage: "zh",
    generationPromptLanguage: "en_structured",
    promptBuilder: "asset_prompt_compiler_v2",
    compilerInput: compiled.compilerInput,
    compilerIR: compiled.compilerIR,
    compiledFinalPrompt: compiled.compiledFinalPrompt,
    compiledNegativePrompt: compiled.compiledNegativePrompt,
    compiledDisplayPrompt: compiled.compiledDisplayPrompt,
    validationReport: compiled.validationReport,
  };
}

function isCompiledEnglishAssetPrompt(prompt: string) {
  return /Asset reference sheet|Reusable prop asset reference|Reusable empty scene environment reference/i.test(prompt)
    && !isLegacyAssetPrompt(prompt);
}

function isLegacyAssetPrompt(prompt: string) {
  return /【整体美学】|【画面规格】|【角色档案】|【职业与画风锚点】|【模板锁定】|【排除项】/.test(prompt);
}

function buildImportAssetStyleSpec(asset: WorkbenchAsset, projectStyleGuide = ""): AssetStyleSpec {
  const incoming = asRecord(asset.styleSpec);
  const visualSchema = asRecord(asset.visualSchema);
  const visualConstraints = asRecord(visualSchema.constraints);
  const promptMetadata = asRecord(asset.promptMetadata);
  const compilerIR = asRecord(promptMetadata.compilerIR);
  const compilerConstraints = asRecord(compilerIR.constraints);
  const compilerInput = asRecord(promptMetadata.compilerInput);
  const compilerStyleSpec = asRecord(compilerInput.style_spec);
  const era = detectEraConstraint([
    readRecordString(incoming, "era"),
    readRecordString(incoming, "eraConstraint"),
    readRecordString(visualConstraints, "era"),
    readRecordString(compilerConstraints, "era"),
    readRecordString(compilerStyleSpec, "eraConstraint"),
    readRecordString(compilerStyleSpec, "era"),
    promptMetadata.compiledFinalPrompt,
    promptMetadata.compiledDisplayPrompt,
    projectStyleGuide,
    asset.description,
    asset.visualHint,
    asset.visualConstraints,
    asset.background,
    asset.prompt,
    ...(asset.tags || []),
  ]);
  return {
    ...defaultAssetStyleSpec(),
    ...compilerStyleSpec,
    ...incoming,
    ...(era ? { era, eraConstraint: era } : {}),
  };
}

function detectEraConstraint(values: unknown[]) {
  const text = values.map((value) => String(value || "")).filter(Boolean).join(" ");
  const explicitYear = text.match(/(19[0-9]{2}|20[0-9]{2})\s*(?:年|s)?/i);
  if (explicitYear) return `${explicitYear[1]} China`;
  if (/八十年代|八零年代|80年代|1980s|1980年代/i.test(text)) return "1980s China";
  if (/七十年代|70年代|1970s|1970年代/i.test(text)) return "1970s China";
  if (/九十年代|90年代|1990s|1990年代/i.test(text)) return "1990s China";
  if (/民国|军阀|谍战|抗战/.test(text)) return "Republican-era China";
  if (/古代|古装|仙侠|武侠|宫廷|汉服/.test(text)) return "historical China";
  return "";
}

function readRecordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function inferCharacterRoleKey(character: ExtractedCharacter) {
  const key = String(character.roleKey || "");
  const text = `${character.name || ""} ${character.role || ""} ${(character.tags || []).join(" ")} ${character.description || ""}`;
  if (/男主/.test(text)) return "maleLead";
  if (/女主/.test(text)) return "femaleLead";
  if (/男配/.test(text)) return "maleSupport";
  if (/女配/.test(text)) return "femaleSupport";
  if (/主角/.test(text) && /男性|男人|男/.test(text)) return "maleLead";
  if (/主角/.test(text) && /女性|女人|女/.test(text)) return "femaleLead";
  if (/(配角|反派)/.test(text) && /男性|男人|男/.test(text)) return "maleSupport";
  if (/(配角|反派)/.test(text) && /女性|女人|女/.test(text)) return "femaleSupport";
  if (CHARACTER_FACE_TEMPLATES[key]) return key;
  return key;
}

function ensureCharacterVisualConstraints(
  character: ExtractedCharacter,
  faceTemplate: ExtractedCharacter["faceTemplate"],
  roleKey: string,
) {
  const gender = inferCharacterGenderConstraint(character, roleKey);
  const lock = faceTemplate
    ? `${faceTemplate.label}：${faceTemplate.note}`
    : "角色主图与全部变体必须保持同一人物脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致。";
  return [
    lock,
    gender,
    "真人实拍摄影质感，自然皮肤纹理，不要漫画风、二次元、插画风、夸张美型或换脸感。",
  ].filter(Boolean).join("；");
}

function buildProjectStyleGuide(storyAnalysis?: StoryAssetAnalysis | null, sourceText = "") {
  const meta = storyAnalysis?.storyMeta;
  const seed = [
    meta?.visualStyleBase,
    meta?.genre,
    meta?.background,
    meta?.locationBackground,
    meta?.time,
    sourceText.slice(0, 500),
  ].filter(Boolean).join("，");
  if (/古装|宫廷|权谋|武侠|仙侠|玄幻|修仙|江湖/.test(seed)) {
    return "整体画风：古装写实影视画风，东方古代服饰、建筑、器物、光影与色彩保持统一。";
  }
  if (/末世|废土|丧尸|灾变|避难所|重卡|荒凉|末日/.test(seed)) {
    return "整体画风：末世废土写实画风，荒凉废墟、钢铁载具、冷酷战斗、生存压迫感保持统一。";
  }
  if (/民国|年代|军阀|谍战|抗战/.test(seed)) {
    return "整体画风：年代写实影视画风，服装、建筑、道具、色彩和光影保持时代质感统一。";
  }
  if (/校园|青春|学生|学校/.test(seed)) {
    return "整体画风：青春校园写实画风，人物、场景、服装和道具保持清爽真实的校园质感。";
  }
  if (/都市|豪门|总裁|职场|商业|婚恋/.test(seed)) {
    return "整体画风：都市短剧写实画风，人物造型、室内外空间和物品质感保持现代真实。";
  }
  return "整体画风：真人短剧写实画风，角色、场景、物品保持同一剧本世界观和视觉风格。";
}

function joinPromptSections(sections: Array<[string, string | string[]]>) {
  return sections
    .map(([title, content]) => {
      const body = (Array.isArray(content) ? content : [content])
        .map((line) => String(line || "").trim())
        .filter(Boolean)
        .join("\n");
      return body ? `【${title}】\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildOverallAesthetic(projectStyleGuide = "") {
  return [
    PROMPT_OVERALL_AESTHETIC,
    projectStyleGuide,
  ].filter(Boolean);
}

function extractCharacterSubject(prompt: string) {
  const raw = extractPromptSection(prompt || "", "【角色档案】");
  const subjectLine = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("主体：") || line.startsWith("主体:"));
  return (subjectLine ? subjectLine.replace(/^主体[:：]\s*/, "") : raw.split(/\n+/)[0] || "").trim();
}

function extractCharacterBackground(prompt: string) {
  return extractPromptSection(prompt || "", "【角色背景说明】")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("\n");
}

function buildCharacterBackground(character: ExtractedCharacter, profile: string) {
  const source = character.background || extractCharacterBackground(character.prompt || "") || character.visualHint || profile;
  return normalizeTwoLineBackground(source, character.name || "角色");
}

function buildCharacterProfileSummary(character: ExtractedCharacter, profile: string, background: string) {
  const name = character.name || "角色";
  const role = character.role || "角色";
  const sourceLines = [
    profile,
    ...String(background || "").split(/\n+/),
  ]
    .map((line) => cleanPromptSentence(line))
    .filter(Boolean);
  const first = shortenPromptLine(
    sourceLines[0] || `${name}是剧本中的${role}，承担清晰的人物定位。`,
    72,
  );
  const second = shortenPromptLine(
    sourceLines[1] || `${name}的主要剧情围绕身份选择、人物关系和关键冲突展开。`,
    72,
  );
  const third = shortenPromptLine(
    sourceLines.slice(2).join("") || `${name}在剧情推进、情绪转折和阵营关系中承担重要作用。`,
    72,
  );
  return [first, second, third].join("\n");
}

function cleanPromptSentence(text: string) {
  return String(text || "")
    .replace(/^主体[:：]\s*/, "")
    .replace(/^[\u4e00-\u9fa5A-Za-z0-9·]{1,12}(?:[（(][^）)]{1,24}[）)])?[：:]\s*/g, "")
    .replace(/人物[:：][^。！？!?]*/g, "")
    .replace(/【[\s\S]*$/g, "")
    .replace(/模板锁定[:：][\s\S]*$/g, "")
    .replace(/身份约束[:：][\s\S]*$/g, "")
    .replace(/[！？]{2,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shortenPromptLine(text: string, maxLength: number) {
  const value = cleanPromptSentence(text);
  if (!value) return "";
  const compact = value.length > maxLength
    ? value.slice(0, maxLength).replace(/[，,；;：:、][^，,；;：:、]*$/, "")
    : value;
  return ensureChineseSentence(compact);
}

function buildCharacterVisualAnchors(
  character: ExtractedCharacter,
  profile: string,
  background: string,
) {
  const text = `${character.name || ""} ${character.role || ""} ${profile} ${background}`;
  const anchors: string[] = [];
  if (/医生|军医|护士|护工|大夫|医师|医疗官|外科|急救/.test(text)) {
    anchors.push("医疗职业必须可视化：服装、配件和工作状态体现医生、护士或医疗人员身份；可使用白大褂、医疗胸牌、急救包、医用腰包或年代匹配的医疗用品，避免普通棚拍装。");
  }
  if (/重卡|指挥官|车队|队长|战神|救援/.test(text)) {
    anchors.push("指挥/车队身份必须可视化：服装体现末世重卡指挥官或救援队核心身份，可使用战术夹克、工装裤、战术靴、腰挂装备、通讯配件等，不要普通黑衬衫棚拍。");
  }
  if (/工程师|工兵|机械|焊接|维修|工厂|技工/.test(text)) {
    anchors.push("工程职业必须可视化：服装和配件体现机械工程师或工兵身份，可使用耐磨工装、工具腰带、焊接痕迹、机械油污或护具。");
  }
  if (/反派|暴君|城主|军官|武装|势力|黑市|商会|将军|首长/.test(text)) {
    anchors.push("阵营身份必须可视化：服装、配饰和气质体现所属势力、权力层级或黑市/武装背景，避免普通路人造型。");
  }
  anchors.push("整体画风必须落到服装材质、配件磨损、妆发状态、色彩气氛和资产细节；禁止与角色档案无关的普通都市棚拍装。");
  return anchors.slice(0, 3);
}

function buildCharacterPromptTemplate(
  character: ExtractedCharacter,
  profile: string,
  background: string,
  visualConstraints: string,
  projectStyleGuide = "",
) {
  const name = character.name || "角色";
  const faceTemplate = character.faceTemplate;
  const templateLock = faceTemplate
    ? `参考${faceTemplate.label}（${faceTemplate.url || "模板图"}），脸型、五官比例、眉眼鼻唇关系、骨相和面部辨识度必须与模板一致。`
    : "同一角色身份锁定，脸型、五官比例、眉眼鼻唇关系、骨相和面部辨识度必须保持一致。";
  return joinPromptSections([
    ["整体美学", buildOverallAesthetic(projectStyleGuide)],
    ["画面规格", [
      `角色设定图，“${name}”，16:9 横版，纯白背景，平视视角。`,
      "左 40%：3/4 面部近景；右 60%：正面、侧面、背面全身三视图。",
      "单人完整入画，头脚不裁切；服装、发型、配饰、身材比例和肤色保持一致。",
    ]],
    ["角色档案", buildCharacterProfileSummary(character, profile, background)],
    ["职业与画风锚点", buildCharacterVisualAnchors(character, profile, background)],
    ["模板锁定", [
      `${templateLock}只允许改变发型、服装、妆造强弱和剧情状态，不改变脸型与五官。`,
      visualConstraints ? `身份约束：${visualConstraints}` : "",
    ]],
    ["排除项", "无字幕、文字、Logo、水印、UI；无其他人物；不复制身体或同脸分身；禁止漫画风、二次元、插画风。"],
  ]);
}

function normalizeTwoLineBackground(source: string, name: string) {
  const sentences = String(source || "")
    .replace(/【[\s\S]*$/g, "")
    .replace(/主体[:：]/g, "")
    .replace(/模板锁定[:：][\s\S]*$/g, "")
    .replace(/身份约束[:：][\s\S]*$/g, "")
    .replace(/\s+/g, " ")
    .split(/(?<=[。！？!?])/)
    .map((item) => item.trim())
    .filter(Boolean);
  const first = ensureChineseSentence(sentences[0] || `${name}的主要剧情围绕其身份、关键选择和人物关系展开`);
  const second = ensureChineseSentence(sentences.slice(1).join("").slice(0, 90) || `${name}在冲突推进、情绪转折和阵营关系中承担重要叙事作用`);
  return `${first}\n${second}`;
}

function assetTypeLabel(asset: ExtractedAsset, fallback: string) {
  return asset.role || asset.category || asset.tags?.[0] || fallback;
}

function assetPromptDescription(asset: ExtractedAsset, fallback: string) {
  const source = String(asset.description || asset.visualHint || fallback)
    .replace(/\s+/g, " ")
    .trim();
  const polluted = source.length > 150 || /剧名|人设|第\d+集|陆铮|沈念|赵衡/.test(source);
  const base = polluted ? fallback : source;
  const compact = base.length > 120
    ? base.slice(0, 116).replace(/[，,；;：:、][^，,；;：:、]*$/, "")
    : base;
  return ensureChineseSentence(
    compact || fallback,
  );
}

function buildItemPromptTemplate(item: ExtractedAsset, projectStyleGuide = "") {
  const name = item.name || "物品";
  const type = assetTypeLabel(item, "剧情道具");
  const description = assetPromptDescription(item, `${name}是剧本中的${type}，需要清晰展示外观、材质、颜色、尺寸比例和显著标记。`);
  return joinPromptSections([
    ["整体美学", buildOverallAesthetic(projectStyleGuide)],
    ["画面规格", `物品参考图，“${name}”。单个物品，居中构图，纯白背景，正面视角，完整展示全貌与表面质感。`],
    ["物品档案", [
      `类型：${type}。${description}`,
      "突出形状、尺寸、材质、颜色、磨损痕迹和可反复识别的细节。",
      "物品必须与剧本用途和整体画风强相关，功能、材质、使用痕迹和时代/世界观特征要清晰可见。",
    ]],
    ["排除项", "无字幕、文字、Logo、水印；无持握者、手、人物、人影；无背景环境。"],
  ]);
}

function buildEnvironmentPromptTemplate(environment: ExtractedAsset, projectStyleGuide = "") {
  const name = environment.name || "环境";
  const type = assetTypeLabel(environment, "剧情场景");
  const description = assetPromptDescription(environment, `${name}是剧本中的${type}，需要建立稳定的空间结构、环境氛围和主要陈设。`);
  return joinPromptSections([
    ["整体美学", buildOverallAesthetic(projectStyleGuide)],
    ["画面规格", `环境概念图，“${name}”。16:9 宽银幕，大全景，超广角，平视视角，大气透视。`],
    ["环境档案", [
      `空间类型：${type}。${description}`,
      "突出空间尺度、布局、建筑材质、主色调、标志性陈设和光源基调。",
      "环境必须与剧本整体画风强相关，建筑、陈设、磨损、光线和氛围不能变成通用干净场景。",
    ]],
    ["排除项", "无字幕、文字、Logo、水印；无人物、人影、行人、路人。"],
  ]);
}

function buildExpectedCharacterVariants(
  character: ExtractedCharacter,
  faceTemplate: ExtractedCharacter["faceTemplate"],
  profile: string,
) {
  const roleKey = inferCharacterRoleKey(character);
  const oldVariants = character.variants || [];
  const identityText = faceTemplate
    ? `严格参考${faceTemplate.label}，锁定脸型、五官、眉眼鼻唇比例、骨相和面部辨识度；真人实拍质感，禁止漫画风。`
    : "锁定脸型、五官、眉眼鼻唇比例、骨相和面部辨识度；真人实拍质感，禁止漫画风。";
  const name = character.name || "角色";
  const role = character.role || "角色";
  const storyText = `${profile} ${character.visualHint || ""} ${(character.tags || []).join(" ")}`;
  const baseVariants: AssetVariant[] = roleKey === "maleLead" || roleKey === "femaleLead"
    ? buildLeadScenarioVariants(name, storyText, identityText)
    : [{
        name: `${name}备用变体`,
        description: `备用状态：保留${name}作为${role}的角色身份和面部辨识度，仅调整发型、服装、妆造强弱或轻微剧情状态。`,
        prompt: `人物资产变体，${name}，${role}，备用造型，${identityText}`,
      }];

  const normalizedBaseVariants = baseVariants.map((variant, index) => ({
    ...variant,
    id: oldVariants[index]?.id || `${character.assetId || character.name || "character"}-variant-${index + 1}`,
    name: shouldReplaceGeneratedVariantName(oldVariants[index]?.name) ? variant.name : oldVariants[index]?.name || variant.name,
    description: shouldReplaceGeneratedVariantDescription(oldVariants[index]?.description)
      ? variant.description
      : oldVariants[index]?.description || variant.description,
    prompt: shouldReplaceGeneratedVariantPrompt(oldVariants[index]?.prompt)
      ? variant.prompt
      : oldVariants[index]?.prompt || variant.prompt,
    imageUrl: oldVariants[index]?.imageUrl || "",
    history: oldVariants[index]?.history || [],
    editInstruction: oldVariants[index]?.editInstruction || "",
  }));
  const customExtraVariants = oldVariants.slice(baseVariants.length).map((variant, index) => ({
    ...variant,
    id: variant.id || `${character.assetId || character.name || "character"}-custom-variant-${index + 1}`,
    name: variant.name || `${name}自定义变体${index + 1}`,
    description: variant.description || "自定义剧情状态：保持同一人物脸型、五官和辨识度，仅根据当前剧情调整发型、服装、妆造和表情。",
    prompt: variant.prompt || `人物资产变体，${name}，自定义剧情状态，${identityText}`,
    imageUrl: variant.imageUrl || "",
    history: variant.history || [],
    editInstruction: variant.editInstruction || "",
  }));
  return [...normalizedBaseVariants, ...customExtraVariants];
}

function sanitizeCharacterProfile(character: ExtractedCharacter) {
  const promptProfile = shouldRebuildAssetDisplayPrompt(character.prompt)
    ? ""
    : extractCharacterSubject(character.prompt || "");
  const source = promptProfile || character.description || `${character.name || "角色"}是剧本中的${character.role || "角色"}`;
  const cleaned = String(source)
    .replace(/人物：[^。！？!?]*/g, "")
    .replace(/主体[:：]/g, "")
    .replace(/【角色真人模板锁定】[\s\S]*$/g, "")
    .replace(/【整体美学】[\s\S]*$/g, "")
    .replace(/【画面规格】[\s\S]*$/g, "")
    .replace(/【角色背景说明】[\s\S]*$/g, "")
    .replace(/【模板锁定】[\s\S]*$/g, "")
    .replace(/【排除项】[\s\S]*$/g, "")
    .replace(/【视觉约束】[\s\S]*$/g, "")
    .replace(/【主图生成要求】[\s\S]*$/g, "")
    .replace(/【原始生图提示词】[\s\S]*$/g, "")
    .replace(/Asset reference sheet[\s\S]*$/gi, "")
    .replace(/描述呈现。?/g, "")
    .replace(/所有视图保持同一人物[^。！？!?]*[。！？!?]?/g, "")
    .replace(/需要根据整体剧本建立稳定、可复用的个人形象；?/g, "")
    .replace(/资产设定/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeCharacterProfileLength(
    cleaned || `${character.name || "角色"}是剧本中的${character.role || "角色"}`,
    character.name || "角色",
    character.role || "角色",
  );
}

function extractPromptSection(prompt: string, title: string) {
  const start = prompt.indexOf(title);
  if (start < 0) return "";
  const rest = prompt.slice(start + title.length).trim();
  const next = rest.search(/\n【/);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

function inferCharacterGenderConstraint(character: ExtractedCharacter, roleKey: string) {
  if (roleKey === "maleLead" || roleKey === "maleSupport") return "性别识别保持男性，不改变年龄层次和人物辨识度。";
  if (roleKey === "femaleLead" || roleKey === "femaleSupport") return "性别识别保持女性，不改变年龄层次和人物辨识度。";
  const text = `${character.role || ""} ${character.description || ""}`;
  if (/男性|男人|男/.test(text)) return "性别识别保持男性，不改变年龄层次和人物辨识度。";
  if (/女性|女人|女/.test(text)) return "性别识别保持女性，不改变年龄层次和人物辨识度。";
  return "";
}

function normalizeCharacterProfileLength(text: string, name: string, role: string) {
  const sentences = String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[。！？!?])/)
    .map((item) => item.trim())
    .filter(Boolean);
  let profile = sentences.join("");
  if (!profile) profile = `${name}是剧本中的${role}。`;
  if (!profile.startsWith(name)) {
    profile = `${name}是剧本中的${role}。${profile}`;
  }
  if (profile.length > 120) {
    let shortened = "";
    for (const sentence of sentences) {
      if ((shortened + sentence).length > 110) break;
      shortened += sentence;
    }
    profile = shortened || profile.slice(0, 110);
    profile = ensureChineseSentence(profile);
  }
  if (profile.length < 30) {
    profile += `${name}在剧本中承担${role || "角色"}定位，外在状态随剧情变化但核心身份保持稳定。`;
  }
  return ensureChineseSentence(profile);
}

function buildLeadScenarioVariants(name: string, storyText: string, identityText: string): AssetVariant[] {
  const normalized = String(storyText || "");
  const variantSets: Array<{ test: RegExp; items: Array<[string, string, string]> }> = [
    {
      test: /末世|丧尸|重生|系统|物资|车队|堡垒|救援|逃亡|尸潮|废土|战斗/,
      items: [
        ["末世行动状态", "末世行动状态：适合外出搜寻物资、驾驶车辆、穿越危险区域或推进救援任务，服装利落耐磨，发型可略凌乱。", "末世行动状态，外出搜寻物资或推进救援任务，利落耐磨服装，轻微尘土和紧张感"],
        ["战斗戒备状态", "战斗戒备状态：适合遭遇丧尸、敌对幸存者或突发危机，表情警觉，动作蓄势，只增强剧情压力感。", "战斗戒备状态，警觉表情，动作蓄势，危机氛围"],
        ["资源筹备状态", "资源筹备状态：适合整理物资、检查装备、规划路线或做关键决策，服装整洁克制，状态更冷静。", "资源筹备状态，整理装备或规划路线，冷静克制表情"],
        ["受伤疲惫状态", "受伤疲惫状态：适合奔波、受伤、体力透支或撤离后的剧情，只调整妆发凌乱度、气色和服装污损。", "受伤疲惫状态，妆发略乱，气色疲惫，轻微污损"],
        ["高压对峙状态", "高压对峙状态：适合背叛、审问、冲突或关键摊牌，表情更压抑锐利，妆造强度略提升。", "高压对峙状态，压抑锐利表情，冲突或摊牌氛围"],
      ],
    },
    {
      test: /婚礼|婚姻|订婚|豪门|总裁|公司|职场|会议|发布会|商业|办公室/,
      items: [
        ["日常职场状态", "日常职场状态：适合办公室、会议前后或常规沟通，服装干练，表情自然克制。", "日常职场状态，干练通勤服装，自然克制表情"],
        ["正式会面状态", "正式会面状态：适合谈判、发布会、宴会或重要亮相，服装正式，妆造完整但不改变五官。", "正式会面状态，正式服装，完整妆造，重要亮相"],
        ["情绪拉扯状态", "情绪拉扯状态：适合争执、误会、告白或关系转折，表情有情绪张力，妆造略加强。", "情绪拉扯状态，情绪张力，关系转折氛围"],
        ["私下独处状态", "私下独处状态：适合居家、车内、休息室或夜间独处，服装更生活化，情绪更松弛。", "私下独处状态，生活化服装，松弛或沉思表情"],
        ["高光亮相状态", "高光亮相状态：适合婚礼、红毯、宴会或剧情高光，服装更精致，妆造强度提升。", "高光亮相状态，精致服装，剧情高光氛围"],
      ],
    },
    {
      test: /校园|学校|学生|校服|课堂|社团|考试|青春/,
      items: [
        ["校园日常状态", "校园日常状态：适合课堂、走廊、宿舍或校园对白，服装清爽自然，表情生活化。", "校园日常状态，清爽自然服装，生活化表情"],
        ["校服版本", "校服版本：适合上课、集会或校园关键场景，仅替换为剧本指定校服和对应发型。", "校服版本，剧本指定校服，校园场景"],
        ["奔跑追逐状态", "奔跑追逐状态：适合操场、雨中、追赶或突发事件，发型可有轻微动态变化。", "奔跑追逐状态，轻微动态感，校园突发事件"],
        ["低落独处状态", "低落独处状态：适合天台、教室角落或夜间独处，表情压抑，妆造保持自然。", "低落独处状态，压抑情绪，独处氛围"],
        ["青春高光状态", "青春高光状态：适合获奖、告白、舞台或毕业等高光场景，状态更明亮。", "青春高光状态，明亮情绪，校园高光场景"],
      ],
    },
    {
      test: /古代|宫廷|王爷|皇|将军|江湖|仙侠|修仙|宗门|朝堂/,
      items: [
        ["常服对白状态", "常服对白状态：适合日常交谈、府邸或客栈场景，服装相对简洁，表情克制。", "古风常服对白状态，简洁服装，克制表情"],
        ["行动赶路状态", "行动赶路状态：适合江湖行走、追查、赶路或潜入，服装更利落，发型可略有变化。", "行动赶路状态，利落古风服装，轻微动态感"],
        ["朝堂礼服状态", "朝堂礼服状态：适合宫廷、朝堂、仪式或重要会面，服装更正式，妆造完整。", "朝堂礼服状态，正式古风服饰，仪式氛围"],
        ["受伤虚弱状态", "受伤虚弱状态：适合中毒、受伤、战后或病弱剧情，只调整气色、妆发凌乱度和服装破损。", "受伤虚弱状态，气色疲惫，轻微破损"],
        ["对峙爆发状态", "对峙爆发状态：适合决裂、审问、战前或情绪爆发，表情更锋利，服装保持同一体系。", "对峙爆发状态，锋利表情，冲突氛围"],
      ],
    },
  ];
  const selected = variantSets.find((set) => set.test.test(normalized))?.items || [
    ["日常对白状态", "日常对白状态：适合常规对白和生活场景，服装自然，表情克制，保持同一人物脸型五官。", "日常对白状态，生活化服装，自然表情"],
    ["外出行动状态", "外出行动状态：适合移动、调查、赴约或推进剧情，服装更利落，发型可略有变化。", "外出行动状态，利落服装，轻微动态感"],
    ["高压情绪状态", "高压情绪状态：适合冲突、对峙、误会或关键抉择，妆造略加强，表情更有压力。", "高压情绪状态，表情紧绷，妆造略加强"],
    ["疲惫受挫状态", "疲惫受挫状态：适合长时间奔波、受伤、崩溃或失落后的剧情，只改变气色和妆发状态。", "疲惫受挫状态，妆发略乱，气色疲惫"],
    ["高光亮相状态", "高光亮相状态：适合会面、仪式、反转或高光出场，服装更正式，妆造更完整。", "高光亮相状态，正式服装，完整妆造"],
  ];

  return selected.slice(0, 5).map(([suffix, description, promptDetail]) => ({
    name: `${name}${suffix}`,
    description: ensureChineseSentence(description),
    prompt: `人物资产变体，${name}，${promptDetail}，${identityText}`,
  }));
}

function shouldReplaceGeneratedVariantName(value?: string) {
  if (!value?.trim()) return true;
  return /(日常对白状态|外出行动状态|高压情绪状态|受伤疲惫状态|正式亮相状态|疲惫受挫状态|备用变体|制服版本)$/.test(value);
}

function shouldReplaceGeneratedVariantDescription(value?: string) {
  if (!value?.trim()) return true;
  return /^(日常对白状态|外出行动状态|高压情绪状态|受伤疲惫状态|正式亮相状态|备用状态|制服版本)：/.test(value);
}

function shouldReplaceGeneratedVariantPrompt(value?: string) {
  if (!value?.trim()) return true;
  return /^人物资产变体/.test(value);
}

function ensureChineseSentence(text: string) {
  const cleaned = String(text || "").replace(/\s+/g, " ").replace(/\.\.\.|…/g, "").trim();
  if (!cleaned) return "";
  return /[。！？!?]$/.test(cleaned) ? cleaned : `${cleaned}。`;
}

function getAssetKey(asset: WorkbenchAsset, index: number, tab: AssetTab) {
  return asset.assetId || `${tab}:${asset.name}:${index}`;
}

function formatEpisodeRefs(episodes?: string[]) {
  if (!episodes?.length) return "EP1";
  if (episodes.length <= 3) return episodes.join(", ");
  return `${episodes.slice(0, 2).join(", ")} +${episodes.length - 2}`;
}

interface SplitEpisode {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  characters?: string[];
}

interface LogEntry {
  id: string;
  step: number;
  status: "running" | "done" | "error";
  message: string;
  metadata?: unknown;
  createdAt: string | number;
}

interface ImportDraftState {
  currentStep?: number;
  stepStatus?: Partial<Record<Step, "idle" | "running" | "done" | "error">>;
  fullText?: string | null;
  reviewIssues?: StoryReviewIssue[] | null;
  storyAnalysis?: StoryAssetAnalysis | null;
  characters?: ExtractedCharacter[] | null;
  items?: ExtractedAsset[] | null;
  environments?: ExtractedAsset[] | null;
  voices?: ExtractedAsset[] | null;
  relationships?: Array<{ characterA: string; characterB: string; relationType: string; description?: string }> | null;
  episodes?: SplitEpisode[] | null;
  confirmedEpisodeIndexes?: number[] | null;
  enrichmentJobId?: string | null;
  intakeJobId?: string | null;
  confirmedScriptVersionId?: string | null;
  assetLibraryVersionId?: string | null;
}

interface StoryReviewIssue {
  category: "prohibited" | "logic" | "continuity" | "setting" | "other";
  severity: "high" | "medium" | "low";
  title: string;
  exactQuote: string;
  explanation: string;
  suggestion: string;
  replacement: string;
  replaceMode?: "first" | "all";
  applied?: boolean;
  waived?: boolean;
  waiverNote?: string;
  lineNumber?: number;
  episodeTitle?: string;
  sceneTitle?: string;
  context?: string;
}

function categoryFromIntakeIssue(stage: string, category?: string): StoryReviewIssue["category"] {
  const key = `${stage} ${category || ""}`.toLowerCase();
  if (/compliance|risk|symbol|violence|crime|sexual|medical|state|law/.test(key)) return "prohibited";
  if (/continuity/.test(key)) return "continuity";
  if (/setting|era|world/.test(key)) return "setting";
  if (/structure|format|logic/.test(key)) return "logic";
  return "other";
}

function severityFromIntakeIssue(severity?: string): StoryReviewIssue["severity"] {
  if (severity === "high" || severity === "low") return severity;
  return "medium";
}

function intakeIssuesToStoryIssues(status: IntakeJobStatus, sourceText: string): StoryReviewIssue[] {
  const issues = (status.stages || []).flatMap((stage) =>
    (stage.issues || []).map((issue) => {
      const exactQuote = String(issue.text || "").trim();
      const suggestion = String(issue.suggestion || "").trim();
      const hasSourceQuote = exactQuote && sourceText.includes(exactQuote);
      return {
        category: categoryFromIntakeIssue(stage.stage, issue.category),
        severity: severityFromIntakeIssue(issue.severity),
        title: `${stage.stage}: ${issue.category || "review"}`,
        exactQuote,
        explanation: String(issue.message || "需要人工复查"),
        suggestion: suggestion || "请人工复查后确认是否修改。",
        replacement: hasSourceQuote && suggestion ? suggestion : exactQuote,
        replaceMode: "first" as const,
        lineNumber: Number.isFinite(Number(issue.lineNumber)) ? Number(issue.lineNumber) : undefined,
        episodeTitle: String(issue.episodeTitle || ""),
        sceneTitle: String(issue.sceneTitle || ""),
        context: String(issue.context || ""),
      };
    })
  );

  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.title}:${issue.exactQuote}:${issue.explanation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface StoryAssetAnalysis {
  storyMeta?: {
    time?: string;
    background?: string;
    visualStyleBase?: string;
    genre?: string;
    locationBackground?: string;
  };
  assets?: {
    characters?: Array<{ name: string; role?: string; description?: string }>;
    scenes?: Array<{ name: string; type?: string; description?: string }>;
    props?: Array<{ name: string; type?: string; description?: string }>;
  };
}

function storyMetaOnlyAnalysis(analysis?: StoryAssetAnalysis | null): StoryAssetAnalysis | null {
  if (!analysis?.storyMeta) return null;
  return { storyMeta: analysis.storyMeta };
}

function storyAnalysisFromStatus(status?: IntakeJobStatus | null): StoryAssetAnalysis | null {
  return storyMetaOnlyAnalysis(status?.story_analysis ?? null);
}

const REQUIRED_STORY_META_FIELDS: Array<[keyof NonNullable<StoryAssetAnalysis["storyMeta"]>, string]> = [
  ["time", "时间/年代"],
  ["background", "世界观/背景"],
  ["visualStyleBase", "统一视觉风格"],
  ["genre", "题材类型"],
  ["locationBackground", "地域/空间背景"],
];

function missingStoryMetaLabels(analysis?: StoryAssetAnalysis | null) {
  const meta = analysis?.storyMeta || {};
  return REQUIRED_STORY_META_FIELDS
    .filter(([field]) => !String(meta[field] || "").trim())
    .map(([, label]) => label);
}

interface PersistedAssetVariant {
  id?: string;
  name?: string;
  variantType?: string;
  state?: string;
  visualConstraints?: string;
  referenceImage?: string | null;
  metadata?: unknown;
  changedTraits?: unknown;
}

interface PersistedStoryAsset {
  id: string;
  type: "character" | "scene" | "prop";
  name: string;
  importance?: number;
  description?: string;
  visualConstraints?: string;
  negativeConstraints?: string;
  referenceImage?: string | null;
  confirmed?: boolean | number;
  metadata?: unknown;
  variants?: PersistedAssetVariant[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asRecord(parsed);
    } catch {
      return {};
    }
  }
  return {};
}

interface IntakeRevisionSummary {
  stage: string;
  label: string;
  beforeHash: string;
  afterHash: string;
  charDelta: number;
  changedLineCount: number;
  changedSamples: Array<{ lineNumber: number; before: string; after: string }>;
}

const INTAKE_STAGE_LABELS: Record<string, string> = {
  script_visual_enrichment: "视觉细节补全",
  text_compliance_review: "文本合规改写",
};

function shortHash(value: unknown) {
  const text = String(value || "");
  return text ? text.slice(0, 10) : "";
}

function collectIntakeRevisionSummaries(status?: IntakeJobStatus | null): IntakeRevisionSummary[] {
  return (status?.stages || []).flatMap((stage) => {
    const revision = asRecord(asRecord(stage.result).revision);
    if (revision.changed !== true) return [];
    const rawSamples = Array.isArray(revision.changedSamples)
      ? revision.changedSamples
      : Array.isArray(revision.samples) ? revision.samples : [];
    return [{
      stage: stage.stage,
      label: INTAKE_STAGE_LABELS[stage.stage] || stage.stage,
      beforeHash: shortHash(revision.beforeHash),
      afterHash: shortHash(revision.afterHash),
      charDelta: Number(revision.charDelta || 0),
      changedLineCount: Number(revision.changedLineCount || 0),
      changedSamples: rawSamples.map((sample) => {
        const item = asRecord(sample);
        return {
          lineNumber: Number(item.lineNumber || 0),
          before: String(item.before || ""),
          after: String(item.after || ""),
        };
      }).filter((sample) => sample.before || sample.after).slice(0, 3),
    }];
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function persistedVariantToWorkbench(variant: PersistedAssetVariant): AssetVariant {
  const metadata = asRecord(variant.metadata);
  const changedTraits = asRecord(variant.changedTraits);
  return {
    id: String(variant.id || ""),
    name: String(variant.name || "资产变体"),
    variantType: String(variant.variantType || ""),
    description: String(variant.state || variant.visualConstraints || ""),
    prompt: String(changedTraits.prompt || variant.visualConstraints || variant.state || ""),
    imageUrl: String(variant.referenceImage || ""),
    history: Array.isArray(metadata.history) ? metadata.history as Array<Record<string, unknown>> : [],
    editInstruction: String(changedTraits.editInstruction || ""),
  };
}

function persistedAssetToWorkbench(asset: PersistedStoryAsset): WorkbenchAsset {
  const metadata = asRecord(asset.metadata);
  const variants = (asset.variants || [])
    .filter((variant) => {
      const variantType = String((variant as PersistedAssetVariant & { variantType?: string }).variantType || "");
      return variantType !== "default" && variantType !== "base";
    })
    .map(persistedVariantToWorkbench);
  const role = String(metadata.role || metadata.roleKey || "");
  const scope = metadata.scope === "main" || /男主|女主|主角/.test(role) ? "main" as const : "guest" as const;
  const metadataPrompt = String(metadata.prompt || asset.visualConstraints || "");
  return {
    name: asset.name,
    frequency: Number(metadata.frequency ?? asset.importance ?? 1),
    description: asset.description || "",
    visualHint: String(metadata.visualHint || metadata.mainImageName || asset.name),
    visualConstraints: asset.visualConstraints || "",
    confirmed: Boolean(asset.confirmed),
    assetId: asset.id,
    category: String(metadata.category || asset.type),
    role,
    roleKey: String(metadata.roleKey || ""),
    episodes: asStringArray(metadata.episodes),
    prompt: shouldRebuildAssetDisplayPrompt(metadataPrompt) ? asset.visualConstraints || "" : metadataPrompt,
    negativePrompt: asset.negativeConstraints || "",
    variants,
    imageUrl: asset.referenceImage || "",
    history: Array.isArray(metadata.imageHistory) ? metadata.imageHistory as Array<Record<string, unknown>> : [],
    mainImageName: String(metadata.mainImageName || asset.name),
    tags: asStringArray(metadata.tags),
    faceTemplate: metadata.faceTemplate as ExtractedCharacter["faceTemplate"],
    promptMetadata: metadata.promptMetadata as ExtractedCharacter["promptMetadata"],
    scope,
  };
}

interface ScriptEnrichmentPreview {
  patches?: ScriptEnrichmentPatch[];
  enrichedText?: string;
  appliedPatchCount?: number;
  skippedPatchCount?: number;
  stats?: {
    total_beats?: number;
    enriched_beats?: number;
    needs_review?: number;
    invalid?: number;
  };
  validation?: {
    status?: "valid" | "needs_review" | "invalid";
    warnings?: string[];
    errors?: string[];
    accepted_patches?: ScriptEnrichmentPatch[];
  };
}

interface ScriptEnrichmentPatch {
  beat_id?: string;
  original_text?: string;
  enriched_text?: string;
  added_visual_details?: Record<string, unknown>;
  asset_candidates?: Array<{ name?: string; type?: string; importance?: string }>;
  source_type?: string;
  confidence?: number;
}

interface ReviewPreparation {
  text: string;
  visualEnrichment: {
    patches: ScriptEnrichmentPatch[];
    stats?: ScriptEnrichmentPreview["stats"];
    validation?: ScriptEnrichmentPreview["validation"];
  } | null;
}

interface ScriptEnrichmentJobStatus {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  skipped_tasks: number;
  current_episode?: string;
  current_scene?: string;
  error_message?: string;
  enrichedText?: string;
  visualEnrichment?: ReviewPreparation["visualEnrichment"];
  recent_logs?: Array<{
    id: string;
    level: "info" | "warn" | "error";
    message: string;
    created_at: string | number;
  }>;
}

type Step = 1 | 2 | 3 | 4 | 5;
type StepStatusValue = "idle" | "running" | "done" | "error";

const STEP_IDLE_STATUS: Record<Step, StepStatusValue> = {
  1: "idle",
  2: "idle",
  3: "idle",
  4: "idle",
  5: "idle",
};

const SCRIPT_ENRICHMENT_POLL_MS = 2500;

function sanitizePersistedStepStatus(status?: Partial<Record<Step, StepStatusValue>>) {
  const next = { ...STEP_IDLE_STATUS };
  if (!status) return next;
  for (const step of [1, 2, 3, 4, 5] as Step[]) {
    const value = status[step];
    if (!value) continue;
    next[step] = value === "running" ? "idle" : value;
  }
  return next;
}

function mergeStepStatusPreservingDone(
  current: Record<Step, StepStatusValue>,
  incoming: Partial<Record<Step, StepStatusValue>>,
) {
  const next = { ...current };
  for (const step of [1, 2, 3, 4, 5] as Step[]) {
    const value = incoming[step];
    if (!value) continue;
    next[step] = current[step] === "done" ? "done" : value;
  }
  return next;
}

function sanitizeDraftPayload(payload: ImportDraftState): ImportDraftState {
  const stepStatus = sanitizePersistedStepStatus(payload.stepStatus);
  let currentStep = payload.currentStep;
  if (typeof currentStep === "number") {
    if (stepStatus[1] === "done" && currentStep < 2) currentStep = 2;
    if (stepStatus[3] === "done" && currentStep < 3) currentStep = 3;
    if (stepStatus[4] === "done" && currentStep < 4) currentStep = 4;
    if (stepStatus[5] === "done" && currentStep < 5) currentStep = 5;
  }
  return {
    ...payload,
    currentStep,
    stepStatus,
  };
}

const STEPS = [
  { num: 1 as Step, icon: FileText, label: "importStep.parse" },
  { num: 2 as Step, icon: AlertCircle, label: "importStep.review" },
  { num: 3 as Step, icon: Users, label: "importStep.characters" },
  { num: 4 as Step, icon: Layers, label: "importStep.split" },
  { num: 5 as Step, icon: Sparkles, label: "importStep.generate" },
] as const;

export default function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const forceAssetWorkbench = searchParams.get("step") === "assets";
  const t = useTranslations("import");
  const textGuard = useModelGuard("text");
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const localLogSeq = useRef(0);
  const splitRunningRef = useRef(false);
  const draftHydratedRef = useRef(false);
  const skipNextDraftSaveRef = useRef(false);
  const saveDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftPayloadRef = useRef<ImportDraftState | null>(null);
  const hasPendingDraftSaveRef = useRef(false);
  const immediateDraftSaveRef = useRef(false);

  // Pipeline state
  const [currentStep, setCurrentStep] = useState<Step | 0>(0);
  const [stepStatus, setStepStatus] = useState<StepStatus>({
    1: "idle", 2: "idle", 3: "idle", 4: "idle", 5: "idle",
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const storyReviewedRef = useRef(false);
  const enrichedTextRef = useRef("");
  const visualEnrichmentRef = useRef<ReviewPreparation["visualEnrichment"]>(null);
  const detailSupplementedRef = useRef(false);
  const [detailSupplemented, setDetailSupplemented] = useState(false);
  const enrichmentJobIdRef = useRef<string | null>(null);
  const enrichmentStatusRef = useRef<ScriptEnrichmentJobStatus | null>(null);
  const lastEnrichmentTerminalLogRef = useRef<string | null>(null);
  const [enrichmentJobId, setEnrichmentJobId] = useState<string | null>(null);
  const [enrichmentJobStatus, setEnrichmentJobStatus] = useState<ScriptEnrichmentJobStatus | null>(null);
  const [intakeJobId, setIntakeJobId] = useState<string | null>(null);
  const [intakeJobStatus, setIntakeJobStatus] = useState<IntakeJobStatus | null>(null);
  const [confirmedScriptVersionId, setConfirmedScriptVersionId] = useState<string | null>(null);
  const [assetLibraryVersionId, setAssetLibraryVersionId] = useState<string | null>(null);
  const [assetLibraryLocking, setAssetLibraryLocking] = useState(false);
  const intakePollingRef = useRef(false);
  const persistedAssetsHydratedRef = useRef(false);

  // Step 0: Upload
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Step 1 result
  const [fullText, setFullText] = useState("");
  const [reviewIssues, setReviewIssues] = useState<StoryReviewIssue[]>([]);
  const [storyAnalysis, setStoryAnalysis] = useState<StoryAssetAnalysis | null>(null);
  const [selectedIssueIndexes, setSelectedIssueIndexes] = useState<Set<number>>(() => new Set());
  const [activeIssueIndex, setActiveIssueIndex] = useState<number | null>(null);
  const reviewTextRef = useRef<HTMLTextAreaElement>(null);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findMatchIndex, setFindMatchIndex] = useState(0);

  // Step 2 result
  const [characters, setCharacters] = useState<ExtractedCharacter[]>([]);
  const [items, setItems] = useState<ExtractedAsset[]>([]);
  const [environments, setEnvironments] = useState<ExtractedAsset[]>([]);
  const [voices, setVoices] = useState<ExtractedAsset[]>([]);
  const [relationships, setRelationships] = useState<Array<{ characterA: string; characterB: string; relationType: string; description?: string }>>([]);

  // Step 3 result
  const [episodes, setEpisodes] = useState<SplitEpisode[]>([]);
  const [expandedEpisodeIndexes, setExpandedEpisodeIndexes] = useState<Set<number>>(() => new Set());
  const [confirmedEpisodeIndexes, setConfirmedEpisodeIndexes] = useState<Set<number>>(() => new Set());
  const [episodeDeleteIndex, setEpisodeDeleteIndex] = useState<number | null>(null);

  // History mode
  const [historyMode, setHistoryMode] = useState(false);
  const [selectedStep, setSelectedStep] = useState<Step | null>(null);
  const [activeAssetTab, setActiveAssetTab] = useState<AssetTab>("characters");
  const [activeAssetKey, setActiveAssetKey] = useState("");
  const [assetGeneratingTargets, setAssetGeneratingTargets] = useState<string[]>([]);
  const [allMainGenerationProgress, setAllMainGenerationProgress] = useState<{ completed: number; total: number } | null>(null);
  const [assetUploadingTarget, setAssetUploadingTarget] = useState<string | null>(null);
  const [assetEditingTarget, setAssetEditingTarget] = useState<string | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ title: string; imageUrl: string } | null>(null);
  const [historyDialog, setHistoryDialog] = useState<{
    title: string;
    tab: AssetTab;
    assetIndex: number;
    variantIndex?: number;
    entries: Array<Record<string, unknown>>;
  } | null>(null);

  const isAssetGenerating = useCallback(
    (targetKey: string) => assetGeneratingTargets.includes(targetKey),
    [assetGeneratingTargets],
  );
  const hasAssetGenerationInTab = useCallback(
    (tab: AssetTab) => assetGeneratingTargets.some((targetKey) => targetKey.startsWith(`${tab}:`)),
    [assetGeneratingTargets],
  );
  const isAssetGenerationBlocked = useCallback(
    (tab: AssetTab, assetIndex: number, variantIndex?: number) => {
      const targetKey = `${tab}:${assetIndex}:${variantIndex ?? "main"}`;
      return (
        assetGeneratingTargets.includes(targetKey)
        || assetGeneratingTargets.includes(`${tab}:category`)
        || assetGeneratingTargets.includes(`${tab}:${assetIndex}:variants`)
      );
    },
    [assetGeneratingTargets],
  );

  function beginAssetGenerating(targetKey: string) {
    setAssetGeneratingTargets((prev) => prev.includes(targetKey) ? prev : [...prev, targetKey]);
  }

  function endAssetGenerating(targetKey: string) {
    setAssetGeneratingTargets((prev) => prev.filter((item) => item !== targetKey));
  }

  const buildDraftPayload = useCallback((): ImportDraftState => ({
    currentStep,
    stepStatus: sanitizePersistedStepStatus(stepStatus),
    fullText,
    reviewIssues,
    storyAnalysis,
    characters,
    items,
    environments,
    voices,
    relationships,
    episodes,
    confirmedEpisodeIndexes: Array.from(confirmedEpisodeIndexes),
    enrichmentJobId,
    intakeJobId,
    confirmedScriptVersionId,
    assetLibraryVersionId,
  }), [
    currentStep,
    stepStatus,
    fullText,
    reviewIssues,
    storyAnalysis,
    characters,
    items,
    environments,
    voices,
    relationships,
    episodes,
    confirmedEpisodeIndexes,
    enrichmentJobId,
    intakeJobId,
    confirmedScriptVersionId,
    assetLibraryVersionId,
  ]);

  const saveDraft = useCallback(async (payload?: ImportDraftState) => {
    try {
      const draftPayload = sanitizeDraftPayload(payload ?? buildDraftPayload());
      await apiFetch(`/api/projects/${projectId}/import/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftPayload),
      });
      hasPendingDraftSaveRef.current = false;
    } catch (err) {
      console.error("Import draft save error:", err);
    }
  }, [buildDraftPayload, projectId]);

  const flushDraft = useCallback(() => {
    const payload = latestDraftPayloadRef.current;
    if (!payload || !hasPendingDraftSaveRef.current) return;
    const body = JSON.stringify(sanitizeDraftPayload(payload));
    const headers: HeadersInit = { "Content-Type": "application/json" };
    const userId = typeof window !== "undefined" ? localStorage.getItem("ai_comic_uid") : null;
    if (userId) headers["x-user-id"] = userId;

    fetch(`/api/projects/${projectId}/import/state`, {
      method: "PATCH",
      headers,
      body,
      keepalive: body.length < 60000,
    }).catch((err) => {
      console.error("Import draft flush error:", err);
    });
    hasPendingDraftSaveRef.current = false;
  }, [projectId]);

  const resetDraftPayload = useCallback((): ImportDraftState => ({
    currentStep: 0,
    stepStatus: sanitizePersistedStepStatus(),
    fullText: "",
    reviewIssues: [],
    storyAnalysis: null,
    characters: [],
    items: [],
    environments: [],
    voices: [],
    relationships: [],
    episodes: [],
    confirmedEpisodeIndexes: [],
    enrichmentJobId: null,
    intakeJobId: null,
    confirmedScriptVersionId: null,
    assetLibraryVersionId: null,
  }), []);

  const syncReviewFromIntakeStatus = useCallback((status: IntakeJobStatus, options?: { preserveExistingIssues?: boolean }) => {
    const candidateText = status.candidate_text || "";
    const statusStoryAnalysis = storyAnalysisFromStatus(status);
    if (statusStoryAnalysis) setStoryAnalysis(statusStoryAnalysis);
    if (candidateText.trim()) {
      const intakeReviewIssues = intakeIssuesToStoryIssues(status, candidateText);
      setFullText(candidateText);
      setReviewIssues((prev) => options?.preserveExistingIssues && prev.length > 0 ? prev : intakeReviewIssues);
      enrichedTextRef.current = candidateText;
      visualEnrichmentRef.current = null;
      return { candidateText, intakeReviewIssues, statusStoryAnalysis };
    }
    return { candidateText, intakeReviewIssues: [] as StoryReviewIssue[], statusStoryAnalysis };
  }, []);

  if (draftHydratedRef.current) {
    latestDraftPayloadRef.current = buildDraftPayload();
    hasPendingDraftSaveRef.current = true;
  }

  // Load existing draft/logs on mount
  useEffect(() => {
    async function loadDraftAndLogs() {
      try {
        const [draftRes, logsRes] = await Promise.all([
          apiFetch(`/api/projects/${projectId}/import/state`),
          apiFetch(`/api/projects/${projectId}/import/logs`),
        ]);
        const draft = (await draftRes.json()) as ImportDraftState | null;
        const data = await logsRes.json();
        let restoredTextForStyle = "";
        let storyAnalysisForStyle: StoryAssetAnalysis | null = null;
        let restoredIntakeJobId: string | null = null;
        let draftCurrentStepValue = 0;
        let logCurrentStepValue = 0;
        if (data.length > 0) {
          setLogs(data);
          setHistoryMode(true);
          // Determine last completed step
          const doneSteps = data.filter((l: LogEntry) => l.status === "done").map((l: LogEntry) => l.step);
          const maxDone = Math.max(0, ...doneSteps) as Step | 0;
          logCurrentStepValue = maxDone;
          setCurrentStep(maxDone);
          const parseLog = data.find((l: LogEntry) => l.step === 1 && l.status === "done" && l.metadata);
          const parseMeta = parseLog?.metadata as { text?: string } | undefined;
          const storyLog = data.find((l: LogEntry) => l.step === 2 && l.status === "done" && l.metadata);
          const storyMeta = storyLog?.metadata as { text?: string; preview?: string; storyAnalysis?: StoryAssetAnalysis | null } | undefined;
          const logStoryAnalysis = storyMetaOnlyAnalysis(storyMeta?.storyAnalysis ?? null);
          const restoredText = storyMeta?.text || parseMeta?.text || storyMeta?.preview;
          if (restoredText) setFullText(restoredText);
          if (logStoryAnalysis) setStoryAnalysis(logStoryAnalysis);
          restoredTextForStyle = restoredText || "";
          storyAnalysisForStyle = logStoryAnalysis;
          const logProjectStyleGuide = buildProjectStyleGuide(logStoryAnalysis, restoredText || "");

          const assetLog = data.find((l: LogEntry) => l.step === 3 && l.status === "done" && l.metadata);
          const assetMeta = assetLog?.metadata as {
            characters?: ExtractedCharacter[];
            items?: ExtractedAsset[];
            environments?: ExtractedAsset[];
            voices?: ExtractedAsset[];
            relationships?: Array<{ characterA: string; characterB: string; relationType: string; description?: string }>;
          } | undefined;
          if (assetMeta?.characters) setCharacters(normalizeImportedCharacters(assetMeta.characters, logProjectStyleGuide));
          if (assetMeta?.items) setItems(normalizeImportedItems(assetMeta.items, logProjectStyleGuide));
          if (assetMeta?.environments) setEnvironments(normalizeImportedEnvironments(assetMeta.environments, logProjectStyleGuide));
          if (assetMeta?.voices) setVoices(assetMeta.voices);
          if (assetMeta?.relationships) setRelationships(assetMeta.relationships);

          const splitLog = data.find((l: LogEntry) => l.step === 4 && l.status === "done" && l.metadata);
          const splitMeta = splitLog?.metadata as { episodes?: SplitEpisode[] } | undefined;
          if (splitMeta?.episodes) {
            setEpisodes(splitMeta.episodes);
            setExpandedEpisodeIndexes(new Set());
            setConfirmedEpisodeIndexes(new Set());
          }

          for (let s = 1; s <= 5; s++) {
            const stepLogs = data.filter((l: LogEntry) => l.step === s);
            const latestStepLog = stepLogs[stepLogs.length - 1];
            if (latestStepLog) {
              setStepStatus((prev) => ({
                ...prev,
                [s]: latestStepLog.status === "running" ? "idle" : latestStepLog.status,
              }));
            }
          }
        }

        if (draft) {
          const draftStepStatus = sanitizePersistedStepStatus(draft.stepStatus);
          if (typeof draft.currentStep === "number") {
            const draftCurrentStep = Math.max(0, Math.min(5, draft.currentStep)) as Step | 0;
            const mergedCurrentStep = Math.max(draftCurrentStep, logCurrentStepValue) as Step | 0;
            draftCurrentStepValue = mergedCurrentStep;
            setCurrentStep(mergedCurrentStep as Step | 0);
            if (mergedCurrentStep < 5 || draftStepStatus[5] !== "done") {
              setHistoryMode(false);
              setSelectedStep(null);
            }
          }
          if (draft.stepStatus) {
            setStepStatus((prev) => mergeStepStatusPreservingDone(prev, draftStepStatus));
          }
          if (typeof draft.fullText === "string") {
            setFullText(draft.fullText);
            if (draftStepStatus[2] === "done") {
              enrichedTextRef.current = draft.fullText;
              detailSupplementedRef.current = true;
              setDetailSupplemented(true);
            }
          }
          if (Array.isArray(draft.reviewIssues)) setReviewIssues(draft.reviewIssues);
          const draftStoryAnalysis = storyMetaOnlyAnalysis(draft.storyAnalysis ?? null);
          if (draft.storyAnalysis !== undefined) setStoryAnalysis(draftStoryAnalysis);
          const draftProjectStyleGuide = buildProjectStyleGuide(
            draftStoryAnalysis ?? storyAnalysisForStyle,
            typeof draft.fullText === "string" ? draft.fullText : restoredTextForStyle,
          );
          if (Array.isArray(draft.characters)) setCharacters(normalizeImportedCharacters(draft.characters, draftProjectStyleGuide));
          if (Array.isArray(draft.items)) setItems(normalizeImportedItems(draft.items, draftProjectStyleGuide));
          if (Array.isArray(draft.environments)) setEnvironments(normalizeImportedEnvironments(draft.environments, draftProjectStyleGuide));
          if (Array.isArray(draft.voices)) setVoices(draft.voices);
          if (Array.isArray(draft.relationships)) setRelationships(draft.relationships);
          if (Array.isArray(draft.episodes)) {
            setEpisodes(draft.episodes);
            setExpandedEpisodeIndexes(new Set());
          }
          if (Array.isArray(draft.confirmedEpisodeIndexes)) {
            setConfirmedEpisodeIndexes(new Set(draft.confirmedEpisodeIndexes));
          }
          if (typeof draft.intakeJobId === "string" && draft.intakeJobId) {
            restoredIntakeJobId = draft.intakeJobId;
            setIntakeJobId(draft.intakeJobId);
          }
          if (typeof draft.confirmedScriptVersionId === "string" && draft.confirmedScriptVersionId) {
            setConfirmedScriptVersionId(draft.confirmedScriptVersionId);
          }
          if (typeof draft.assetLibraryVersionId === "string" && draft.assetLibraryVersionId) {
            setAssetLibraryVersionId(draft.assetLibraryVersionId);
          }
          storyReviewedRef.current = draftStepStatus[2] === "done";
        }

        if (restoredIntakeJobId) {
          const intakeRes = await apiFetch(`/api/projects/${projectId}/script/intake/jobs/${restoredIntakeJobId}`);
          if (intakeRes.ok) {
            const status = await intakeRes.json() as IntakeJobStatus;
            setIntakeJobStatus(status);
            const { candidateText } = syncReviewFromIntakeStatus(status, { preserveExistingIssues: true });
            if ((status.status === "awaiting_review" || status.status === "confirmed") && candidateText.trim()) {
              detailSupplementedRef.current = true;
              setDetailSupplemented(true);
              if (draftCurrentStepValue < 2) {
                setCurrentStep(2);
                setStepStatus((prev) => ({ ...prev, 1: "done", 2: "idle" }));
              }
              if (status.confirmed_script_version_id) {
                setConfirmedScriptVersionId(status.confirmed_script_version_id);
              }
            }
          }
        }
      } catch {
        // No draft/logs, fresh import
      } finally {
        draftHydratedRef.current = true;
        setDraftHydrated(true);
      }
    }
    loadDraftAndLogs();
  }, [projectId, syncReviewFromIntakeStatus]);

  useEffect(() => {
    if (!draftHydrated || !intakeJobId || !isActiveIntakeStatus(intakeJobStatus)) return;
    if (intakePollingRef.current) return;

    let active = true;
    intakePollingRef.current = true;

    async function pollRestoredIntake() {
      while (active && intakePollingRef.current && intakeJobId) {
        try {
          const statusRes = await apiFetch(`/api/projects/${projectId}/script/intake/jobs/${intakeJobId}`);
          if (!statusRes.ok) {
            const errData = await statusRes.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${statusRes.status}`);
          }

          const status = await statusRes.json() as IntakeJobStatus;
          setIntakeJobStatus(status);
          const { candidateText, intakeReviewIssues, statusStoryAnalysis } = syncReviewFromIntakeStatus(status, {
            preserveExistingIssues: isActiveIntakeStatus(status),
          });

          if (status.status === "failed" || status.status === "cancelled") {
            setStepStatus((prev) => ({ ...prev, 1: "error" }));
            intakePollingRef.current = false;
            return;
          }

          if (status.status === "awaiting_review" || status.status === "confirmed") {
            if (!candidateText.trim()) throw new Error("Script intake finished without candidate text");
            detailSupplementedRef.current = true;
            setDetailSupplemented(true);
            setCurrentStep(2);
            setStepStatus((prev) => ({ ...prev, 1: "done", 2: "idle" }));
            if (status.confirmed_script_version_id) {
              setConfirmedScriptVersionId(status.confirmed_script_version_id);
            }
            await saveDraft({
              ...resetDraftPayload(),
              currentStep: 2,
              stepStatus: { 1: "done", 2: "idle", 3: "idle", 4: "idle", 5: "idle" },
              fullText: candidateText,
              reviewIssues: intakeReviewIssues,
              storyAnalysis: statusStoryAnalysis,
              intakeJobId,
              confirmedScriptVersionId: status.confirmed_script_version_id || null,
              assetLibraryVersionId: null,
            });
            intakePollingRef.current = false;
            return;
          }
        } catch (error) {
          console.error("Restored script intake polling error:", error);
        }

        await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
      }
    }

    void pollRestoredIntake();
    return () => {
      active = false;
      intakePollingRef.current = false;
    };
  }, [
    draftHydrated,
    intakeJobId,
    intakeJobStatus,
    projectId,
    resetDraftPayload,
    saveDraft,
    syncReviewFromIntakeStatus,
  ]);

  useEffect(() => {
    if (!draftHydrated || !forceAssetWorkbench) return;
    setHistoryMode(false);
    setSelectedStep(null);
    setCurrentStep(3);
  }, [draftHydrated, forceAssetWorkbench]);

  useEffect(() => {
    if (!draftHydrated) return;
    if (persistedAssetsHydratedRef.current) return;
    if (!(forceAssetWorkbench || currentStep >= 3 || stepStatus[3] === "done" || historyMode)) return;

    let cancelled = false;
    async function loadPersistedAssets() {
      try {
        const res = await apiFetch(`/api/projects/${projectId}/assets`);
        if (!res.ok) return;
        const data = await res.json() as { assets?: PersistedStoryAsset[] };
        const persistedAssets = Array.isArray(data.assets) ? data.assets : [];
        if (cancelled || persistedAssets.length === 0) return;
        persistedAssetsHydratedRef.current = true;
        const projectStyleGuide = buildProjectStyleGuide(storyAnalysis, fullText);
        const persistedCharacters = persistedAssets
          .filter((asset) => asset.type === "character")
          .map((asset) => persistedAssetToWorkbench(asset) as ExtractedCharacter);
        const persistedItems = persistedAssets
          .filter((asset) => asset.type === "prop")
          .map((asset) => persistedAssetToWorkbench(asset));
        const persistedEnvironments = persistedAssets
          .filter((asset) => asset.type === "scene")
          .map((asset) => persistedAssetToWorkbench(asset));
        setCharacters(normalizeImportedCharacters(persistedCharacters, projectStyleGuide));
        setItems(normalizeImportedItems(persistedItems, projectStyleGuide));
        setEnvironments(normalizeImportedEnvironments(persistedEnvironments, projectStyleGuide));
      } catch (error) {
        console.warn("Failed to hydrate persisted assets:", error);
      }
    }

    void loadPersistedAssets();
    return () => {
      cancelled = true;
    };
  }, [
    currentStep,
    draftHydrated,
    forceAssetWorkbench,
    fullText,
    historyMode,
    projectId,
    stepStatus,
    storyAnalysis,
  ]);

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }
    const draftPayload = buildDraftPayload();
    latestDraftPayloadRef.current = draftPayload;
    hasPendingDraftSaveRef.current = true;
    if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
    if (immediateDraftSaveRef.current) {
      immediateDraftSaveRef.current = false;
      void saveDraft(draftPayload);
      return;
    }
    saveDraftTimerRef.current = setTimeout(() => {
      saveDraft(latestDraftPayloadRef.current ?? undefined);
    }, 1000);
    return () => {
      if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
    };
  }, [buildDraftPayload, saveDraft]);

  useEffect(() => {
    const handlePageHide = () => {
      if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
      flushDraft();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") handlePageHide();
    };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
      flushDraft();
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushDraft]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = useCallback((step: Step, status: LogEntry["status"], message: string) => {
    setLogs((prev) => [
      ...prev,
      { id: `local-${Date.now()}-${localLogSeq.current++}`, step, status, message, createdAt: Date.now() },
    ]);
  }, []);

  const setDetailSupplementReady = useCallback((ready: boolean) => {
    detailSupplementedRef.current = ready;
    setDetailSupplemented(ready);
  }, []);

  const setCurrentEnrichmentJob = useCallback((jobId: string | null) => {
    enrichmentJobIdRef.current = jobId;
    setEnrichmentJobId(jobId);
    if (!jobId) {
      enrichmentStatusRef.current = null;
      setEnrichmentJobStatus(null);
      lastEnrichmentTerminalLogRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enrichmentJobId) return;
    let active = true;
    let polling = false;

    const applyStatus = async (data: ScriptEnrichmentJobStatus) => {
      if (!active) return;
      enrichmentStatusRef.current = data;
      setEnrichmentJobStatus(data);

      const enrichedText = typeof data.enrichedText === "string" && data.enrichedText.trim()
        ? data.enrichedText
        : fullText;
      if (enrichedText && enrichedText !== fullText) {
        enrichedTextRef.current = enrichedText;
        setFullText(enrichedText);
      }
      if (data.visualEnrichment?.patches?.length) {
        visualEnrichmentRef.current = data.visualEnrichment;
      } else if (data.status === "completed") {
        visualEnrichmentRef.current = null;
      }

      if (data.status === "queued" || data.status === "running") {
        setStepStatus((prev) => ({ ...prev, 2: "running" }));
        return;
      }

      const terminalKey = `${data.job_id}:${data.status}:${data.completed_tasks}:${data.failed_tasks}:${data.skipped_tasks}`;
      if (lastEnrichmentTerminalLogRef.current !== terminalKey) {
        lastEnrichmentTerminalLogRef.current = terminalKey;
        if (data.status === "completed") {
          addLog(
            2,
            "running",
            `AI 细节补全完成：成功 ${data.completed_tasks}，跳过 ${data.skipped_tasks}，失败 ${data.failed_tasks}`,
          );
        } else if (data.status === "cancelled") {
          addLog(2, "error", "AI 细节补全已取消");
        } else {
          addLog(2, "error", `AI 细节补全失败：${data.error_message || "未知错误"}`);
        }
      }

      if (data.status === "completed") {
        setDetailSupplementReady(true);
        setStepStatus((prev) => ({ ...prev, 2: "idle" }));
        await saveDraft({
          ...buildDraftPayload(),
          currentStep: 2,
          stepStatus: { 1: "done", 2: "idle", 3: "idle", 4: "idle", 5: "idle" },
          fullText: enrichedText,
          reviewIssues: [],
          storyAnalysis: null,
          enrichmentJobId: data.job_id,
        });
      } else {
        setDetailSupplementReady(false);
        setStepStatus((prev) => ({ ...prev, 2: data.status === "cancelled" ? "idle" : "error" }));
      }
    };

    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const res = await apiFetch(`/api/projects/${projectId}/script/enrich/jobs/${enrichmentJobId}`);
        const data = await res.json() as ScriptEnrichmentJobStatus;
        await applyStatus(data);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        addLog(2, "error", `读取 AI 细节补全进度失败：${msg}`);
      } finally {
        polling = false;
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), SCRIPT_ENRICHMENT_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [
    addLog,
    buildDraftPayload,
    enrichmentJobId,
    fullText,
    projectId,
    saveDraft,
    setDetailSupplementReady,
  ]);

  async function cancelEnrichmentJob() {
    const jobId = enrichmentJobIdRef.current;
    if (!jobId) return;
    const res = await apiFetch(`/api/projects/${projectId}/script/enrich/jobs/${jobId}/cancel`, {
      method: "POST",
    });
    const data = await res.json() as ScriptEnrichmentJobStatus;
    enrichmentStatusRef.current = data;
    setEnrichmentJobStatus(data);
    setStepStatus((prev) => ({ ...prev, 2: "idle" }));
    addLog(2, "error", "AI 细节补全已取消");
  }

  async function retryFailedEnrichmentJob() {
    const jobId = enrichmentJobIdRef.current;
    if (!jobId) return;
    const res = await apiFetch(`/api/projects/${projectId}/script/enrich/jobs/${jobId}/retry-failed`, {
      method: "POST",
    });
    const data = await res.json() as ScriptEnrichmentJobStatus;
    enrichmentStatusRef.current = data;
    setEnrichmentJobStatus(data);
    setStepStatus((prev) => ({ ...prev, 2: "running" }));
    setDetailSupplementReady(false);
    addLog(2, "running", "AI 细节补全失败任务已重新排队");
  }

  const handleFile = useCallback((f: File) => {
    if (f.size > MAX_SIZE) {
      toast.error(t("fileTooLarge"));
      return;
    }
    setFile(f);
    storyReviewedRef.current = false;
    enrichedTextRef.current = "";
    visualEnrichmentRef.current = null;
    setDetailSupplementReady(false);
    setCurrentEnrichmentJob(null);
    setIntakeJobId(null);
    setIntakeJobStatus(null);
    setConfirmedScriptVersionId(null);
    setAssetLibraryVersionId(null);
    intakePollingRef.current = false;
    setHistoryMode(false);
    setSelectedStep(null);
    setCurrentStep(0);
    setFullText("");
    setReviewIssues([]);
    setStoryAnalysis(null);
    setCharacters([]);
    setItems([]);
    setEnvironments([]);
    setVoices([]);
    setRelationships([]);
    setEpisodes([]);
    setExpandedEpisodeIndexes(new Set());
    setConfirmedEpisodeIndexes(new Set());
    setStepStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle", 5: "idle" });
    void saveDraft(resetDraftPayload());
  }, [resetDraftPayload, saveDraft, setCurrentEnrichmentJob, setDetailSupplementReady, t]);

  // ── Step 1: Script intake, then stop for human review ──
  async function runScriptIntakePipeline(uploadFile: File) {
    const form = new FormData();
    form.append("file", uploadFile);
    form.append("modelConfig", JSON.stringify(getModelConfig()));
    form.append("allowAiOverwrite", "true");

    const startRes = await apiFetch(`/api/projects/${projectId}/script/intake/start`, {
      method: "POST",
      body: form,
    });
    if (!startRes.ok) {
      const errData = await startRes.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${startRes.status}`);
    }

    const startData = await startRes.json() as { jobId?: string; job_id?: string };
    const jobId = startData.jobId || startData.job_id;
    if (!jobId) throw new Error("Script intake job did not return job_id");

    setIntakeJobId(jobId);
    setConfirmedScriptVersionId(null);
    setAssetLibraryVersionId(null);
    intakePollingRef.current = true;
    addLog(1, "running", `Script intake job queued: ${jobId}`);
    await saveDraft({
      ...resetDraftPayload(),
      currentStep: 1,
      stepStatus: { 1: "running", 2: "idle", 3: "idle", 4: "idle", 5: "idle" },
      intakeJobId: jobId,
      confirmedScriptVersionId: null,
      assetLibraryVersionId: null,
    });

    let lastStage = "";
    while (intakePollingRef.current) {
      const statusRes = await apiFetch(`/api/projects/${projectId}/script/intake/jobs/${jobId}`);
      if (!statusRes.ok) {
        const errData = await statusRes.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${statusRes.status}`);
      }

      const status = await statusRes.json() as IntakeJobStatus;
      setIntakeJobStatus(status);
      if (status.current_stage && status.current_stage !== lastStage) {
        lastStage = status.current_stage;
        addLog(1, "running", `Intake stage: ${status.current_stage} (${Math.round(status.progress || 0)}%)`);
      }

      if (status.status === "failed" || status.status === "cancelled") {
        throw new Error(status.error_message || `Script intake ${status.status}`);
      }

      if (status.status === "awaiting_review" || status.status === "confirmed") {
        const candidateText = status.candidate_text || "";
        if (!candidateText.trim()) throw new Error("Script intake finished without candidate text");
        const intakeReviewIssues = intakeIssuesToStoryIssues(status, candidateText);
        const statusStoryAnalysis = storyAnalysisFromStatus(status);

        setFullText(candidateText);
        setReviewIssues(intakeReviewIssues);
        setStoryAnalysis(statusStoryAnalysis);
        enrichedTextRef.current = candidateText;
        visualEnrichmentRef.current = null;
        setDetailSupplementReady(true);
        setCurrentStep(2);
        setStepStatus((prev) => ({ ...prev, 1: "done", 2: "idle" }));
        if (status.confirmed_script_version_id) {
          setConfirmedScriptVersionId(status.confirmed_script_version_id);
        }
        addLog(1, "done", `Script intake ready for review: ${candidateText.length} chars`);
        await saveDraft({
          ...resetDraftPayload(),
          currentStep: 2,
          stepStatus: { 1: "done", 2: "idle", 3: "idle", 4: "idle", 5: "idle" },
          fullText: candidateText,
          reviewIssues: intakeReviewIssues,
          storyAnalysis: statusStoryAnalysis,
          intakeJobId: jobId,
          confirmedScriptVersionId: status.confirmed_script_version_id || null,
          assetLibraryVersionId: null,
        });
        intakePollingRef.current = false;
        return;
      }

      await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
    }
  }

  async function startPipeline() {
    if (!file) return;
    if (!textGuard()) return;

    setHistoryMode(false);
    setSelectedStep(null);
    setLogs([]);
    setFullText("");
    setReviewIssues([]);
    setStoryAnalysis(null);
    setCharacters([]);
    setItems([]);
    setEnvironments([]);
    setVoices([]);
    setRelationships([]);
    setEpisodes([]);
    setExpandedEpisodeIndexes(new Set());
    setConfirmedEpisodeIndexes(new Set());
    storyReviewedRef.current = false;
    enrichedTextRef.current = "";
    visualEnrichmentRef.current = null;
    setDetailSupplementReady(false);
    setCurrentEnrichmentJob(null);
    setIntakeJobId(null);
    setIntakeJobStatus(null);
    setConfirmedScriptVersionId(null);
    intakePollingRef.current = false;
    setStepStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle", 5: "idle" });
    await saveDraft(resetDraftPayload());

    // Clear old logs
    await apiFetch(`/api/projects/${projectId}/import/logs`, { method: "DELETE" });

    // Step 1: Script intake
    setCurrentStep(1);
    setStepStatus((prev) => ({ ...prev, 1: "running" }));
    addLog(1, "running", `创建剧本标准化任务: ${file.name}`);

    try {
      await runScriptIntakePipeline(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Script intake failed";
      addLog(1, "error", `剧本标准化失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 1: "error" }));
      return;
    }
  }

  // ── Step 2: Intake review refresh, then human review gate ──
  async function runStoryReview(text: string = fullText) {
    if (!text.trim()) return;
    if (!textGuard()) return;
    if (!intakeJobId) {
      const message = "请先重新上传并完成剧本标准化，再刷新审阅结果";
      toast.error(message);
      addLog(2, "error", message);
      return;
    }

    setCurrentStep(2);
    setStepStatus((prev) => ({ ...prev, 2: "running" }));
    setReviewIssues([]);
    addLog(2, "running", "刷新剧本标准化审阅结果...");

    try {
      setSelectedIssueIndexes(new Set());
      setActiveIssueIndex(null);
      const intakeRes = await apiFetch(`/api/projects/${projectId}/script/intake/jobs/${intakeJobId}`);
      if (!intakeRes.ok) {
        const errData = await intakeRes.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${intakeRes.status}`);
      }
      const status = await intakeRes.json() as IntakeJobStatus;
      const candidateText = status.candidate_text || text;
      const intakeReviewIssues = intakeIssuesToStoryIssues(status, candidateText);
      const statusStoryAnalysis = storyAnalysisFromStatus(status);
      setIntakeJobStatus(status);
      setFullText(candidateText);
      setReviewIssues(intakeReviewIssues);
      if (statusStoryAnalysis) setStoryAnalysis(statusStoryAnalysis);
      setDetailSupplementReady(status.status === "awaiting_review" || status.status === "confirmed");
      setStepStatus((prev) => ({ ...prev, 2: "idle" }));
      addLog(2, "done", `剧本标准化审阅结果已刷新，发现 ${intakeReviewIssues.length} 个问题`);
      await saveDraft({
        ...buildDraftPayload(),
        currentStep: 2,
        stepStatus: { ...stepStatus, 1: "done", 2: "idle" },
        fullText: candidateText,
        reviewIssues: intakeReviewIssues,
        storyAnalysis: statusStoryAnalysis ?? storyAnalysis,
        intakeJobId,
        confirmedScriptVersionId: status.confirmed_script_version_id || confirmedScriptVersionId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Review failed";
      addLog(2, "error", `刷新剧本标准化审阅失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 2: "error" }));
    }
  }

  function scrollAndSelectQuote(issue: StoryReviewIssue, index: number) {
    const textarea = reviewTextRef.current;
    if (!textarea || !issue.exactQuote) return;

    const pos = fullText.indexOf(issue.exactQuote);
    if (pos < 0) {
      toast.error(t("reviewQuoteMissing"));
      return;
    }

    const end = pos + issue.exactQuote.length;
    textarea.focus();
    textarea.setSelectionRange(pos, end);

    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight || "20") || 20;
    const linesBefore = textarea.value.slice(0, pos).split("\n").length - 1;
    const targetScrollTop = Math.max(0, linesBefore * lineHeight - textarea.clientHeight / 2);
    textarea.scrollTop = targetScrollTop;

    setActiveIssueIndex(index);
  }

  const findMatches = useMemo(() => {
    if (!findText) return [] as number[];
    const matches: number[] = [];
    let index = fullText.indexOf(findText);
    while (index >= 0) {
      matches.push(index);
      index = fullText.indexOf(findText, index + Math.max(findText.length, 1));
    }
    return matches;
  }, [findText, fullText]);

  function selectTextRange(start: number, length: number) {
    const textarea = reviewTextRef.current;
    if (!textarea) return;

    textarea.focus();
    textarea.setSelectionRange(start, start + length);

    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight || "20") || 20;
    const linesBefore = textarea.value.slice(0, start).split("\n").length - 1;
    textarea.scrollTop = Math.max(0, linesBefore * lineHeight - textarea.clientHeight / 2);
  }

  function findNextMatch() {
    if (findMatches.length === 0) {
      if (findText) toast.error("未找到匹配文本");
      return;
    }
    const nextIndex = findMatchIndex % findMatches.length;
    setFindMatchIndex(nextIndex + 1);
    selectTextRange(findMatches[nextIndex], findText.length);
  }

  function replaceCurrentMatch() {
    if (!findText) return;
    const textarea = reviewTextRef.current;
    const selectionStart = textarea?.selectionStart ?? -1;
    const selectionEnd = textarea?.selectionEnd ?? -1;
    const selectedText = selectionStart >= 0 && selectionEnd > selectionStart
      ? fullText.slice(selectionStart, selectionEnd)
      : "";
    const replaceAt = selectedText === findText
      ? selectionStart
      : findMatches[findMatchIndex > 0 ? Math.min(findMatchIndex - 1, findMatches.length - 1) : 0];

    if (replaceAt === undefined || replaceAt < 0) {
      toast.error("未找到匹配文本");
      return;
    }

    const nextText = fullText.slice(0, replaceAt) + replaceText + fullText.slice(replaceAt + findText.length);
    setFullText(nextText);
    requestAnimationFrame(() => selectTextRange(replaceAt, replaceText.length));
  }

  function replaceAllMatches() {
    if (!findText || findMatches.length === 0) {
      toast.error("未找到匹配文本");
      return;
    }
    setFullText((prev) => prev.split(findText).join(replaceText));
    setFindMatchIndex(0);
  }

  function applyStoryIssue(index: number) {
    const issue = reviewIssues[index];
    if (!issue || issue.applied || issue.waived) return;
    if (!issue.exactQuote || !fullText.includes(issue.exactQuote)) {
      toast.error(t("reviewQuoteMissing"));
      return;
    }
    setFullText((prev) => issue.replaceMode === "all"
      ? prev.split(issue.exactQuote).join(issue.replacement)
      : prev.replace(issue.exactQuote, issue.replacement)
    );
    setReviewIssues((prev) => prev.map((item, idx) => idx === index ? { ...item, applied: true } : item));
    setSelectedIssueIndexes((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }

  function applyStoryIssueIndexes(indexes: number[]) {
    const targets = new Set(indexes);
    let nextText = fullText;
    const nextIssues = reviewIssues.map((issue, index) => {
      if (!targets.has(index) || issue.applied || issue.waived || !issue.exactQuote || !nextText.includes(issue.exactQuote)) return issue;
      nextText = issue.replaceMode === "all"
        ? nextText.split(issue.exactQuote).join(issue.replacement)
        : nextText.replace(issue.exactQuote, issue.replacement);
      return { ...issue, applied: true };
    });
    setFullText(nextText);
    setReviewIssues(nextIssues);
    setSelectedIssueIndexes((prev) => {
      const next = new Set(prev);
      indexes.forEach((index) => next.delete(index));
      return next;
    });
  }

  function applySelectedStoryIssues() {
    const indexes = Array.from(selectedIssueIndexes)
      .filter((index) => {
        const issue = reviewIssues[index];
        return issue && !issue.applied && !issue.waived && Boolean(issue.exactQuote) && fullText.includes(issue.exactQuote);
      })
      .sort((a, b) => a - b);
    if (indexes.length === 0) {
      toast.error(t("reviewQuoteMissing"));
      return;
    }
    applyStoryIssueIndexes(indexes);
  }

  function applyAllStoryIssues() {
    applyStoryIssueIndexes(reviewIssues.map((_, index) => index));
  }

  function resolveHighRiskStoryIssues(options?: { waiveRemaining?: boolean }) {
    let nextText = fullText;
    let appliedCount = 0;
    let waivedCount = 0;
    const nextIssues = reviewIssues.map((issue) => {
      if (issue.severity !== "high" || issue.applied || issue.waived) return issue;
      if (issue.exactQuote && nextText.includes(issue.exactQuote)) {
        nextText = issue.replaceMode === "all"
          ? nextText.split(issue.exactQuote).join(issue.replacement)
          : nextText.replace(issue.exactQuote, issue.replacement);
        appliedCount += 1;
        return { ...issue, applied: true };
      }
      if (options?.waiveRemaining) {
        waivedCount += 1;
        return {
          ...issue,
          waived: true,
          waiverNote: "manual_release_before_asset_intake",
        };
      }
      return issue;
    });

    setFullText(nextText);
    setReviewIssues(nextIssues);
    setSelectedIssueIndexes(new Set());

    if (appliedCount || waivedCount) {
      toast.success(`已处理高危问题：自动替换 ${appliedCount} 项，人工确认 ${waivedCount} 项`);
    } else {
      toast.error("没有可自动处理的高危问题");
    }

    return { nextText, nextIssues, appliedCount, waivedCount };
  }

  function applyResolvableHighRiskIssues() {
    resolveHighRiskStoryIssues();
  }

  async function resolveHighRisksAndConfirmStory() {
    const unresolvedHighCount = reviewIssues.filter((issue) =>
      issue.severity === "high" && !issue.applied && !issue.waived
    ).length;
    if (unresolvedHighCount === 0) {
      await confirmStoryReview();
      return;
    }

    const confirmed = window.confirm(
      `将按行业审阅规则处理 ${unresolvedHighCount} 个高危问题：可定位文本会自动替换，无法自动定位的问题将标记为人工确认后放行，并写入确认版本审阅记录。是否继续？`,
    );
    if (!confirmed) return;

    const { nextText, nextIssues } = resolveHighRiskStoryIssues({ waiveRemaining: true });
    await confirmStoryReview({ content: nextText, reviewIssues: nextIssues });
  }

  function waiveStoryIssue(index: number) {
    setReviewIssues((prev) => prev.map((issue, idx) =>
      idx === index ? { ...issue, waived: true, waiverNote: "manual_single_issue_release" } : issue
    ));
    setSelectedIssueIndexes((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }

  function toggleIssueSelection(index: number) {
    setSelectedIssueIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function toggleAllIssueSelection() {
    const selectableIndexes = reviewIssues
      .map((issue, index) => ({ issue, index }))
      .filter(({ issue }) => !issue.applied && !issue.waived && Boolean(issue.exactQuote) && fullText.includes(issue.exactQuote))
      .map(({ index }) => index);
    const allSelected = selectableIndexes.length > 0 && selectableIndexes.every((index) => selectedIssueIndexes.has(index));

    setSelectedIssueIndexes(allSelected ? new Set() : new Set(selectableIndexes));
  }

  function validateStoryReviewReady(nextIssues = reviewIssues) {
    const missingMeta = missingStoryMetaLabels(storyAnalysis);
    if (missingMeta.length > 0) {
      toast.error(`请先补全故事设定：${missingMeta.join("、")}`);
      return false;
    }
    const unresolvedHigh = nextIssues.filter((issue) =>
      issue.severity === "high" && !issue.applied && !issue.waived
    );
    if (unresolvedHigh.length > 0) {
      toast.error(`请先处理或豁免 ${unresolvedHigh.length} 个高危审阅问题`);
      return false;
    }
    return true;
  }

  async function ensureConfirmedScriptVersion(options?: { content?: string; reviewIssues?: StoryReviewIssue[] }) {
    if (confirmedScriptVersionId) return confirmedScriptVersionId;
    if (!intakeJobId) {
      throw new Error("请先完成剧本标准化，再确认正文");
    }

    addLog(2, "running", "正在生成人工确认剧本版本...");
    const content = options?.content ?? fullText;
    const issuesForReview = options?.reviewIssues ?? reviewIssues;
    const res = await apiFetch(`/api/projects/${projectId}/script/intake/jobs/${intakeJobId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        reviewNotes: {
          reviewIssues: issuesForReview,
          storyAnalysis: storyMetaOnlyAnalysis(storyAnalysis),
        },
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const data = await res.json() as { confirmed_script_version_id?: string };
    const versionId = data.confirmed_script_version_id;
    if (!versionId) throw new Error("确认接口没有返回 confirmed_script_version_id");

    setConfirmedScriptVersionId(versionId);
    setAssetLibraryVersionId(null);
    setIntakeJobStatus((prev) => prev ? { ...prev, status: "confirmed", confirmed_script_version_id: versionId } : prev);
    addLog(2, "done", `已生成确认剧本版本: ${versionId}`);
    await saveDraft({
      ...buildDraftPayload(),
      fullText: content,
      reviewIssues: issuesForReview,
      intakeJobId,
      confirmedScriptVersionId: versionId,
      assetLibraryVersionId: null,
    });
    return versionId;
  }

  async function confirmStoryReview(options?: { content?: string; reviewIssues?: StoryReviewIssue[] }) {
    const content = options?.content ?? fullText;
    const issuesForReview = options?.reviewIssues ?? reviewIssues;
    if (!content.trim()) return;
    if (!validateStoryReviewReady(issuesForReview)) return;
    let activeConfirmedScriptVersionId: string;
    try {
      activeConfirmedScriptVersionId = await ensureConfirmedScriptVersion({
        content,
        reviewIssues: issuesForReview,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "确认失败";
      addLog(2, "error", `确认剧本版本失败: ${msg}`);
      toast.error(msg);
      return;
    }
    storyReviewedRef.current = true;
    await apiFetch(`/api/projects/${projectId}/import/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step: 2,
        status: "done",
        message: `剧情审阅通过，共 ${content.length} 字`,
        metadata: { charCount: content.length, preview: content.slice(0, 2000), text: content, storyAnalysis: storyMetaOnlyAnalysis(storyAnalysis) },
      }),
    });
    setCurrentStep(3);
    setStepStatus((prev) => ({ ...prev, 2: "done" }));
    addLog(2, "done", `剧情审阅通过，共 ${content.length} 字`);
    await saveDraft({
      ...buildDraftPayload(),
      currentStep: 3,
      stepStatus: { ...stepStatus, 2: "done" },
      fullText: content,
      reviewIssues: issuesForReview,
      storyAnalysis: storyMetaOnlyAnalysis(storyAnalysis),
    });
    await runCharacterExtract(activeConfirmedScriptVersionId);
  }

  function updateStoryMetaField(field: keyof NonNullable<StoryAssetAnalysis["storyMeta"]>, value: string) {
    setStoryAnalysis((prev) => ({
      storyMeta: {
        ...(prev?.storyMeta || {}),
        [field]: value,
      },
    }));
  }

  // ── Step 3: Asset setting foundation - character extraction ──
  async function runCharacterExtract(versionId = confirmedScriptVersionId) {
    if (!fullText) return;
    if (!versionId) {
      toast.error("请先确认剧本正文，再提取资产");
      setStepStatus((prev) => ({ ...prev, 3: "error" }));
      return;
    }
    if (!storyReviewedRef.current && stepStatus[2] !== "done") {
      setCurrentStep(2);
      setStepStatus((prev) => ({ ...prev, 2: "idle", 3: "idle" }));
      return;
    }
    setCurrentStep(3);
    setStepStatus((prev) => ({ ...prev, 3: "running" }));
    setAssetLibraryVersionId(null);
    addLog(3, "running", "开始资产设定：提取角色、物品、场景和音色...");

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedScriptVersionId: versionId, storyAnalysis: storyMetaOnlyAnalysis(storyAnalysis) }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const projectStyleGuide = buildProjectStyleGuide(storyAnalysis, fullText);
      const normalizedCharacters = normalizeImportedCharacters(data.characters, projectStyleGuide);
      const normalizedItems = normalizeImportedItems(data.items || [], projectStyleGuide);
      const normalizedEnvironments = normalizeImportedEnvironments(data.environments || [], projectStyleGuide);
      setCharacters(normalizedCharacters);
      setItems(normalizedItems);
      setEnvironments(normalizedEnvironments);
      setVoices(data.voices || []);
      setRelationships(data.relationships || []);
      const mainCount = data.characters.filter((c: ExtractedCharacter) => c.scope === "main").length;
      const guestCount = data.characters.length - mainCount;
      addLog(3, "done", `资产设定完成: ${mainCount} 个主角, ${guestCount} 个配角, ${(data.items || []).length} 个物品, ${(data.environments || []).length} 个环境, ${(data.voices || []).length} 个音色`);
      setStepStatus((prev) => ({ ...prev, 3: "done" }));
      await saveDraft({
        ...buildDraftPayload(),
        currentStep: 3,
        stepStatus: { ...stepStatus, 3: "done" },
        characters: normalizedCharacters,
        items: normalizedItems,
        environments: normalizedEnvironments,
        voices: data.voices || [],
        relationships: data.relationships || [],
        assetLibraryVersionId: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extract failed";
      addLog(3, "error", `资产设定失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 3: "error" }));
      return;
    }
  }

  // ── Step 3 only: Retry character extraction / asset setting ──
  async function retryCharacterExtract() {
    if (!fullText) return;
    await runCharacterExtract();
  }

  function syncedAssetsByType(assets: SyncedProjectAsset[], type: "character" | "prop" | "scene") {
    return assets.filter((asset) => asset.type === type);
  }

  function mergeSyncedAssetIds<T extends WorkbenchAsset>(
    source: T[],
    syncedAssets: SyncedProjectAsset[],
    type: "character" | "prop" | "scene",
  ): T[] {
    const candidates = syncedAssetsByType(syncedAssets, type);
    const byId = new Map(candidates.map((asset) => [asset.id, asset]));
    const byName = new Map(candidates.map((asset) => [asset.name.trim().toLowerCase(), asset]));

    return source.map((asset, index) => {
      const synced = (asset.assetId ? byId.get(asset.assetId) : undefined)
        ?? byName.get(asset.name.trim().toLowerCase())
        ?? candidates[index];
      return synced?.id ? { ...asset, assetId: synced.id } as T : asset;
    });
  }

  async function syncAndLockAssetLibraryVersion() {
    if (!confirmedScriptVersionId) {
      toast.error("请先确认剧本正文，再锁定资产库");
      return null;
    }
    if (assetLibraryVersionId) return assetLibraryVersionId;

    setAssetLibraryLocking(true);
    addLog(3, "running", "正在同步并锁定资产库版本...");

    try {
      const syncRes = await apiFetch(`/api/projects/${projectId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characters, items, environments }),
      });
      const syncData = await syncRes.json().catch(() => ({})) as { assets?: SyncedProjectAsset[]; error?: string };
      if (!syncRes.ok) {
        throw new Error(syncData.error || `HTTP ${syncRes.status}`);
      }

      const syncedAssets = Array.isArray(syncData.assets) ? syncData.assets : [];
      const nextCharacters = mergeSyncedAssetIds(characters, syncedAssets, "character") as ExtractedCharacter[];
      const nextItems = mergeSyncedAssetIds(items, syncedAssets, "prop") as ExtractedAsset[];
      const nextEnvironments = mergeSyncedAssetIds(environments, syncedAssets, "scene") as ExtractedAsset[];
      const assetIds = [...nextCharacters, ...nextItems, ...nextEnvironments]
        .map((asset) => asset.assetId)
        .filter((id): id is string => Boolean(id));
      if (assetIds.length === 0) {
        throw new Error("没有可锁定的角色、道具或场景资产");
      }

      setCharacters(nextCharacters);
      setItems(nextItems);
      setEnvironments(nextEnvironments);

      const lockRes = await apiFetch(`/api/projects/${projectId}/pipeline/asset-library/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmedScriptVersionId,
          assetIds,
          reviewSummary: {
            source: "asset_review_before_split",
            characterCount: nextCharacters.length,
            itemCount: nextItems.length,
            environmentCount: nextEnvironments.length,
            voiceCount: voices.length,
          },
        }),
      });
      const lockData = await lockRes.json().catch(() => ({})) as {
        asset_library_version?: { id?: string };
        error?: string;
      };
      if (!lockRes.ok) {
        throw new Error(lockData.error || `HTTP ${lockRes.status}`);
      }

      const versionId = lockData.asset_library_version?.id;
      if (!versionId) throw new Error("锁定接口没有返回 asset_library_version.id");

      setAssetLibraryVersionId(versionId);
      addLog(3, "done", `资产库已锁定为版本 ${versionId}`);
      await saveDraft({
        ...buildDraftPayload(),
        characters: nextCharacters,
        items: nextItems,
        environments: nextEnvironments,
        assetLibraryVersionId: versionId,
      });
      return versionId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "资产库锁定失败";
      addLog(3, "error", `资产库锁定失败: ${msg}`);
      toast.error(msg);
      return null;
    } finally {
      setAssetLibraryLocking(false);
    }
  }

  // ── Step 4: Split (triggered by user after reviewing asset settings) ──
  async function runSplit() {
    if (splitRunningRef.current || stepStatus[4] === "running" || assetLibraryLocking) return;
    const assets = [...characters, ...items, ...environments, ...voices];
    const unconfirmedAssets = assets.filter((asset) => asset.confirmed !== true);
    if (!assets.length || unconfirmedAssets.length > 0) {
      toast.error(`请先确认全部资产（${assets.length - unconfirmedAssets.length}/${assets.length}）`);
      return;
    }

    const lockedAssetLibraryVersionId = await syncAndLockAssetLibraryVersion();
    if (!lockedAssetLibraryVersionId) return;

    splitRunningRef.current = true;
    setCurrentStep(4);
    setStepStatus((prev) => ({ ...prev, 4: "running" }));
    addLog(4, "running", "开始自动分集...");

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: fullText,
          allCharacters: characters.map((c) => ({ name: c.name, scope: c.scope })),
          allItems: items.map((item) => ({ name: item.name })),
          allEnvironments: environments.map((env) => ({ name: env.name })),
          modelConfig: getModelConfig(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setEpisodes(data.episodes);
      setExpandedEpisodeIndexes(new Set());
      setConfirmedEpisodeIndexes(new Set());
      addLog(4, "done", `分集完成，共 ${data.episodes.length} 集，使用资产库版本 ${lockedAssetLibraryVersionId}`);
      setStepStatus((prev) => ({ ...prev, 4: "done" }));
      await saveDraft({
        ...buildDraftPayload(),
        currentStep: 4,
        stepStatus: { ...stepStatus, 4: "done" },
        episodes: data.episodes,
        confirmedEpisodeIndexes: [],
        assetLibraryVersionId: lockedAssetLibraryVersionId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Split failed";
      addLog(4, "error", `分集失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 4: "error" }));
    } finally {
      splitRunningRef.current = false;
    }
  }

  // ── Step 5: Generate (triggered by user after reviewing episodes) ──
  async function runGenerate() {
    if (episodes.length === 0 || confirmedEpisodeIndexes.size !== episodes.length) {
      toast.error(t("confirmAllEpisodesRequired"));
      return;
    }
    if (!confirmedScriptVersionId) {
      toast.error("请先确认剧本正文，再生成项目内容");
      return;
    }
    if (!assetLibraryVersionId) {
      toast.error("请先确认资产并锁定资产库版本，再生成项目内容");
      return;
    }

    setCurrentStep(5);
    setStepStatus((prev) => ({ ...prev, 5: "running" }));
    addLog(5, "running", `创建 ${episodes.length} 集、角色并复用资产库版本 ${assetLibraryVersionId}...`);

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodes,
          characters,
          items,
          environments,
          voices,
          relationships,
          confirmedScriptVersionId,
          assetLibraryVersionId,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json() as {
        episodes: Array<{ id: string }>;
        characterCount: number;
        itemCount?: number;
        environmentCount?: number;
        voiceCount?: number;
        assetLibraryVersionId?: string;
      };
      const lockedAssetLibraryVersionId = data.assetLibraryVersionId || null;
      if (!lockedAssetLibraryVersionId) {
        throw new Error("导入接口没有返回 assetLibraryVersionId");
      }
      setAssetLibraryVersionId(lockedAssetLibraryVersionId);
      addLog(5, "done", `导入完成！创建了 ${data.characterCount} 个角色、${data.itemCount || 0} 个物品、${data.environmentCount || 0} 个环境、${data.voiceCount || 0} 个音色和 ${data.episodes.length} 集，已锁定资产库版本 ${lockedAssetLibraryVersionId}`);
      setStepStatus((prev) => ({ ...prev, 5: "done" }));
      await saveDraft({
        ...buildDraftPayload(),
        currentStep: 5,
        stepStatus: { ...stepStatus, 5: "done" },
        assetLibraryVersionId: lockedAssetLibraryVersionId,
      });
      toast.success(t("complete"));
      setTimeout(() => {
        router.push(`/${locale}/project/${projectId}/episodes`);
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generate failed";
      addLog(5, "error", `创建失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 5: "error" }));
    }
  }

  // Retry handler for any failed step
  function retryStep() {
    const failedStep = ([1, 2, 3, 4, 5] as Step[]).find((s) => stepStatus[s] === "error");
    if (!failedStep) return;
    switch (failedStep) {
      case 1: // Re-run full pipeline (need file again)
        startPipeline();
        break;
      case 2:
        runStoryReview();
        break;
      case 3:
        retryCharacterExtract();
        break;
      case 4:
        runSplit();
        break;
      case 5:
        runGenerate();
        break;
    }
  }

  function updateEpisode(idx: number, field: keyof SplitEpisode, value: string) {
    setEpisodes((prev) =>
      prev.map((ep, i) => (i === idx ? { ...ep, [field]: value } : ep))
    );
    setConfirmedEpisodeIndexes((prev) => {
      if (!prev.has(idx)) return prev;
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  }

  function removeEpisode(idx: number) {
    setEpisodes((prev) => prev.filter((_, i) => i !== idx));
    setExpandedEpisodeIndexes((prev) => {
      const next = new Set<number>();
      prev.forEach((index) => {
        if (index < idx) next.add(index);
        if (index > idx) next.add(index - 1);
      });
      return next;
    });
    setConfirmedEpisodeIndexes((prev) => {
      const next = new Set<number>();
      prev.forEach((index) => {
        if (index < idx) next.add(index);
        if (index > idx) next.add(index - 1);
      });
      return next;
    });
    setEpisodeDeleteIndex(null);
  }

  function toggleEpisodeExpanded(idx: number) {
    setExpandedEpisodeIndexes((prev) => {
      if (prev.has(idx)) return new Set();
      return new Set([idx]);
    });
  }

  function confirmEpisode(idx: number) {
    setConfirmedEpisodeIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  function confirmAllEpisodes() {
    setConfirmedEpisodeIndexes(new Set(episodes.map((_, index) => index)));
  }

  function goToStep(step: Step) {
    if (step === 1 && (stepStatus[2] === "done" || currentStep >= 3)) return;

    setHistoryMode(false);
    setSelectedStep(null);
    setCurrentStep(step);

    if (step <= 2) {
      storyReviewedRef.current = false;
      setCharacters([]);
      setItems([]);
      setEnvironments([]);
      setVoices([]);
      setRelationships([]);
      setEpisodes([]);
      setExpandedEpisodeIndexes(new Set());
      setConfirmedEpisodeIndexes(new Set());
      setStepStatus((prev) => ({
        ...prev,
        2: "idle",
        3: "idle",
        4: "idle",
        5: "idle",
      }));
      return;
    }

    if (step === 3) {
      setEpisodes([]);
      setExpandedEpisodeIndexes(new Set());
      setConfirmedEpisodeIndexes(new Set());
      setStepStatus((prev) => ({
        ...prev,
        3: prev[3] === "idle" ? "done" : prev[3],
        4: "idle",
        5: "idle",
      }));
      return;
    }

    if (step === 4) {
      setStepStatus((prev) => ({
        ...prev,
        4: prev[4] === "idle" ? "done" : prev[4],
        5: "idle",
      }));
    }
  }

  const stepIcon = (status: string) => {
    switch (status) {
      case "running": return <Loader2 className="h-4 w-4 animate-spin" />;
      case "done": return <Check className="h-4 w-4" />;
      case "error": return <AlertCircle className="h-4 w-4" />;
      default: return null;
    }
  };

  const stepColor = (status: string, selected: boolean) => {
    const base = (() => {
      switch (status) {
        case "running": return "border-primary/30 bg-primary/5 text-primary";
        case "done": return "border-transparent bg-[--surface] text-[--text-primary]";
        case "error": return "border-red-300 bg-red-50 text-red-500";
        default: return "border-transparent bg-[--surface] text-[--text-muted]";
      }
    })();
    if (selected) return base + " !bg-primary/10 !border-primary/40 !text-primary shadow-sm";
    return base;
  };

  const showStoryReview = currentStep === 2 && stepStatus[1] === "done" && stepStatus[2] !== "done" && !historyMode;
  const showCharReview = forceAssetWorkbench || ((stepStatus[3] === "done" && stepStatus[4] === "idle") && !historyMode);
  const showEpReview = stepStatus[4] === "done" && stepStatus[5] === "idle" && !historyMode;
  const hideParseStep = stepStatus[2] === "done" || currentStep >= 3;
  const visibleSteps = hideParseStep ? STEPS.filter(({ num }) => num !== 1) : STEPS;
  const enrichmentRunning = Boolean(enrichmentJobStatus && (enrichmentJobStatus.status === "queued" || enrichmentJobStatus.status === "running"));
  const reviewRunning = stepStatus[2] === "running" && !enrichmentRunning;
  const stepTwoBusy = enrichmentRunning || reviewRunning;
  const unresolvedIssueCount = reviewIssues.filter((issue) => !issue.applied && !issue.waived).length;
  const unresolvedHighIssueCount = reviewIssues.filter((issue) =>
    issue.severity === "high" && !issue.applied && !issue.waived
  ).length;
  const storyReviewMissingMetaLabels = missingStoryMetaLabels(storyAnalysis);
  const intakeReviewRunning = isActiveIntakeStatus(intakeJobStatus);
  const storyReviewGateWarnings = [
    intakeReviewRunning ? `剧本标准化仍在运行：${intakeJobStatus?.current_stage || intakeJobStatus?.status || "处理中"} ${Math.round(intakeJobStatus?.progress || 0)}%` : "",
    storyReviewMissingMetaLabels.length > 0 ? `故事设定待补全：${storyReviewMissingMetaLabels.join("、")}` : "",
    unresolvedHighIssueCount > 0 ? `高危问题待处理：${unresolvedHighIssueCount} 项` : "",
  ].filter(Boolean);
  const intakeRevisionSummaries = collectIntakeRevisionSummaries(intakeJobStatus);
  const storyReviewHardGateWarnings = [
    intakeReviewRunning ? "intake_running" : "",
    storyReviewMissingMetaLabels.length > 0 ? "missing_story_meta" : "",
  ].filter(Boolean);
  const unresolvedHighAutoIssueCount = reviewIssues.filter((issue) =>
    issue.severity === "high" && !issue.applied && !issue.waived && Boolean(issue.exactQuote) && fullText.includes(issue.exactQuote)
  ).length;
  const unresolvedHighManualIssueCount = Math.max(0, unresolvedHighIssueCount - unresolvedHighAutoIssueCount);
  const selectableIssueIndexes = reviewIssues
    .map((issue, index) => ({ issue, index }))
    .filter(({ issue }) => !issue.applied && !issue.waived && Boolean(issue.exactQuote) && fullText.includes(issue.exactQuote))
    .map(({ index }) => index);
  const selectedApplicableIssueCount = selectableIssueIndexes.filter((index) => selectedIssueIndexes.has(index)).length;
  const allSelectableIssuesSelected = selectableIssueIndexes.length > 0
    && selectableIssueIndexes.every((index) => selectedIssueIndexes.has(index));
  const severityLabel: Record<StoryReviewIssue["severity"], string> = {
    high: t("severityHigh"),
    medium: t("severityMedium"),
    low: t("severityLow"),
  };

  const activeAssetList = useMemo<WorkbenchAsset[]>(() => {
    if (activeAssetTab === "characters") return characters;
    if (activeAssetTab === "items") return items;
    if (activeAssetTab === "environments") return environments;
    return voices;
  }, [activeAssetTab, characters, items, environments, voices]);
  const activeAssetIndex = activeAssetList.findIndex((asset, index) =>
    getAssetKey(asset, index, activeAssetTab) === activeAssetKey
  );
  const activeWorkbenchAsset = activeAssetIndex >= 0 ? activeAssetList[activeAssetIndex] : activeAssetList[0];
  const activeWorkbenchAssetIndex = activeAssetIndex >= 0 ? activeAssetIndex : activeAssetList.length ? 0 : -1;
  const activeWorkbenchKey = activeWorkbenchAssetIndex >= 0
    ? getAssetKey(activeWorkbenchAsset, activeWorkbenchAssetIndex, activeAssetTab)
    : "";

  useEffect(() => {
    if (!activeAssetList.length) {
      if (activeAssetKey) setActiveAssetKey("");
      return;
    }
    const exists = activeAssetList.some((asset, index) => getAssetKey(asset, index, activeAssetTab) === activeAssetKey);
    if (!exists) {
      setActiveAssetKey(getAssetKey(activeAssetList[0], 0, activeAssetTab));
    }
  }, [activeAssetKey, activeAssetList, activeAssetTab]);

  function invalidateAssetLibraryVersion() {
    if (assetLibraryVersionId) setAssetLibraryVersionId(null);
  }

  function updateActiveWorkbenchAsset(patch: Partial<WorkbenchAsset>) {
    if (activeWorkbenchAssetIndex < 0) return;
    invalidateAssetLibraryVersion();
    if (activeAssetTab === "characters") {
      setCharacters((prev) => prev.map((asset, index) => index === activeWorkbenchAssetIndex ? { ...asset, ...patch } as ExtractedCharacter : asset));
    } else if (activeAssetTab === "items") {
      setItems((prev) => prev.map((asset, index) => index === activeWorkbenchAssetIndex ? { ...asset, ...patch } : asset));
    } else if (activeAssetTab === "environments") {
      setEnvironments((prev) => prev.map((asset, index) => index === activeWorkbenchAssetIndex ? { ...asset, ...patch } : asset));
    } else {
      setVoices((prev) => prev.map((asset, index) => index === activeWorkbenchAssetIndex ? { ...asset, ...patch } : asset));
    }
  }

  function getAssetSetter(tab: AssetTab): Dispatch<SetStateAction<WorkbenchAsset[]>> {
    if (tab === "characters") return setCharacters as Dispatch<SetStateAction<WorkbenchAsset[]>>;
    if (tab === "items") return setItems as Dispatch<SetStateAction<WorkbenchAsset[]>>;
    if (tab === "environments") return setEnvironments as Dispatch<SetStateAction<WorkbenchAsset[]>>;
    return setVoices as Dispatch<SetStateAction<WorkbenchAsset[]>>;
  }

  function getWorkbenchAssetList(tab: AssetTab): WorkbenchAsset[] {
    if (tab === "characters") return characters;
    if (tab === "items") return items;
    if (tab === "environments") return environments;
    return voices;
  }

  function assetCategoryForTab(tab: AssetTab) {
    if (tab === "items") return "props";
    if (tab === "environments") return "scenes";
    return tab;
  }

  function sizeForAssetTab(tab: AssetTab) {
    return tab === "voices" ? "1024x1024" : "1536x1024";
  }

  function makeHistoryEntry(result: Record<string, unknown>) {
    return {
      at: new Date().toISOString(),
      provider: result.provider,
      status: result.status,
      imageUrl: result.imageUrl || "",
    };
  }

  function makeManualHistoryEntry(result: Record<string, unknown>, note: string) {
    return {
      at: new Date().toISOString(),
      provider: result.provider || "manual-upload",
      status: result.status || "succeeded",
      imageUrl: result.imageUrl || "",
      audioUrl: result.audioUrl || "",
      note,
    };
  }

  function formatHistoryTime(value: unknown) {
    if (typeof value !== "string") return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getHistoryLabel(entry: Record<string, unknown>) {
    const provider = typeof entry.provider === "string" ? entry.provider : "history";
    const status = typeof entry.status === "string" ? entry.status : "";
    const instruction = typeof entry.editInstruction === "string" ? entry.editInstruction : "";
    const note = typeof entry.note === "string" ? entry.note : "";
    return instruction || note || `${provider}${status ? ` · ${status}` : ""}`;
  }

  function patchWorkbenchAsset(
    tab: AssetTab,
    assetIndex: number,
    patcher: (asset: WorkbenchAsset) => WorkbenchAsset,
    options?: { persist?: boolean },
  ) {
    if (options?.persist) immediateDraftSaveRef.current = true;
    invalidateAssetLibraryVersion();
    const setter = getAssetSetter(tab);
    setter((prev) => prev.map((asset, index) => index === assetIndex ? patcher(asset) : asset));
  }

  function updateWorkbenchVariant(variantIndex: number, patch: Partial<AssetVariant>) {
    if (activeWorkbenchAssetIndex < 0) return;
    patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => {
      const variants = [...(current.variants || [])];
      const currentVariant = variants[variantIndex];
      if (!currentVariant) return current;
      variants[variantIndex] = { ...currentVariant, ...patch };
      return { ...current, variants };
    });
  }

  function addWorkbenchVariant() {
    if (activeWorkbenchAssetIndex < 0 || activeAssetTab === "voices") return;
    patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => {
      const nextIndex = (current.variants || []).length + 1;
      const isCharacter = activeAssetTab === "characters";
      const variantName = `${current.name || "资产"}自定义变体${nextIndex}`;
      return {
        ...current,
        variants: [
          ...(current.variants || []),
          {
            id: `${current.assetId || current.name || "asset"}-variant-${Date.now()}-${nextIndex}`,
            name: variantName,
            description: isCharacter
              ? "自定义剧情状态：保持同一人物脸型、五官和辨识度，仅根据当前剧情调整发型、服装、妆造和表情。"
              : "自定义变体：根据当前使用场景调整状态、角度或细节。",
            prompt: isCharacter
              ? `人物资产变体，${current.name || "角色"}，自定义剧情状态，严格保持同一角色身份、脸型、五官、眉眼鼻唇比例、骨相和面部辨识度；只允许调整发型、服装、妆造强弱和剧情状态，真人实拍质感。`
              : "基于主图生成指定变体，不改变资产身份。",
            imageUrl: "",
            history: [],
            editInstruction: "",
          },
        ],
      };
    });
    toast.success("已新增自定义变体");
  }

  function renameWorkbenchAsset(tab: AssetTab, assetIndex: number) {
    const list = getWorkbenchAssetList(tab);
    const asset = list[assetIndex];
    if (!asset) return;
    const nextName = window.prompt("请输入新的名称", asset.name)?.trim();
    if (!nextName || nextName === asset.name) return;
    patchWorkbenchAsset(tab, assetIndex, (current) => ({
      ...current,
      name: nextName,
      mainImageName: current.mainImageName === current.name || !current.mainImageName ? nextName : current.mainImageName,
      visualHint: current.visualHint === current.name || !current.visualHint ? nextName : current.visualHint,
    }));
    if (tab === activeAssetTab && getAssetKey(asset, assetIndex, tab) === activeAssetKey) {
      setActiveAssetKey(getAssetKey({ ...asset, name: nextName }, assetIndex, tab));
    }
    toast.success("名称已更新");
  }

  function deleteWorkbenchAsset(tab: AssetTab, assetIndex: number) {
    const list = getWorkbenchAssetList(tab);
    const asset = list[assetIndex];
    if (!asset) return;
    if (!window.confirm(`确定删除「${asset.name}」吗？`)) return;
    const key = getAssetKey(asset, assetIndex, tab);
    const setter = getAssetSetter(tab);
    invalidateAssetLibraryVersion();
    setter((prev) => prev.filter((_, index) => index !== assetIndex));
    setActiveAssetKey((current) => (current === key ? "" : current));
    toast.success("已删除资产");
  }

  function makeVariantPromptFromDescription(asset: WorkbenchAsset, variant: AssetVariant, tab: AssetTab) {
    const description = String(variant.description || variant.prompt || "").trim();
    const variantName = String(variant.name || "").trim();
    const identityRule = tab === "characters"
      ? "严格保持主图同一角色身份、脸型、五官、眉眼鼻唇比例、骨相和面部辨识度；只允许改变发型、服装、妆造强弱、表情动作和剧情状态；真人实拍质感，禁止漫画、二次元、插画风。"
      : "严格保持同一资产的核心造型、材质、比例和辨识度；只围绕变体要求调整状态、角度、细节或剧情使用状态。";
    return [
      variantName ? `变体名称：${variantName}` : "",
      description ? `变体生成要求：${description}` : "",
      identityRule,
      asset.faceTemplate?.label ? `参考模板：${asset.faceTemplate.label}` : "",
      asset.faceTemplate?.note ? `模板约束：${asset.faceTemplate.note}` : "",
    ].filter(Boolean).join("\n");
  }

  function resolveVariantPrompt(asset: WorkbenchAsset, variant: AssetVariant, tab: AssetTab) {
    const variantPrompt = makeVariantPromptFromDescription(asset, variant, tab);
    const basePrompt = String(asset.prompt || "").trim();
    if (!variantPrompt.trim()) return basePrompt;
    return [
      basePrompt,
      "基于主图生成指定变体，不改变资产身份：",
      variantPrompt,
    ].filter(Boolean).join("\n\n");
  }

  function openImagePreview(title: string, imageUrl?: string) {
    if (!imageUrl) {
      toast.error("暂无可预览图片");
      return;
    }
    setImagePreview({ title, imageUrl });
  }

  function playVoiceSample(audioUrl?: string) {
    if (!audioUrl) {
      toast.error("请先上传音频");
      return;
    }
    const audio = new Audio(displayImageUrl(audioUrl));
    void audio.play().catch(() => toast.error("音频播放失败"));
  }

  function openAssetHistory(tab: AssetTab, assetIndex: number) {
    const list = getWorkbenchAssetList(tab);
    const asset = list[assetIndex] as WorkbenchAsset | undefined;
    const entries = asset?.history || [];
    if (!entries.length) {
      toast.error("暂无生图历史");
      return;
    }
    setHistoryDialog({
      title: `${asset?.name || "资产"} 生图历史`,
      tab,
      assetIndex,
      entries,
    });
  }

  function openVariantHistory(tab: AssetTab, assetIndex: number, variantIndex: number) {
    const list = getWorkbenchAssetList(tab);
    const asset = list[assetIndex] as WorkbenchAsset | undefined;
    const variant = asset?.variants?.[variantIndex];
    const entries = variant?.history || [];
    if (!entries.length) {
      toast.error("暂无生图历史");
      return;
    }
    setHistoryDialog({
      title: `${asset?.name || "资产"} · ${variant?.name || "变体"} 生图历史`,
      tab,
      assetIndex,
      variantIndex,
      entries,
    });
  }

  function restoreHistoryImage(
    tab: AssetTab,
    assetIndex: number,
    imageUrl: string,
    variantIndex?: number,
  ) {
    if (!imageUrl) return;
    patchWorkbenchAsset(tab, assetIndex, (current) => {
      if (typeof variantIndex === "number") {
        const variants = [...(current.variants || [])];
        const currentVariant = variants[variantIndex];
        if (!currentVariant) return current;
        variants[variantIndex] = { ...currentVariant, imageUrl };
        return { ...current, variants };
      }
      return { ...current, imageUrl };
    }, { persist: true });
    toast.success("已恢复历史图片");
  }

  function restoreHistoryAudio(tab: AssetTab, assetIndex: number, audioUrl: string) {
    if (!audioUrl || tab !== "voices") return;
    patchWorkbenchAsset(tab, assetIndex, (current) => ({ ...current, audioUrl }), { persist: true });
    toast.success("已恢复历史音频");
  }

  async function generateWorkbenchAsset(
    tab: AssetTab,
    assetIndex: number,
    variantIndex?: number,
    options: { quiet?: boolean; keepBusy?: boolean; referenceImages?: string[] } = {},
  ) {
    if (tab === "voices") return false;
    const sourceList = tab === "characters" ? characters : tab === "items" ? items : environments;
    const asset = sourceList[assetIndex] as WorkbenchAsset | undefined;
    if (!asset) return false;

    const variant = typeof variantIndex === "number" ? asset.variants?.[variantIndex] : undefined;
    const target = variant || asset;
    const prompt = variant ? resolveVariantPrompt(asset, variant, tab) : (target.prompt || asset.prompt || "");
    if (!prompt.trim()) {
      toast.error(t("assetPromptMissing"));
      return false;
    }
    if (variant && !asset.imageUrl) {
      toast.error("请先生成或上传主图，变体会基于主图修改生成");
      return false;
    }

    const targetKey = `${tab}:${assetIndex}:${variantIndex ?? "main"}`;
    if (!options.keepBusy) beginAssetGenerating(targetKey);

    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/import/${variant ? "edit-image" : "generate-image"}`,
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(variant
          ? {
              imageUrl: options.referenceImages?.[0] || asset.imageUrl,
              editPrompt: prompt,
              prompt: asset.prompt || "",
              negativePrompt: asset.negativePrompt,
              category: assetCategoryForTab(tab),
              asset,
              size: sizeForAssetTab(tab),
              targetName: target.name,
              targetType: "variant",
            }
          : {
              category: assetCategoryForTab(tab),
              asset,
              prompt,
              negativePrompt: asset.negativePrompt,
              size: sizeForAssetTab(tab),
              targetName: target.name,
              targetType: "main",
              referenceImages: [
                ...(options.referenceImages || []),
                ...(asset.faceTemplate?.url ? [asset.faceTemplate.url] : []),
              ],
            }),
        },
      );
      const result = await res.json();
      if (!res.ok || result.status !== "succeeded" || !result.imageUrl) {
        throw new Error(result.error || result.message || "image2 生成失败");
      }

      patchWorkbenchAsset(tab, assetIndex, (current) => {
        const historyEntry = makeHistoryEntry(result);
        if (typeof variantIndex === "number") {
          const variants = [...(current.variants || [])];
          const currentVariant = variants[variantIndex];
          if (!currentVariant) return current;
          variants[variantIndex] = {
            ...currentVariant,
            imageUrl: result.imageUrl || "",
            history: [historyEntry, ...(currentVariant.history || [])],
          };
          return { ...current, variants };
        }
        return {
          ...current,
          imageUrl: result.imageUrl || "",
          history: [historyEntry, ...(current.history || [])],
        };
      }, { persist: true });

      if (!options.quiet) toast.success(t("assetGenerateSuccess", { name: target.name || asset.name }));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "image2 生成失败";
      patchWorkbenchAsset(tab, assetIndex, (current) => {
        const failedEntry = {
          at: new Date().toISOString(),
          provider: "jimapi:image2",
          status: "failed",
          error: msg,
        };
        if (typeof variantIndex === "number") {
          const variants = [...(current.variants || [])];
          const currentVariant = variants[variantIndex];
          if (!currentVariant) return current;
          variants[variantIndex] = {
            ...currentVariant,
            history: [failedEntry, ...(currentVariant.history || [])],
          };
          return { ...current, variants };
        }
        return {
          ...current,
          history: [failedEntry, ...(current.history || [])],
        };
      }, { persist: true });
      if (!options.quiet) toast.error(msg);
      return false;
    } finally {
      if (!options.keepBusy) endAssetGenerating(targetKey);
    }
  }

  async function downloadWorkbenchImage(imageUrl: string, filenameBase: string) {
    const filename = `${slugifyFileName(filenameBase || "image")}.png`;
    const safeUrl = displayImageUrl(imageUrl);
    try {
      const res = await fetch(safeUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerDownload(objectUrl, filename);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      triggerDownload(safeUrl, filename);
    }
  }

  function displayImageUrl(imageUrl: string) {
    if (!imageUrl || imageUrl.startsWith("data:") || /^https?:\/\//i.test(imageUrl)) return imageUrl;
    return imageUrl
      .split("/")
      .map((part, index) => index === 0 ? part : encodeURIComponent(part))
      .join("/");
  }

  function triggerDownload(href: string, filename: string) {
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.rel = "noreferrer";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function slugifyFileName(value: string) {
    return String(value || "image")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "image";
  }

  function isRedundantBaseVariant(variant?: AssetVariant) {
    const text = `${variant?.name || ""} ${variant?.description || ""} ${variant?.prompt || ""}`;
    return /基础三视图|基础主形象|主形象版本|保持人物一致/.test(text);
  }

  async function generateActiveWorkbenchAsset(variantIndex?: number) {
    if (activeWorkbenchAssetIndex < 0) return;
    await generateWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, variantIndex);
  }

  async function generateActiveWorkbenchVariantsFromMain() {
    if (activeWorkbenchAssetIndex < 0 || activeAssetTab === "voices") return;
    const asset = activeWorkbenchAsset;
    if (!asset?.imageUrl) {
      toast.error("请先生成或上传主图");
      return;
    }
    const variants = asset.variants || [];
    const variantJobs = variants
      .map((variant, index) => ({ variant, index }))
      .filter(({ variant }) => !isRedundantBaseVariant(variant));
    if (!variantJobs.length) {
      toast.error("没有需要生成的差异变体；基础三视图已由主图覆盖");
      return;
    }

    const variantsTargetKey = `${activeAssetTab}:${activeWorkbenchAssetIndex}:variants`;
    beginAssetGenerating(variantsTargetKey);
    let successCount = 0;
    for (const { index: variantIndex } of variantJobs) {
      const ok = await generateWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, variantIndex, {
        quiet: true,
        keepBusy: true,
        referenceImages: [asset.imageUrl],
      });
      if (ok) successCount += 1;
    }
    endAssetGenerating(variantsTargetKey);
    toast.success(`已生成 ${successCount}/${variants.length} 个变体`);
  }

  async function uploadWorkbenchImage(file: File, variantIndex?: number) {
    if (activeWorkbenchAssetIndex < 0) return;
    const isVoice = activeAssetTab === "voices";
    if (isVoice && typeof variantIndex === "number") return;
    if (isVoice && !file.type.startsWith("audio/")) {
      toast.error("请选择音频文件");
      return;
    }
    if (!isVoice && !file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    const targetKey = `${activeAssetTab}:${activeWorkbenchAssetIndex}:${variantIndex ?? "main"}`;
    setAssetUploadingTarget(targetKey);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", isVoice ? "audio" : "image");
      formData.append("targetType", typeof variantIndex === "number" ? "variant" : "main");
      formData.append("targetName", typeof variantIndex === "number"
        ? activeWorkbenchAsset?.variants?.[variantIndex]?.name || ""
        : activeWorkbenchAsset?.name || "");

      const res = await apiFetch(`/api/projects/${projectId}/import/${isVoice ? "upload-asset" : "upload-image"}`, {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (result.status === "error") throw new Error(result.error || "上传失败");

      patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => {
        const historyEntry = makeManualHistoryEntry(result, "手动上传");
        if (isVoice) {
          return {
            ...current,
            audioUrl: result.audioUrl || "",
            history: [historyEntry, ...(current.history || [])],
          };
        }
        if (typeof variantIndex === "number") {
          const variants = [...(current.variants || [])];
          const currentVariant = variants[variantIndex];
          if (!currentVariant) return current;
          variants[variantIndex] = {
            ...currentVariant,
            imageUrl: result.imageUrl || "",
            history: [historyEntry, ...(currentVariant.history || [])],
          };
          return { ...current, variants };
        }
        return {
          ...current,
          imageUrl: result.imageUrl || "",
          history: [historyEntry, ...(current.history || [])],
        };
      }, { persist: true });

      toast.success(isVoice ? "音频已上传" : "图片已上传");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setAssetUploadingTarget(null);
    }
  }

  function updateMainEditInstruction(editInstruction: string) {
    if (activeWorkbenchAssetIndex < 0) return;
    patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => ({ ...current, editInstruction }));
  }

  function updateVariantEditInstruction(variantIndex: number, editInstruction: string) {
    updateWorkbenchVariant(variantIndex, { editInstruction });
  }

  async function editWorkbenchMainImage() {
    if (activeWorkbenchAssetIndex < 0 || activeAssetTab === "voices") return;
    const asset = activeWorkbenchAsset;
    if (!asset) return;
    if (!asset.imageUrl) {
      toast.error("请先生成或上传主图");
      return;
    }
    const editInstruction = String(asset.editInstruction || "").trim();
    if (!editInstruction) {
      toast.error("请先填写主图改图要求");
      return;
    }

    const targetKey = `${activeAssetTab}:${activeWorkbenchAssetIndex}:main`;
    setAssetEditingTarget(targetKey);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/edit-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: asset.imageUrl,
          editPrompt: editInstruction,
          prompt: asset.prompt || "",
          negativePrompt: asset.negativePrompt,
          category: assetCategoryForTab(activeAssetTab),
          asset,
          size: sizeForAssetTab(activeAssetTab),
          targetName: getAssetPreviewLabel(asset, activeAssetTab),
          targetType: "main-edit",
        }),
      });
      const result = await res.json();
      if (!res.ok || result.status !== "succeeded" || !result.imageUrl) {
        throw new Error(result.error || result.message || "改图失败");
      }

      patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => {
        const historyEntry = {
          ...makeHistoryEntry(result),
          editInstruction,
          sourceImageUrl: current.imageUrl || "",
        };
        return {
          ...current,
          imageUrl: result.imageUrl || current.imageUrl,
          editInstruction: "",
          history: [historyEntry, ...(current.history || [])],
        };
      }, { persist: true });

      toast.success("主图已改图");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "改图失败";
      patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => ({
        ...current,
        history: [{
          at: new Date().toISOString(),
          provider: "jimapi:image-edit",
          status: "failed",
          editInstruction,
          error: msg,
        }, ...(current.history || [])],
      }));
      toast.error(msg);
    } finally {
      setAssetEditingTarget(null);
    }
  }

  async function editWorkbenchVariant(variantIndex: number) {
    if (activeWorkbenchAssetIndex < 0 || activeAssetTab === "voices") return;
    const asset = activeWorkbenchAsset;
    const variant = asset?.variants?.[variantIndex];
    if (!asset || !variant) return;
    if (!variant.imageUrl) {
      toast.error("请先生成或上传变体图");
      return;
    }
    const editInstruction = String(variant.editInstruction || "").trim();
    if (!editInstruction) {
      toast.error("请先填写改图要求");
      return;
    }

    const targetKey = `${activeAssetTab}:${activeWorkbenchAssetIndex}:${variantIndex}`;
    setAssetEditingTarget(targetKey);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/edit-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: variant.imageUrl,
          editPrompt: editInstruction,
          prompt: resolveVariantPrompt(asset, variant, activeAssetTab),
          negativePrompt: asset.negativePrompt,
          category: assetCategoryForTab(activeAssetTab),
          asset,
          size: sizeForAssetTab(activeAssetTab),
          targetName: variant.name,
          targetType: "variant-edit",
        }),
      });
      const result = await res.json();
      if (!res.ok || result.status !== "succeeded" || !result.imageUrl) {
        throw new Error(result.error || result.message || "改图失败");
      }

      patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => {
        const variants = [...(current.variants || [])];
        const currentVariant = variants[variantIndex];
        if (!currentVariant) return current;
        const historyEntry = {
          ...makeHistoryEntry(result),
          editInstruction,
          sourceImageUrl: currentVariant.imageUrl || "",
        };
        variants[variantIndex] = {
          ...currentVariant,
          imageUrl: result.imageUrl || currentVariant.imageUrl,
          editInstruction: "",
          history: [historyEntry, ...(currentVariant.history || [])],
        };
        return { ...current, variants };
      }, { persist: true });

      toast.success("变体已改图");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "改图失败";
      patchWorkbenchAsset(activeAssetTab, activeWorkbenchAssetIndex, (current) => {
        const variants = [...(current.variants || [])];
        const currentVariant = variants[variantIndex];
        if (!currentVariant) return current;
        variants[variantIndex] = {
          ...currentVariant,
          history: [{
            at: new Date().toISOString(),
            provider: "jimapi:image-edit",
            status: "failed",
            editInstruction,
            error: msg,
          }, ...(currentVariant.history || [])],
        };
        return { ...current, variants };
      });
      toast.error(msg);
    } finally {
      setAssetEditingTarget(null);
    }
  }

  async function runAssetGenerationJobs(
    jobs: Array<{ assetIndex: number; variantIndex?: number }>,
    concurrency: number,
    worker: (job: { assetIndex: number; variantIndex?: number }) => Promise<boolean>,
  ) {
    let nextIndex = 0;
    let successCount = 0;

    async function runner() {
      while (nextIndex < jobs.length) {
        const job = jobs[nextIndex++];
        if (await worker(job)) successCount += 1;
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(Math.max(1, concurrency), jobs.length) }, () => runner()),
    );
    return successCount;
  }

  async function generateCurrentAssetTab() {
    if (activeAssetTab === "voices") return;
    const tab = activeAssetTab;
    const list = tab === "characters" ? characters : tab === "items" ? items : environments;
    if (!list.length) return;
    const categoryTargetKey = `${tab}:category`;
    beginAssetGenerating(categoryTargetKey);

    const jobs: Array<{ assetIndex: number; variantIndex?: number }> = [];
    for (let assetIndex = 0; assetIndex < list.length; assetIndex += 1) {
      jobs.push({ assetIndex });
    }

    try {
      const successCount = await runAssetGenerationJobs(jobs, 10, (job) =>
        generateWorkbenchAsset(tab, job.assetIndex, job.variantIndex, { quiet: true, keepBusy: true }),
      );
      if (successCount > 0) {
        toast.success(t("assetGenerateBatchSuccess", { count: successCount }));
      } else {
        toast.error("图片生成失败，请检查 image2/JimAPI 密钥配置");
      }
    } finally {
      endAssetGenerating(categoryTargetKey);
    }
  }

  async function generateAllMainImages() {
    const tabs: AssetTab[] = ["characters", "items", "environments"];
    const jobs: Array<{ tab: AssetTab; assetIndex: number }> = [];
    for (const tab of tabs) {
      const list = tab === "characters" ? characters : tab === "items" ? items : environments;
      for (let assetIndex = 0; assetIndex < list.length; assetIndex += 1) {
        jobs.push({ tab, assetIndex });
      }
    }
    if (!jobs.length) return;

    const targetKey = "all:main";
    beginAssetGenerating(targetKey);
    setAllMainGenerationProgress({ completed: 0, total: jobs.length });
    let successCount = 0;
    let completedCount = 0;
    let nextIndex = 0;

    async function runner() {
      while (nextIndex < jobs.length) {
        const job = jobs[nextIndex++];
        const ok = await generateWorkbenchAsset(job.tab, job.assetIndex, undefined, {
          quiet: true,
          keepBusy: true,
        });
        if (ok) successCount += 1;
        completedCount += 1;
        setAllMainGenerationProgress({ completed: completedCount, total: jobs.length });
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(10, jobs.length) }, () => runner()));
      if (successCount > 0) {
        toast.success(`已生成 ${successCount}/${jobs.length} 张主图`);
      } else {
        toast.error("图片生成失败，请检查 image2/JimAPI 密钥配置");
      }
    } finally {
      endAssetGenerating(targetKey);
    }
  }

  function assetTabInfo(tab: AssetTab) {
    if (tab === "characters") return { label: t("assetCharacters"), count: characters.length };
    if (tab === "items") return { label: t("assetItems"), count: items.length };
    if (tab === "environments") return { label: t("assetEnvironments"), count: environments.length };
    return { label: t("assetVoices"), count: voices.length };
  }

  function makeBlankAsset(tab: AssetTab): WorkbenchAsset {
    const label = assetTabInfo(tab).label;
    const nextIndex = (tab === "characters"
      ? characters.length
      : tab === "items"
        ? items.length
        : tab === "environments"
          ? environments.length
          : voices.length) + 1;
    const name = `新${label}${nextIndex}`;
    return {
      name,
      frequency: 1,
      description: "",
      visualHint: name,
      confirmed: false,
      assetId: `manual-${tab}-${Date.now()}`,
      category: assetCategoryForTab(tab),
      role: tab === "characters" ? "自定义角色" : label,
      roleKey: "manual",
      episodes: [],
      prompt: "",
      negativePrompt: tab === "voices" ? "" : "",
      variants: [],
      imageUrl: "",
      history: [],
      mainImageName: name,
      tags: ["手动添加"],
      ...(tab === "characters" ? { scope: "guest" as const } : {}),
    };
  }

  function addWorkbenchAsset(tab: AssetTab) {
    const asset = makeBlankAsset(tab);
    const key = getAssetKey(asset, tab === "characters"
      ? characters.length
      : tab === "items"
        ? items.length
        : tab === "environments"
          ? environments.length
          : voices.length, tab);
    if (tab === "characters") {
      setCharacters((prev) => [...prev, asset as ExtractedCharacter]);
    } else if (tab === "items") {
      setItems((prev) => [...prev, asset]);
    } else if (tab === "environments") {
      setEnvironments((prev) => [...prev, asset]);
    } else {
      setVoices((prev) => [...prev, asset]);
    }
    invalidateAssetLibraryVersion();
    setActiveAssetTab(tab);
    setActiveAssetKey(key);
    toast.success(`已添加${assetTabInfo(tab).label}`);
  }

  function confirmAllWorkbenchAssets() {
    invalidateAssetLibraryVersion();
    setCharacters((prev) => prev.map((asset) => ({ ...asset, confirmed: true })));
    setItems((prev) => prev.map((asset) => ({ ...asset, confirmed: true })));
    setEnvironments((prev) => prev.map((asset) => ({ ...asset, confirmed: true })));
    setVoices((prev) => prev.map((asset) => ({ ...asset, confirmed: true })));
    toast.success("已一键确定全部资产");
  }

  function getAssetPreviewLabel(asset: WorkbenchAsset, tab: AssetTab) {
    if (tab === "voices") return t("assetVoicePrompt");
    return asset.mainImageName || asset.visualHint || asset.name;
  }
  const categoryLabel: Record<StoryReviewIssue["category"], string> = {
    prohibited: t("reviewCategoryProhibited"),
    logic: t("reviewCategoryLogic"),
    continuity: t("reviewCategoryContinuity"),
    setting: t("reviewCategorySetting"),
    other: t("reviewCategoryOther"),
  };
  const reviewAssetSections = [
    {
      key: "characters",
      label: "人物",
      icon: Users,
      items: characters,
      getSubText: (item: WorkbenchAsset) => item.role || item.description || "角色资产",
    },
    {
      key: "scenes",
      label: "场景",
      icon: Layers,
      items: environments,
      getSubText: (item: WorkbenchAsset) => item.role || item.category || item.description || "环境资产",
    },
    {
      key: "props",
      label: "物品",
      icon: ImageIcon,
      items,
      getSubText: (item: WorkbenchAsset) => item.role || item.category || item.description || "道具资产",
    },
  ];
  const reviewAssetTotal = reviewAssetSections.reduce((sum, section) => sum + section.items.length, 0);
  const storyMetaRows = [
    ["time", "时间", storyAnalysis?.storyMeta?.time],
    ["background", "背景", storyAnalysis?.storyMeta?.background],
    ["visualStyleBase", "风格", storyAnalysis?.storyMeta?.visualStyleBase],
    ["genre", "题材", storyAnalysis?.storyMeta?.genre],
    ["locationBackground", "地域/空间", storyAnalysis?.storyMeta?.locationBackground],
  ] as const;

  const confirmedEpisodeCount = confirmedEpisodeIndexes.size;
  const allEpisodesConfirmed = episodes.length > 0 && confirmedEpisodeCount === episodes.length;
  const episodeConfirmProgress = t("episodeConfirmProgress", {
    confirmed: confirmedEpisodeCount,
    total: episodes.length,
  });
  const episodePendingDelete = episodeDeleteIndex === null ? null : episodes[episodeDeleteIndex];
  const allWorkbenchAssets = [...characters, ...items, ...environments, ...voices];
  const confirmedAssetCount = allWorkbenchAssets.filter((asset) => asset.confirmed === true).length;
  const allAssetsConfirmed = allWorkbenchAssets.length > 0 && confirmedAssetCount === allWorkbenchAssets.length;
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-[--surface]">
      {/* Top: Steps navigation */}
      <div className="shrink-0 border-b border-[--border-subtle] bg-white px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          <button
            onClick={() => router.push(`/${locale}`)}
            className="flex h-10 w-[180px] shrink-0 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-[--text-primary] transition-colors hover:bg-[--surface] hover:text-primary md:w-[220px]"
            title="返回项目"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="truncate">返回项目</span>
          </button>

          <div className="flex min-w-[760px] flex-1 gap-2">
            {visibleSteps.map(({ num, icon: Icon, label }) => {
              const isClickable = stepStatus[num] !== "idle" || currentStep >= num;
              const isSelected = selectedStep === num;
              return (
                <button
                  key={num}
                  disabled={!isClickable}
                  onClick={() => {
                    if (!isClickable) return;
                    goToStep(num);
                  }}
                  className={`relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 text-left transition-all duration-200 ${stepColor(stepStatus[num], isSelected)} ${isClickable ? "cursor-pointer hover:bg-primary/5" : ""}`}
                >
                  {isSelected && (
                    <div className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-primary" />
                  )}
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    stepStatus[num] === "done"
                      ? isSelected ? "bg-primary/15 text-primary" : "bg-emerald-100 text-emerald-600"
                      : stepStatus[num] === "running" ? "bg-primary/15"
                      : stepStatus[num] === "error" ? "bg-red-100"
                      : "bg-white"
                  }`}>
                    {stepIcon(stepStatus[num]) || <Icon className="h-4 w-4" />}
                  </div>
                  <span className="truncate text-xs font-medium xl:text-sm">{t(label)}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => router.push(`/${locale}/project/${projectId}/episodes`)}
              className="relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-transparent bg-[--surface] px-2.5 text-left text-[--text-primary] transition-all duration-200 hover:bg-primary/5 hover:text-primary"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white">
                <Layers className="h-4 w-4" />
              </div>
              <span className="truncate text-xs font-medium xl:text-sm">分集管理</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        {/* Upload area (only when no step started) */}
        {currentStep === 0 && !historyMode && (
          <div className="mx-auto w-full max-w-xl space-y-6">
            {/* Drop zone */}
            <div
              className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : file
                    ? "border-emerald-300 bg-emerald-50/50"
                    : "border-[--border-subtle] bg-white"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
              {file ? (
                <div className="flex items-center gap-3">
                  <FileText className="h-10 w-10 text-emerald-500" />
                  <div>
                    <p className="text-sm font-medium text-[--text-primary]">{file.name}</p>
                    <p className="text-xs text-[--text-muted]">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="ml-2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/5"
                  >
                    <X className="h-3.5 w-3.5 text-[--text-muted]" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="mb-3 h-10 w-10 text-[--text-muted]" />
                  <p className="text-sm font-medium text-[--text-primary]">{t("dropHint")}</p>
                  <p className="mt-1 text-xs text-[--text-muted]">{t("supportedFormats")}</p>
                </>
              )}
            </div>

            <Button
              onClick={startPipeline}
              disabled={!file}
              className="w-full rounded-xl"
              size="lg"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {t("startImport")}
            </Button>
          </div>
        )}

        {currentStep === 1 && !historyMode && intakeJobStatus && (
          <div className="mx-auto w-full max-w-2xl rounded-xl border border-[--border-subtle] bg-white p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[--text-primary]">剧本标准化</div>
                <div className="truncate text-xs text-[--text-muted]">
                  {intakeJobStatus.current_stage || intakeJobStatus.status}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[--text-secondary]">
                {(intakeJobStatus.status === "queued" || intakeJobStatus.status === "running") && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {Math.round(intakeJobStatus.progress || 0)}%
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[--surface]">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.max(0, Math.min(100, intakeJobStatus.progress || 0))}%` }}
              />
            </div>
          </div>
        )}

        {/* Story review gate (AI review, then human approval) */}
        {showStoryReview && (
          <div className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-bold text-[--text-primary]">
                  {t("reviewStory")}
                </h3>
                <p className="mt-1 text-sm text-[--text-muted]">
                  {t("reviewStoryHint")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-[--text-muted]">
                  {fullText.length.toLocaleString()} chars
                </span>
                <Button
                  variant="outline"
                  onClick={() => runStoryReview()}
                  disabled={stepTwoBusy || !fullText.trim() || !intakeJobId}
                  className="rounded-xl"
                >
                  {stepTwoBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {enrichmentRunning ? "AI补全中" : intakeJobId ? "刷新审阅结果" : "需重新标准化"}
                </Button>
                <Button
                  onClick={() => confirmStoryReview()}
                  disabled={
                    stepTwoBusy
                    || !fullText.trim()
                    || (!intakeJobId && !confirmedScriptVersionId)
                    || storyReviewHardGateWarnings.length > 0
                  }
                  className="rounded-xl"
                >
                  {t("confirmStoryReview")}
                </Button>
              </div>
            </div>

            {storyReviewGateWarnings.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
                <span className="font-semibold">确认前需完成</span>
                {storyReviewGateWarnings.map((warning) => (
                  <span key={warning} className="rounded-lg bg-white px-2 py-1">
                    {warning}
                  </span>
                ))}
                {unresolvedHighIssueCount > 0 && (
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={applyResolvableHighRiskIssues}
                      disabled={stepTwoBusy || unresolvedHighAutoIssueCount === 0}
                      className="h-8 rounded-lg border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
                    >
                      自动替换可定位高危 {unresolvedHighAutoIssueCount}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={resolveHighRisksAndConfirmStory}
                      disabled={stepTwoBusy || storyReviewHardGateWarnings.length > 0}
                      className="h-8 rounded-lg"
                    >
                      处理高危并进入资产设定
                      {unresolvedHighManualIssueCount > 0 ? `（人工确认 ${unresolvedHighManualIssueCount}）` : ""}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {intakeRevisionSummaries.length > 0 && (
              <div className="rounded-xl border border-[--border-subtle] bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[--text-primary]">AI 修改追踪</div>
                    <div className="text-xs text-[--text-muted]">
                      {intakeRevisionSummaries.length} 个阶段产生文本改动
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {intakeRevisionSummaries.map((revision) => (
                    <div key={revision.stage} className="rounded-lg border border-[--border-subtle] bg-[--surface] p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-xs font-bold text-[--text-primary]">{revision.label}</div>
                        <div className="text-[10px] font-semibold text-[--text-muted]">
                          {revision.changedLineCount} 行 · {revision.charDelta >= 0 ? "+" : ""}{revision.charDelta} 字
                        </div>
                      </div>
                      <div className="mb-2 text-[10px] text-[--text-muted]">
                        {revision.beforeHash} → {revision.afterHash}
                      </div>
                      <div className="space-y-2">
                        {revision.changedSamples.map((sample) => (
                          <div key={`${revision.stage}:${sample.lineNumber}`} className="space-y-1 text-[11px] leading-5">
                            <div className="font-semibold text-[--text-muted]">第 {sample.lineNumber} 行</div>
                            {sample.before && <div className="rounded bg-red-50 px-2 py-1 text-red-900">{sample.before}</div>}
                            {sample.after && <div className="rounded bg-emerald-50 px-2 py-1 text-emerald-900">{sample.after}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {enrichmentJobStatus && !detailSupplemented && (
              <div className="rounded-xl border border-[--border-subtle] bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[--text-primary]">AI 细节补全</div>
                    <div className="text-xs text-[--text-muted]">
                      {enrichmentJobStatus.current_episode || "准备中"}
                      {enrichmentJobStatus.current_scene ? ` / ${enrichmentJobStatus.current_scene}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {enrichmentJobStatus.failed_tasks > 0 && (
                      <Button variant="outline" size="sm" onClick={retryFailedEnrichmentJob} disabled={enrichmentRunning}>
                        重试失败
                      </Button>
                    )}
                    {enrichmentRunning && (
                      <Button variant="outline" size="sm" onClick={cancelEnrichmentJob}>
                        取消
                      </Button>
                    )}
                    <span className="rounded-lg bg-[--surface] px-2 py-1 text-xs font-semibold text-[--text-secondary]">
                      {enrichmentJobStatus.status}
                    </span>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[--surface]">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, enrichmentJobStatus.progress || 0))}%` }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-[--text-muted]">
                  <div>总任务 {enrichmentJobStatus.total_tasks}</div>
                  <div>完成 {enrichmentJobStatus.completed_tasks}</div>
                  <div>跳过 {enrichmentJobStatus.skipped_tasks}</div>
                  <div>失败 {enrichmentJobStatus.failed_tasks}</div>
                </div>
                {enrichmentJobStatus.recent_logs && enrichmentJobStatus.recent_logs.length > 0 && (
                  <div className="mt-3 max-h-24 space-y-1 overflow-y-auto rounded-lg bg-[--surface] p-2 text-xs text-[--text-muted]">
                    {enrichmentJobStatus.recent_logs.slice(-4).map((log) => (
                      <div key={log.id} className={log.level === "error" ? "text-red-500" : log.level === "warn" ? "text-amber-600" : ""}>
                        {log.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid min-h-0 flex-1 grid-cols-[minmax(520px,1fr)_300px_360px] gap-4">
              <div className="flex min-h-0 flex-col rounded-xl border border-[--border-subtle] bg-white">
                <div className="flex flex-wrap items-center gap-2 border-b border-[--border-subtle] p-3">
                  <Input
                    value={findText}
                    onChange={(e) => {
                      setFindText(e.target.value);
                      setFindMatchIndex(0);
                    }}
                    placeholder="查找文本"
                    className="h-8 min-w-40 flex-1 rounded-lg"
                  />
                  <Input
                    value={replaceText}
                    onChange={(e) => setReplaceText(e.target.value)}
                    placeholder="替换为"
                    className="h-8 min-w-40 flex-1 rounded-lg"
                  />
                  <span className="min-w-16 text-center text-xs text-[--text-muted]">
                    {findText ? `${findMatches.length} 处` : ""}
                  </span>
                  <Button variant="outline" size="sm" onClick={findNextMatch} disabled={!findText}>
                    查找下一个
                  </Button>
                  <Button variant="outline" size="sm" onClick={replaceCurrentMatch} disabled={!findText}>
                    替换
                  </Button>
                  <Button variant="outline" size="sm" onClick={replaceAllMatches} disabled={!findText}>
                    全部替换
                  </Button>
                </div>
                <div className="min-h-0 flex-1 p-3">
                <Textarea
                  ref={reviewTextRef}
                  value={fullText}
                  onChange={(e) => {
                    setFullText(e.target.value);
                    setConfirmedScriptVersionId(null);
                  }}
                  className="h-[60vh] resize-none border-0 bg-transparent font-mono text-sm leading-relaxed shadow-none focus-visible:ring-0"
                />
                </div>
              </div>

              <div className="flex min-h-0 flex-col rounded-xl border border-[--border-subtle] bg-white">
                <div className="flex items-center justify-between border-b border-[--border-subtle] p-3">
                  <div>
                    <div className="text-sm font-semibold text-[--text-primary]">资产</div>
                    <div className="text-xs text-[--text-muted]">
                      {reviewRunning ? "AI 正在解析资产" : `共 ${reviewAssetTotal} 个资产草稿`}
                    </div>
                  </div>
                  <span className="rounded-full bg-[--surface] px-2 py-0.5 text-xs font-semibold text-[--text-muted]">
                    AI
                  </span>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                  {reviewRunning && (
                    <div className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-sm text-primary">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在解析人物、场景和物品
                    </div>
                  )}

                  {!reviewRunning && (
                    <div className="rounded-lg border border-[--border-subtle] bg-[--surface] p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-xs font-bold text-[--text-secondary]">故事设定</div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          storyReviewMissingMetaLabels.length > 0
                            ? "bg-amber-50 text-amber-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}>
                          {storyReviewMissingMetaLabels.length > 0 ? `待补 ${storyReviewMissingMetaLabels.length}` : "完整"}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {storyMetaRows.map(([field, label, value]) => {
                          const missing = !String(value || "").trim();
                          return (
                            <div key={field} className="space-y-1">
                              <label className="text-[10px] font-semibold text-[--text-muted]">{label}</label>
                              <Textarea
                                value={value || ""}
                                onChange={(e) => updateStoryMetaField(field, e.target.value)}
                                className={`min-h-16 resize-none rounded-lg text-xs leading-relaxed ${
                                  missing ? "border-amber-200 bg-amber-50/40" : "bg-white"
                                }`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!reviewRunning && reviewAssetTotal === 0 && (
                    <div className="rounded-lg bg-emerald-50 p-3 text-sm leading-relaxed text-emerald-700">
                      AI 审阅通过并确认剧情后，会自动提取人物、场景、物品，并写入同一份资产草稿库。
                    </div>
                  )}

                  {!reviewRunning && reviewAssetSections.map((section) => {
                    const Icon = section.icon;
                    return (
                      <div key={section.key} className="rounded-lg border border-[--border-subtle]">
                        <div className="flex items-center justify-between border-b border-[--border-subtle] px-3 py-2">
                          <div className="flex items-center gap-2 text-sm font-semibold text-[--text-primary]">
                            <Icon className="h-4 w-4 text-primary" />
                            {section.label}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[--text-muted]">{section.items.length}</span>
                          </div>
                        </div>
                        <div className="max-h-44 overflow-y-auto p-2">
                          {section.items.length === 0 ? (
                            <div className="rounded-md border border-dashed border-[--border-subtle] p-3 text-center text-xs text-[--text-muted]">
                              暂无{section.label}
                            </div>
                          ) : (
                            section.items.map((item, index) => (
                              <div key={`${section.key}:${item.assetId || item.name}:${index}`} className="mb-2 rounded-md bg-[--surface] p-2 last:mb-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="truncate text-xs font-bold text-[--text-primary]">{item.name || `${section.label}资产`}</div>
                                    <div className="mt-0.5 truncate text-[10px] text-[--text-muted]">{section.getSubText(item)}</div>
                                  </div>
                                  {(item.variants?.length || 0) > 0 && (
                                    <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                      {item.variants?.length} 变体
                                    </span>
                                  )}
                                </div>
                                {item.description && (
                                  <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[--text-secondary]">
                                    {item.description}
                                  </p>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[--border-subtle] bg-white">
                <div className="flex items-center justify-between border-b border-[--border-subtle] p-3">
                  <div>
                    <div className="text-sm font-semibold text-[--text-primary]">{t("aiReviewIssues")}</div>
                    <div className="text-xs text-[--text-muted]">
                      {reviewRunning
                        ? t("aiReviewRunning")
                        : `${t("aiReviewIssueCount", { count: reviewIssues.length })} · 未处理 ${unresolvedIssueCount} · 已选 ${selectedApplicableIssueCount}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleAllIssueSelection}
                      disabled={reviewRunning || selectableIssueIndexes.length === 0}
                    >
                      {allSelectableIssuesSelected ? "取消全选" : "全选"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={applySelectedStoryIssues}
                      disabled={reviewRunning || selectedApplicableIssueCount === 0}
                    >
                      替换选中
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={applyAllStoryIssues}
                      disabled={reviewRunning || selectableIssueIndexes.length === 0}
                    >
                      {t("applyAllSuggestions")}
                    </Button>
                  </div>
                </div>

                <div className="max-h-[60vh] min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                  {reviewRunning && (
                    <div className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-sm text-primary">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("aiReviewRunning")}
                    </div>
                  )}

                  {!reviewRunning && reviewIssues.length === 0 && (
                    <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                      {t("aiReviewNotStarted")}
                    </div>
                  )}

                  {!reviewRunning && reviewIssues.map((issue, idx) => {
                    const isSelected = selectedIssueIndexes.has(idx);
                    const canApply = !issue.applied && !issue.waived && Boolean(issue.exactQuote) && fullText.includes(issue.exactQuote);
                    return (
                      <div
                        key={`${issue.exactQuote}:${idx}`}
                        className={`rounded-lg border p-3 transition-colors ${
                          activeIssueIndex === idx
                            ? "border-primary bg-primary/10"
                            : isSelected
                              ? "border-primary bg-primary/5"
                              : "border-[--border-subtle]"
                        }`}
                        onClick={() => scrollAndSelectQuote(issue, idx)}
                      >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!canApply}
                              onChange={() => toggleIssueSelection(idx)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 rounded border-[--border-subtle] accent-primary"
                            />
                            <span className="rounded bg-[--surface] px-1.5 py-0.5 text-[10px] font-semibold text-[--text-muted]">#{idx}</span>
                            <div className="text-sm font-semibold text-[--text-primary]">{issue.title}</div>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-medium">
                            <span className={`rounded px-1.5 py-0.5 ${
                              issue.severity === "high" ? "bg-red-50 text-red-600" :
                              issue.severity === "medium" ? "bg-amber-50 text-amber-600" :
                              "bg-blue-50 text-blue-600"
                            }`}>
                              {severityLabel[issue.severity]}
                            </span>
                            <span className="rounded bg-[--surface] px-1.5 py-0.5 text-[--text-muted]">
                              {categoryLabel[issue.category]}
                            </span>
                            {issue.applied && (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-600">
                                已替换
                              </span>
                            )}
                            {issue.waived && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                                已豁免
                              </span>
                            )}
                          </div>
                          {(issue.lineNumber || issue.sceneTitle || issue.episodeTitle) && (
                            <div className="mt-1 text-[10px] text-[--text-muted]">
                              {[issue.episodeTitle, issue.sceneTitle, issue.lineNumber ? `第 ${issue.lineNumber} 行` : ""].filter(Boolean).join(" / ")}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              applyStoryIssue(idx);
                            }}
                            disabled={issue.applied || issue.waived || !canApply}
                          >
                            {issue.applied ? t("appliedSuggestion") : t("applySuggestion")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              waiveStoryIssue(idx);
                            }}
                            disabled={issue.applied || issue.waived}
                          >
                            豁免
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2 text-xs">
                        {issue.context && !issue.exactQuote && (
                          <div>
                            <div className="mb-1 font-medium text-[--text-secondary]">定位上下文</div>
                            <div className="rounded bg-[--surface] p-2 text-[--text-secondary]">{issue.context}</div>
                          </div>
                        )}
                        {issue.exactQuote && (
                          <div>
                            <div className="mb-1 font-medium text-[--text-secondary]">{t("originalText")}</div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                scrollAndSelectQuote(issue, idx);
                              }}
                              className="w-full rounded bg-red-50/70 p-2 text-left text-red-900 transition-colors hover:bg-red-100"
                            >
                              {issue.exactQuote}
                            </button>
                          </div>
                        )}
                        {issue.replacement && (
                          <div>
                            <div className="mb-1 font-medium text-[--text-secondary]">{t("replacementText")}</div>
                            <div className="rounded bg-emerald-50 p-2 text-emerald-900">#{idx} {issue.replacement}</div>
                          </div>
                        )}
                        {issue.explanation && (
                          <p className="leading-relaxed text-[--text-muted]">{issue.explanation}</p>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Asset setup review */}
        {showCharReview && (
          <div className="flex h-[calc(100vh-150px)] min-h-[660px] flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-bold text-[--text-primary]">
                  {t("reviewAssets")}
                </h3>
                <p className="mt-1 text-sm text-[--text-muted]">{t("reviewAssetsHint")}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className={`text-xs font-semibold ${allAssetsConfirmed ? "text-emerald-600" : "text-amber-600"}`}>
                  资产确认 {confirmedAssetCount}/{allWorkbenchAssets.length}
                </div>
                <div className="flex min-w-[142px] flex-col items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={generateAllMainImages}
                    disabled={
                      characters.length + items.length + environments.length === 0
                      || isAssetGenerating("all:main")
                    }
                    className="w-full rounded-xl"
                  >
                    {isAssetGenerating("all:main") ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Images className="size-4" />
                    )}
                    一键生成所有主图
                  </Button>
                  {allMainGenerationProgress ? (
                    <div className="text-[11px] font-semibold leading-none text-primary">
                      生图进度 {allMainGenerationProgress.completed}/{allMainGenerationProgress.total}
                    </div>
                  ) : (
                    <div className="h-[11px]" aria-hidden="true" />
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={confirmAllWorkbenchAssets}
                  disabled={allWorkbenchAssets.length === 0 || allAssetsConfirmed}
                  className="rounded-xl"
                >
                  <Check className="size-4" />
                  一键全部确定
                </Button>
                <Button
                  onClick={runSplit}
                  disabled={stepStatus[4] === "running" || assetLibraryLocking || !allAssetsConfirmed}
                  className="rounded-xl"
                >
                  {(stepStatus[4] === "running" || assetLibraryLocking) && <Loader2 className="size-4 animate-spin" />}
                  {assetLibraryLocking ? "锁定资产库" : t("confirmAndSplit")}
                </Button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[270px_minmax(0,1fr)] overflow-hidden rounded-xl border border-[--border-subtle] bg-white shadow-sm">
              <aside className="flex min-h-0 flex-col border-r border-[--border-subtle] bg-[--surface]">
                <div className="flex h-12 items-center justify-between border-b border-[--border-subtle] px-3">
                  <div className="text-sm font-bold text-[--text-primary]">{t("assetTypes")}</div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-[--text-muted]">
                    {characters.length + items.length + environments.length + voices.length}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 border-b border-[--border-subtle] p-2">
                  {(["characters", "items", "environments", "voices"] as AssetTab[]).map((tab) => {
                    const info = assetTabInfo(tab);
                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveAssetTab(tab)}
                        className={`group relative rounded-lg border p-2 pr-9 text-left transition-colors ${
                          activeAssetTab === tab
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-[--border-subtle] bg-white text-[--text-primary] hover:border-[--border-hover]"
                        }`}
                      >
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            addWorkbenchAsset(tab);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            event.stopPropagation();
                            addWorkbenchAsset(tab);
                          }}
                          className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border text-[--text-muted] transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary ${
                            activeAssetTab === tab ? "border-primary/30 bg-white/70 text-primary" : "border-[--border-subtle] bg-[--surface]"
                          }`}
                          aria-label={`添加${info.label}`}
                        >
                          <Plus className="size-3.5" />
                        </span>
                        <div className="text-xs font-bold">{info.label}</div>
                        <div className="mt-1 text-[10px] text-[--text-muted]">{info.count}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex h-10 items-center justify-between border-b border-[--border-subtle] px-3">
                  <div className="text-xs font-bold text-[--text-secondary]">{assetTabInfo(activeAssetTab).label}</div>
                  <span className="text-[10px] text-[--text-muted]">{assetTabInfo(activeAssetTab).count}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {activeAssetList.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[--border-subtle] bg-white p-4 text-center text-xs text-[--text-muted]">
                      {t("assetEmpty")}
                    </div>
                  ) : (
                    activeAssetList.map((asset, index) => {
                      const key = getAssetKey(asset, index, activeAssetTab);
                      const isActive = key === activeWorkbenchKey;
                      return (
                        <div
                          key={key}
                          className={`mb-1.5 grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg border p-1.5 transition-colors ${
                            isActive
                              ? "border-primary/50 bg-primary/8"
                              : "border-transparent bg-white hover:border-[--border-hover]"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setActiveAssetKey(key)}
                            className="min-w-0 rounded-md px-1 py-0.5 text-left"
                          >
                            <span className="block truncate text-xs font-bold text-[--text-primary]">{asset.name}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-[--text-muted]">
                              {(asset.role || asset.visualHint || assetTabInfo(activeAssetTab).label)} · {formatEpisodeRefs(asset.episodes)}
                            </span>
                          </button>
                          <div className="flex items-center gap-1">
                            <span className={`mr-1 h-2 w-2 rounded-full ${asset.confirmed === true ? "bg-emerald-500" : "bg-amber-400"}`} />
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              title="改名"
                              onClick={() => renameWorkbenchAsset(activeAssetTab, index)}
                            >
                              <Pencil className="size-3" />
                            </Button>
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              title="删除"
                              onClick={() => deleteWorkbenchAsset(activeAssetTab, index)}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </aside>

              <section className="min-h-0 overflow-y-auto p-4">
                {activeWorkbenchAsset ? (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold uppercase text-primary">{assetTabInfo(activeAssetTab).label}{t("assetConfigSuffix")}</div>
                        <h4 className="mt-1 truncate text-xl font-bold text-[--text-primary]">{activeWorkbenchAsset.name}</h4>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(activeWorkbenchAsset.tags || []).slice(0, 4).map((tag) => (
                            <span key={tag} className="rounded-full bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                              {tag}
                            </span>
                          ))}
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            {formatEpisodeRefs(activeWorkbenchAsset.episodes)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateActiveWorkbenchAsset({ confirmed: activeWorkbenchAsset.confirmed !== true })}
                        className={`flex h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-bold transition-colors ${
                          activeWorkbenchAsset.confirmed === true
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                        }`}
                      >
                        <Check className="size-4" />
                        {activeWorkbenchAsset.confirmed === true ? "已确认" : "确认资产"}
                      </button>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="grid min-h-[520px] gap-3 rounded-xl border border-[--border-subtle] bg-white p-3">
                        <div className="grid gap-2">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-[--text-secondary]">
                              {activeAssetTab === "voices" ? t("assetVoicePrompt") : t("assetPrompt")}
                            </label>
                            <span className="text-[10px] text-[--text-muted]">{t("assetCustomEdit")}</span>
                          </div>
                          <Textarea
                            value={activeWorkbenchAsset.prompt || ""}
                            onChange={(event) => updateActiveWorkbenchAsset({ prompt: event.target.value })}
                            className="min-h-[380px] flex-1 resize-y rounded-xl bg-white font-mono text-xs leading-relaxed"
                          />
                        </div>
                      </div>

                      <div className="grid min-h-[520px] content-start gap-3 rounded-xl border border-[--border-subtle] bg-white p-3">
                        {activeAssetTab === "voices" ? (
                          <div className="grid gap-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-xs font-bold text-[--text-secondary]">音频样本</div>
                                <div className="mt-1 text-xs text-[--text-muted]">上传角色参考音频后可直接试听。</div>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={Boolean(assetUploadingTarget)}
                                className="relative overflow-hidden rounded-lg"
                              >
                                {assetUploadingTarget === `${activeAssetTab}:${activeWorkbenchAssetIndex}:main` ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Upload className="size-3.5" />
                                )}
                                上传音频
                                <input
                                  type="file"
                                  accept="audio/*"
                                  className="absolute inset-0 cursor-pointer opacity-0"
                                  onChange={(event) => {
                                    const selectedFile = event.target.files?.[0];
                                    event.target.value = "";
                                    if (selectedFile) void uploadWorkbenchImage(selectedFile);
                                  }}
                                />
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => playVoiceSample(activeWorkbenchAsset.audioUrl)}
                                disabled={!activeWorkbenchAsset.audioUrl}
                                className="rounded-lg"
                              >
                                <Play className="size-3.5" />
                                播放
                              </Button>
                            </div>
                            <div className="rounded-xl border border-[--border-subtle] bg-[--surface] p-4">
                              {activeWorkbenchAsset.audioUrl ? (
                                <div className="grid gap-3">
                                  <audio controls src={displayImageUrl(activeWorkbenchAsset.audioUrl)} className="w-full" />
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      onClick={() => openAssetHistory(activeAssetTab, activeWorkbenchAssetIndex)}
                                      disabled={!activeWorkbenchAsset.history?.length}
                                    >
                                      <History className="size-3" />
                                      上传历史{activeWorkbenchAsset.history?.length ? ` ${activeWorkbenchAsset.history.length}` : ""}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex min-h-[260px] items-center justify-center text-sm font-bold text-[--text-primary]">
                                  未上传音频
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold text-[--text-secondary]">{t("assetMainImageName")}</div>
                              <Input
                                value={getAssetPreviewLabel(activeWorkbenchAsset, activeAssetTab)}
                                onChange={(event) => updateActiveWorkbenchAsset({ mainImageName: event.target.value, visualHint: event.target.value })}
                                className="mt-1 h-9 rounded-lg text-xs font-semibold"
                              />
                            </div>
                              <div className="flex shrink-0 flex-wrap justify-end gap-2 pt-5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={Boolean(assetUploadingTarget)}
                                  className="relative overflow-hidden rounded-lg"
                                >
                                  {assetUploadingTarget === `${activeAssetTab}:${activeWorkbenchAssetIndex}:main` ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Upload className="size-3.5" />
                                  )}
                                  上传主图
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="absolute inset-0 cursor-pointer opacity-0"
                                    onChange={(event) => {
                                      const selectedFile = event.target.files?.[0];
                                      event.target.value = "";
                                      if (selectedFile) void uploadWorkbenchImage(selectedFile);
                                    }}
                                  />
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => generateActiveWorkbenchAsset()}
                                  disabled={isAssetGenerationBlocked(activeAssetTab, activeWorkbenchAssetIndex)}
                                  className="rounded-lg"
                                >
                                  {isAssetGenerating(`${activeAssetTab}:${activeWorkbenchAssetIndex}:main`) ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <ImageIcon className="size-3.5" />
                                  )}
                                  {activeWorkbenchAsset.imageUrl ? t("assetRegenerateMain") : t("assetGenerateMain")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={generateCurrentAssetTab}
                                  disabled={hasAssetGenerationInTab(activeAssetTab)}
                                  className="rounded-lg"
                                >
                                  {isAssetGenerating(`${activeAssetTab}:category`) ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Images className="size-3.5" />
                                  )}
                                  {t("assetGenerateCurrentType")}
                                </Button>
                              </div>
                          </div>

                          <div className="relative flex aspect-[16/10] min-h-[360px] items-center justify-center overflow-hidden rounded-xl border border-[--border-subtle] bg-[--surface]">
                          {activeWorkbenchAsset.imageUrl ? (
                            <>
                              <div className="absolute right-3 top-3 z-10 flex gap-1.5">
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="secondary"
                                  className="bg-white/90 shadow-sm hover:bg-white"
                                  title="放大预览"
                                  onClick={() => openImagePreview(
                                    getAssetPreviewLabel(activeWorkbenchAsset, activeAssetTab),
                                    activeWorkbenchAsset.imageUrl,
                                  )}
                                >
                                  <Maximize2 className="size-4" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="secondary"
                                  className="bg-white/90 shadow-sm hover:bg-white"
                                  title="下载图片"
                                  onClick={() => downloadWorkbenchImage(
                                    activeWorkbenchAsset.imageUrl || "",
                                    getAssetPreviewLabel(activeWorkbenchAsset, activeAssetTab),
                                  )}
                                >
                                  <Download className="size-4" />
                                </Button>
                              </div>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={displayImageUrl(activeWorkbenchAsset.imageUrl || "")} alt={activeWorkbenchAsset.name} className="h-full w-full object-contain" />
                            </>
                          ) : (
                            <div className="grid gap-1 text-center">
                              <div className="text-sm font-bold text-[--text-primary]">
                                {t("assetNoImage")}
                              </div>
                              <div className="text-xs text-[--text-muted]">{activeWorkbenchAsset.role || assetTabInfo(activeAssetTab).label}</div>
                            </div>
                          )}
                          </div>
                          <div className="grid gap-2 rounded-lg border border-[--border-subtle] bg-[--surface] p-2">
                            <Textarea
                              value={activeWorkbenchAsset.editInstruction || ""}
                              onChange={(event) => updateMainEditInstruction(event.target.value)}
                              placeholder="输入主图改图要求，例如：服装更正式，表情更克制，保持同一角色脸型五官"
                              className="min-h-16 resize-y rounded-lg bg-white text-xs leading-relaxed"
                            />
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[10px] text-[--text-muted]">主形象三视图功能</span>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={editWorkbenchMainImage}
                                  disabled={
                                    Boolean(assetEditingTarget)
                                    || !activeWorkbenchAsset.imageUrl
                                    || !activeWorkbenchAsset.editInstruction?.trim()
                                  }
                                >
                                  {assetEditingTarget === `${activeAssetTab}:${activeWorkbenchAssetIndex}:main` ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    <Pencil className="size-3" />
                                  )}
                                  改图
                                </Button>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() => openAssetHistory(activeAssetTab, activeWorkbenchAssetIndex)}
                                  disabled={!activeWorkbenchAsset.history?.length}
                                >
                                  <History className="size-3" />
                                  生图历史
                                </Button>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() => openImagePreview(
                                    getAssetPreviewLabel(activeWorkbenchAsset, activeAssetTab),
                                    activeWorkbenchAsset.imageUrl,
                                  )}
                                  disabled={!activeWorkbenchAsset.imageUrl}
                                >
                                  <Maximize2 className="size-3" />
                                  放大预览
                                </Button>
                              </div>
                            </div>
                          </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3 border-t border-[--border-subtle] pt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-bold text-[--text-primary]">{t("assetVariants")}</div>
                          <div className="text-xs text-[--text-muted]">
                            {activeAssetTab === "voices" ? t("assetVoiceVariantsHint") : t("assetImageVariantsHint")}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {activeAssetTab !== "voices" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={addWorkbenchVariant}
                              disabled={activeWorkbenchAssetIndex < 0}
                              className="rounded-lg"
                            >
                              <Plus className="size-3.5" />
                              新增变体
                            </Button>
                          )}
                          {activeAssetTab !== "voices" && (
                            <Button
                              size="sm"
                              onClick={generateActiveWorkbenchVariantsFromMain}
                              disabled={
                                !activeWorkbenchAsset.imageUrl
                                || !activeWorkbenchAsset.variants?.length
                                || isAssetGenerationBlocked(activeAssetTab, activeWorkbenchAssetIndex)
                              }
                              className="rounded-lg"
                            >
                              {isAssetGenerating(`${activeAssetTab}:${activeWorkbenchAssetIndex}:variants`) ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Images className="size-3.5" />
                              )}
                              批量生成变体
                            </Button>
                          )}
                          <span className="rounded-full bg-[--surface] px-2 py-0.5 text-xs font-semibold text-[--text-muted]">
                            {activeWorkbenchAsset.variants?.length || 0}
                          </span>
                        </div>
                      </div>
                      {activeWorkbenchAsset.variants?.length ? (
                        <div className="grid gap-4 lg:grid-cols-2">
                          {activeWorkbenchAsset.variants.map((variant, index) => (
                            <div key={variant.id || `${variant.name}:${index}`} className="flex min-h-[180px] flex-col rounded-xl border border-[--border-subtle] bg-white p-4">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <Input
                                    value={variant.name || ""}
                                    onChange={(event) => updateWorkbenchVariant(index, { name: event.target.value })}
                                    className="h-8 rounded-lg text-xs font-bold"
                                    placeholder="变体名称"
                                  />
                                  <Textarea
                                    value={variant.description || ""}
                                    onChange={(event) => updateWorkbenchVariant(index, { description: event.target.value })}
                                    placeholder="输入这个变体的短描述/生成要求，例如：雨夜受伤、婚礼妆造、疲惫状态，保持同一人物脸型五官"
                                    className="mt-2 min-h-20 resize-y rounded-lg bg-[--surface] text-xs leading-relaxed"
                                  />
                                </div>
                                {variant.imageUrl && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">OK</span>}
                              </div>
                              {variant.imageUrl && (
                                <div className="relative mt-2 overflow-hidden rounded-lg border border-[--border-subtle] bg-[--surface]">
                                  <div className="absolute right-2 top-2 z-10 flex gap-1">
                                    <Button
                                      type="button"
                                      size="icon-xs"
                                      variant="secondary"
                                      className="bg-white/90 shadow-sm hover:bg-white"
                                      title="放大预览"
                                      onClick={() => openImagePreview(
                                        `${activeWorkbenchAsset.name}-${variant.name}`,
                                        variant.imageUrl,
                                      )}
                                    >
                                      <Maximize2 className="size-3.5" />
                                    </Button>
                                    <Button
                                      type="button"
                                      size="icon-xs"
                                      variant="secondary"
                                      className="bg-white/90 shadow-sm hover:bg-white"
                                      title="下载图片"
                                      onClick={() => downloadWorkbenchImage(
                                        variant.imageUrl || "",
                                        `${activeWorkbenchAsset.name}-${variant.name}`,
                                      )}
                                    >
                                      <Download className="size-3.5" />
                                    </Button>
                                  </div>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={displayImageUrl(variant.imageUrl || "")} alt={variant.name} className="h-56 w-full object-contain" />
                                </div>
                              )}
                              {activeAssetTab !== "voices" && (
                                <div className="mt-auto grid gap-3 pt-4">
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      disabled={Boolean(assetUploadingTarget)}
                                      className="relative overflow-hidden"
                                    >
                                      {assetUploadingTarget === `${activeAssetTab}:${activeWorkbenchAssetIndex}:${index}` ? (
                                        <Loader2 className="size-3 animate-spin" />
                                      ) : (
                                        <Upload className="size-3" />
                                      )}
                                      上传
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="absolute inset-0 cursor-pointer opacity-0"
                                        onChange={(event) => {
                                          const selectedFile = event.target.files?.[0];
                                          event.target.value = "";
                                          if (selectedFile) void uploadWorkbenchImage(selectedFile, index);
                                        }}
                                      />
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      onClick={() => generateActiveWorkbenchAsset(index)}
                                      disabled={isAssetGenerationBlocked(activeAssetTab, activeWorkbenchAssetIndex, index)}
                                    >
                                      {isAssetGenerating(`${activeAssetTab}:${activeWorkbenchAssetIndex}:${index}`) ? (
                                        <Loader2 className="size-3 animate-spin" />
                                      ) : (
                                        <ImageIcon className="size-3" />
                                      )}
                                      {variant.imageUrl ? t("assetRegenerateVariant") : t("assetGenerateVariant")}
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      onClick={() => openVariantHistory(activeAssetTab, activeWorkbenchAssetIndex, index)}
                                      disabled={!variant.history?.length}
                                    >
                                      <History className="size-3" />
                                      生图历史{variant.history?.length ? ` ${variant.history.length}` : ""}
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      onClick={() => openImagePreview(
                                        `${activeWorkbenchAsset.name}-${variant.name}`,
                                        variant.imageUrl,
                                      )}
                                      disabled={!variant.imageUrl}
                                    >
                                      <Maximize2 className="size-3" />
                                      放大预览
                                    </Button>
                                  </div>

                                  <div className="grid gap-2 rounded-lg border border-[--border-subtle] bg-[--surface] p-2">
                                    <Textarea
                                      value={variant.editInstruction || ""}
                                      onChange={(event) => updateVariantEditInstruction(index, event.target.value)}
                                      placeholder="输入变体改图要求，例如：换成深色外套，表情更疲惫，保持同一人物"
                                      className="min-h-20 resize-y rounded-lg bg-white text-xs leading-relaxed"
                                    />
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[10px] text-[--text-muted]">基于当前变体图进行修改</span>
                                      <Button
                                        size="xs"
                                        onClick={() => editWorkbenchVariant(index)}
                                        disabled={Boolean(assetEditingTarget) || !variant.imageUrl || !variant.editInstruction?.trim()}
                                      >
                                        {assetEditingTarget === `${activeAssetTab}:${activeWorkbenchAssetIndex}:${index}` ? (
                                          <Loader2 className="size-3 animate-spin" />
                                        ) : (
                                          <Sparkles className="size-3" />
                                        )}
                                        变体改图
                                      </Button>
                                    </div>
                                  </div>

                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-[--border-subtle] bg-[--surface] p-4 text-center text-xs text-[--text-muted]">
                          {t("assetNoVariants")}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-[--border-subtle] text-sm text-[--text-muted]">
                    {t("assetEmpty")}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        <Dialog open={Boolean(imagePreview)} onOpenChange={(open) => !open && setImagePreview(null)}>
          <DialogContent className="max-h-[92vh] gap-3 overflow-hidden sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>{imagePreview?.title || "放大预览"}</DialogTitle>
            </DialogHeader>
            {imagePreview?.imageUrl && (
              <div className="flex max-h-[76vh] items-center justify-center overflow-auto rounded-xl border border-[--border-subtle] bg-[--surface] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={displayImageUrl(imagePreview.imageUrl)}
                  alt={imagePreview.title}
                  className="max-h-[72vh] w-auto max-w-full object-contain"
                />
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(historyDialog)} onOpenChange={(open) => !open && setHistoryDialog(null)}>
          <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{historyDialog?.title || "生图历史"}</DialogTitle>
              <DialogDescription>
                {historyDialog?.tab === "voices" ? "点击历史记录可恢复对应音频。" : "点击历史记录可恢复对应图片。"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid max-h-[64vh] gap-2 overflow-y-auto pr-1">
              {(historyDialog?.entries || []).map((entry, index) => {
                const historyImageUrl = typeof entry.imageUrl === "string" ? entry.imageUrl : "";
                const historyAudioUrl = typeof entry.audioUrl === "string" ? entry.audioUrl : "";
                const isVoiceHistory = historyDialog?.tab === "voices";
                const canRestore = isVoiceHistory ? Boolean(historyAudioUrl) : Boolean(historyImageUrl);
                return (
                  <button
                    key={`${entry.at || index}:${index}`}
                    type="button"
                    onClick={() => {
                      if (!historyDialog || !canRestore) return;
                      if (isVoiceHistory) {
                        restoreHistoryAudio(historyDialog.tab, historyDialog.assetIndex, historyAudioUrl);
                      } else {
                        restoreHistoryImage(
                          historyDialog.tab,
                          historyDialog.assetIndex,
                          historyImageUrl,
                          historyDialog.variantIndex,
                        );
                      }
                      setHistoryDialog(null);
                    }}
                    disabled={!canRestore}
                    className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-lg border border-[--border-subtle] bg-white p-2 text-left transition-colors hover:border-[--border-hover] hover:bg-[--surface] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="flex h-16 items-center justify-center overflow-hidden rounded-md bg-[--surface]">
                      {isVoiceHistory && historyAudioUrl ? (
                        <Play className="size-5 text-primary" />
                      ) : historyImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={displayImageUrl(historyImageUrl)} alt="" className="h-full w-full object-contain" />
                      ) : (
                        <ImageIcon className="size-5 text-[--text-muted]" />
                      )}
                    </div>
                    <div className="min-w-0 self-center">
                      <div className="truncate text-xs font-bold text-[--text-primary]">{getHistoryLabel(entry)}</div>
                      <div className="mt-1 truncate text-[11px] text-[--text-muted]">{formatHistoryTime(entry.at)}</div>
                      {typeof entry.error === "string" && (
                        <div className="mt-1 line-clamp-2 text-[11px] text-red-500">{entry.error}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>

        {/* Episodes review (after step 3) */}
        {showEpReview && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-[--text-primary]">
                  {t("reviewEpisodes")} ({episodes.length})
                </h3>
                <p className="mt-1 text-sm text-[--text-muted]">{t("reviewEpisodesHint")}</p>
                <div className="mt-2 text-xs font-semibold text-[--text-secondary]">
                  {episodeConfirmProgress}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={confirmAllEpisodes}
                  disabled={episodes.length === 0 || allEpisodesConfirmed}
                  className="rounded-xl"
                >
                  <Check className="size-4" />
                  {t("confirmAllEpisodes")}
                </Button>
                <Button
                  onClick={runGenerate}
                  disabled={!allEpisodesConfirmed || stepStatus[5] === "running"}
                  className="rounded-xl"
                >
                  {stepStatus[5] === "running" && <Loader2 className="size-4 animate-spin" />}
                  {t("confirmAndGenerate")}
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              {episodes.map((ep, idx) => {
                const isExpanded = expandedEpisodeIndexes.has(idx);
                const isConfirmed = confirmedEpisodeIndexes.has(idx);
                const keywords = ep.keywords.split(/[,，]/).map((kw) => kw.trim()).filter(Boolean);

                return (
                  <div
                    key={`${ep.title}:${idx}`}
                    className={`overflow-hidden rounded-xl border bg-white transition-colors ${
                      isConfirmed ? "border-emerald-200" : "border-[--border-subtle]"
                    }`}
                  >
                    <div className="flex items-center gap-3 p-4">
                      <button
                        type="button"
                        onClick={() => toggleEpisodeExpanded(idx)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[--border-subtle] text-[--text-muted] transition-colors hover:border-[--border-hover] hover:text-[--text-primary]"
                        aria-label={isExpanded ? t("collapseEpisode") : t("expandEpisode")}
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                      <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                        EP.{String(idx + 1).padStart(2, "0")}
                      </span>
                      <Input
                        value={ep.title}
                        onChange={(e) => updateEpisode(idx, "title", e.target.value)}
                        className="h-8 min-w-0 text-sm font-semibold"
                      />
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isConfirmed ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                      }`}>
                        {isConfirmed ? t("episodeConfirmed") : t("episodePendingConfirm")}
                      </span>
                      <Button
                        variant={isConfirmed ? "outline" : "default"}
                        size="sm"
                        onClick={() => confirmEpisode(idx)}
                        className="shrink-0 rounded-lg"
                      >
                        <Check className="size-3.5" />
                        {isConfirmed ? t("cancelEpisodeConfirm") : t("confirmEpisode")}
                      </Button>
                      <button
                        onClick={() => setEpisodeDeleteIndex(idx)}
                        className="shrink-0 rounded-lg p-1.5 text-[--text-muted] transition-colors hover:bg-red-50 hover:text-red-500"
                        aria-label={t("removeEpisode")}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="max-h-[340px] overflow-y-auto border-t border-[--border-subtle] bg-[--surface] p-4">
                        <div className="grid gap-4 pr-1">
                        <div className="grid gap-2 md:grid-cols-2">
                          <label className="grid gap-1">
                            <span className="text-xs font-bold text-[--text-secondary]">{t("episodeDescription")}</span>
                            <Textarea
                              value={ep.description}
                              onChange={(e) => updateEpisode(idx, "description", e.target.value)}
                              className="h-24 resize-none overflow-y-auto rounded-lg bg-white text-xs leading-relaxed"
                            />
                          </label>
                          <label className="grid gap-1">
                            <span className="text-xs font-bold text-[--text-secondary]">{t("episodeKeywords")}</span>
                            <Textarea
                              value={ep.keywords}
                              onChange={(e) => updateEpisode(idx, "keywords", e.target.value)}
                              className="h-24 resize-none overflow-y-auto rounded-lg bg-white text-xs leading-relaxed"
                            />
                          </label>
                        </div>
                        <label className="grid gap-1">
                          <span className="text-xs font-bold text-[--text-secondary]">{t("episodeIdea")}</span>
                          <Textarea
                            value={ep.idea}
                            onChange={(e) => updateEpisode(idx, "idea", e.target.value)}
                            className="h-36 resize-none overflow-y-auto rounded-lg bg-white font-mono text-xs leading-relaxed"
                          />
                        </label>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <div className="mb-2 text-xs font-bold text-[--text-secondary]">{t("episodeCharacters")}</div>
                            {ep.characters && ep.characters.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {ep.characters.map((name, charIdx) => {
                                  const isMain = characters.some((c) => c.name === name && c.scope === "main");
                                  return (
                                    <span key={`${name}:${charIdx}`} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isMain ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                                      {name}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="rounded-lg border border-dashed border-[--border-subtle] bg-white p-3 text-xs text-[--text-muted]">
                                {t("episodeNoCharacters")}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="mb-2 text-xs font-bold text-[--text-secondary]">{t("episodeKeywordsPreview")}</div>
                            {keywords.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {keywords.map((kw, kwIdx) => (
                                  <span key={`${kw}:${kwIdx}`} className="rounded bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-lg border border-dashed border-[--border-subtle] bg-white p-3 text-xs text-[--text-muted]">
                                {t("episodeNoKeywords")}
                              </div>
                            )}
                          </div>
                        </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Dialog open={episodeDeleteIndex !== null} onOpenChange={(open) => !open && setEpisodeDeleteIndex(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("removeEpisodeConfirmTitle")}</DialogTitle>
                  <DialogDescription>
                    {t("removeEpisodeConfirmDesc", {
                      episode: episodePendingDelete
                        ? `EP.${String((episodeDeleteIndex ?? 0) + 1).padStart(2, "0")} - ${episodePendingDelete.title}`
                        : "",
                    })}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>
                    {t("cancelRemoveEpisode")}
                  </DialogClose>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (episodeDeleteIndex !== null) removeEpisode(episodeDeleteIndex);
                    }}
                  >
                    {t("confirmRemoveEpisode")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* Logs panel */}
        {(currentStep > 0 || historyMode) && !showStoryReview && !showCharReview && !showEpReview && (() => {
          const filteredLogs = selectedStep
            ? logs.filter((l) => l.step === selectedStep)
            : logs;

          // Extract metadata from the "done" log of the selected step
          const stepDoneLog = selectedStep
            ? logs.find((l) => l.step === selectedStep && l.status === "done" && l.metadata)
            : null;
          const meta = stepDoneLog?.metadata as Record<string, unknown> | null;
          const metaCharacters = meta?.characters as ExtractedCharacter[] | undefined;
          const metaItems = meta?.items as ExtractedAsset[] | undefined;
          const metaEnvironments = meta?.environments as ExtractedAsset[] | undefined;
          const metaVoices = meta?.voices as ExtractedAsset[] | undefined;
          const metaEpisodes = meta?.episodes as SplitEpisode[] | undefined;

          // For step 4, also show characters from step 3
          const step3DoneLog = (selectedStep === 4)
            ? logs.find((l) => l.step === 3 && l.status === "done" && l.metadata)
            : null;
          const step3Meta = step3DoneLog?.metadata as Record<string, unknown> | null;
          const step3Characters = step3Meta?.characters as ExtractedCharacter[] | undefined;

          return (
            <div className="space-y-4">
              {selectedStep === 3 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 rounded-xl border border-[--border-subtle] bg-white p-1.5">
                    {([
                      { key: "characters" as const, label: t("assetCharacters"), count: metaCharacters?.length || characters.length },
                      { key: "items" as const, label: t("assetItems"), count: metaItems?.length || items.length },
                      { key: "environments" as const, label: t("assetEnvironments"), count: metaEnvironments?.length || environments.length },
                      { key: "voices" as const, label: t("assetVoices"), count: metaVoices?.length || voices.length },
                    ]).map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setActiveAssetTab(tab.key)}
                        className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                          activeAssetTab === tab.key
                            ? "bg-primary text-white"
                            : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-primary]"
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          activeAssetTab === tab.key
                            ? "bg-white/20 text-white"
                            : "bg-[--surface] text-[--text-muted]"
                        }`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {activeAssetTab === "characters" && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                      {(metaCharacters || characters).map((char, idx) => (
                        <div
                          key={`${char.name}:${idx}`}
                          className="group relative overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                        >
                          <div className={`h-1 w-full ${char.scope === "main" ? "bg-gradient-to-r from-blue-500 to-blue-400" : "bg-gradient-to-r from-purple-500 to-purple-400"}`} />
                          <div className="p-3.5">
                            <div className="mb-2.5 flex items-center gap-2.5">
                              <div
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold text-white"
                                style={{ background: `linear-gradient(135deg, hsl(${(char.name.charCodeAt(0) * 37) % 360}, 45%, 45%), hsl(${(char.name.charCodeAt(0) * 37) % 360}, 50%, 55%))` }}
                              >
                                {char.name.charAt(0)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-bold text-[--text-primary]">{char.name}</div>
                                <div className="flex items-center gap-1.5 text-[10px] text-[--text-muted]">
                                  <span>{t("frequency")} {char.frequency}</span>
                                  {char.visualHint && (
                                    <>
                                      <span className="h-[3px] w-[3px] rounded-full bg-[#ddd]" />
                                      <span className="truncate">{char.visualHint}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            {char.visualHint && (
                              <div className="mb-2 inline-block rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                                {char.visualHint}
                              </div>
                            )}
                            <p className="line-clamp-2 text-[11px] leading-relaxed text-[--text-muted]">{char.description}</p>
                          </div>
                          <span className={`absolute right-3 top-3 rounded-[8px] px-2 py-0.5 text-[9px] font-bold tracking-wide ${
                            char.scope === "main" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                          }`}>
                            {char.scope === "main" ? t("main") : t("guest")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(activeAssetTab === "items" || activeAssetTab === "environments" || activeAssetTab === "voices") && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                      {(activeAssetTab === "items" ? (metaItems || items) : activeAssetTab === "environments" ? (metaEnvironments || environments) : (metaVoices || voices)).map((asset, idx) => (
                        <div
                          key={`${asset.name}:${idx}`}
                          className="rounded-[14px] border border-[--border-subtle] bg-white p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-bold text-[--text-primary]">{asset.name}</div>
                              <div className="text-[10px] text-[--text-muted]">{t("frequency")} {asset.frequency}</div>
                            </div>
                            {asset.visualHint && (
                              <span className="shrink-0 rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                                {asset.visualHint}
                              </span>
                            )}
                          </div>
                          <p className="line-clamp-4 text-[11px] leading-relaxed text-[--text-muted]">{asset.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-[--text-secondary]">
                  {t("processLog")}
                  {selectedStep && (
                    <span className="ml-2 text-xs font-normal text-[--text-muted]">
                      — {t(STEPS[selectedStep - 1].label)}
                    </span>
                  )}
                </h3>
                {selectedStep && (
                  <button
                    onClick={() => setSelectedStep(null)}
                    className="text-xs text-primary hover:underline"
                  >
                    {t("showAll")}
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-[--border-subtle] bg-white p-4">
                <div className="max-h-[30vh] space-y-1.5 overflow-y-auto font-mono text-xs">
                  {filteredLogs.map((log, idx) => (
                    <div key={`${log.id}:${idx}`} className="flex items-start gap-2">
                      <span
                        className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          log.status === "done"
                            ? "bg-emerald-500"
                            : log.status === "error"
                              ? "bg-red-500"
                              : "bg-amber-400"
                        }`}
                      />
                      {!selectedStep && (
                        <span className="shrink-0 text-[--text-muted]">[Step {log.step}]</span>
                      )}
                      <span className={log.status === "error" ? "text-red-500" : "text-[--text-primary]"}>
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>

              {/* Retry button when a step has failed */}
              {([1, 2, 3, 4, 5] as Step[]).some((s) => stepStatus[s] === "error") && !historyMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={retryStep}
                  className="self-start"
                >
                  <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
                  {t("retry")}
                </Button>
              )}

              {/* Step 3 metadata: asset setup */}
              {false && selectedStep === 3 && (metaCharacters || metaItems || metaEnvironments || metaVoices) && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 rounded-xl border border-[--border-subtle] bg-white p-1.5">
                    {([
                      { key: "characters" as const, label: t("assetCharacters"), count: metaCharacters?.length || 0 },
                      { key: "items" as const, label: t("assetItems"), count: metaItems?.length || 0 },
                      { key: "environments" as const, label: t("assetEnvironments"), count: metaEnvironments?.length || 0 },
                      { key: "voices" as const, label: t("assetVoices"), count: metaVoices?.length || 0 },
                    ]).map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setActiveAssetTab(tab.key)}
                        className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                          activeAssetTab === tab.key
                            ? "bg-primary text-white"
                            : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-primary]"
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          activeAssetTab === tab.key
                            ? "bg-white/20 text-white"
                            : "bg-[--surface] text-[--text-muted]"
                        }`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {activeAssetTab === "characters" && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                      {(metaCharacters || []).map((char, idx) => (
                        <div
                          key={`${char.name}:${idx}`}
                          className="group relative overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                        >
                          <div className={`h-1 w-full ${char.scope === "main" ? "bg-gradient-to-r from-blue-500 to-blue-400" : "bg-gradient-to-r from-purple-500 to-purple-400"}`} />
                          <div className="p-3.5">
                            <div className="mb-2.5 flex items-center gap-2.5">
                              <div
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold text-white"
                                style={{ background: `linear-gradient(135deg, hsl(${(char.name.charCodeAt(0) * 37) % 360}, 45%, 45%), hsl(${(char.name.charCodeAt(0) * 37) % 360}, 50%, 55%))` }}
                              >
                                {char.name.charAt(0)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-bold text-[--text-primary]">{char.name}</div>
                                <div className="flex items-center gap-1.5 text-[10px] text-[--text-muted]">
                                  <span>{t("frequency")} {char.frequency}</span>
                                  {char.visualHint && (
                                    <>
                                      <span className="h-[3px] w-[3px] rounded-full bg-[#ddd]" />
                                      <span className="truncate">{char.visualHint}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            {char.visualHint && (
                              <div className="mb-2 inline-block rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                                {char.visualHint}
                              </div>
                            )}
                            <p className="line-clamp-2 text-[11px] leading-relaxed text-[--text-muted]">{char.description}</p>
                          </div>
                          <span className={`absolute right-3 top-3 rounded-[8px] px-2 py-0.5 text-[9px] font-bold tracking-wide ${
                            char.scope === "main" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                          }`}>
                            {char.scope === "main" ? t("main") : t("guest")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(activeAssetTab === "items" || activeAssetTab === "environments" || activeAssetTab === "voices") && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                      {(activeAssetTab === "items" ? (metaItems || []) : activeAssetTab === "environments" ? (metaEnvironments || []) : (metaVoices || [])).map((asset, idx) => (
                        <div
                          key={`${asset.name}:${idx}`}
                          className="rounded-[14px] border border-[--border-subtle] bg-white p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-bold text-[--text-primary]">{asset.name}</div>
                              <div className="text-[10px] text-[--text-muted]">{t("frequency")} {asset.frequency}</div>
                            </div>
                            {asset.visualHint && (
                              <span className="shrink-0 rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                                {asset.visualHint}
                              </span>
                            )}
                          </div>
                          <p className="line-clamp-4 text-[11px] leading-relaxed text-[--text-muted]">{asset.description}</p>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              )}
              {/* Step 4 metadata: episodes */}
              {selectedStep === 4 && metaEpisodes && metaEpisodes.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-[--text-secondary]">
                    {t("reviewEpisodes")} ({metaEpisodes.length})
                  </h4>
                  <div className="space-y-2">
                    {metaEpisodes.map((ep, idx) => (
                      <div key={`${ep.title}:${idx}`} className="rounded-xl border border-[--border-subtle] bg-white p-3">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                            EP.{String(idx + 1).padStart(2, "0")}
                          </span>
                          <span className="text-sm font-semibold text-[--text-primary]">{ep.title}</span>
                        </div>
                        <p className="text-xs text-[--text-muted]">{ep.description}</p>
                        {ep.characters && ep.characters.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {ep.characters.map((name, charIdx) => {
                              const isMain = step3Characters?.some((c) => c.name === name && c.scope === "main");
                              return (
                                <span key={`${name}:${charIdx}`} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isMain ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                                  {name}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {historyMode && (
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setHistoryMode(false);
                      setSelectedStep(null);
                      setCurrentStep(0);
                      storyReviewedRef.current = false;
                      enrichedTextRef.current = "";
                      visualEnrichmentRef.current = null;
                      setDetailSupplementReady(false);
                      setCurrentEnrichmentJob(null);
                      setStepStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle", 5: "idle" });
                    }}
                  >
                    {t("newImport")}
                  </Button>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
