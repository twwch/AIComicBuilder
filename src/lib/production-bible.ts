import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { db, ensureProductionBibleTable, ensureStoryPipelineTables } from "@/lib/db";
import {
  assets,
  characters,
  complianceReports,
  episodes,
  importStates,
  productionBibles,
  projects,
} from "@/lib/db/schema";
import { id as genId } from "@/lib/id";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { resolveAIProvider } from "@/lib/ai/provider-factory";

export type ProductionBibleDraft = {
  title: string;
  worldSetting: string;
  visualStyle: string;
  eraConstraints: string;
  locationRules: string;
  characterRules: string;
  sceneRules: string;
  propRules: string;
  positivePromptTemplate: string;
  negativePromptTemplate: string;
  complianceRules: string;
  metadata?: Record<string, unknown>;
};

type StoryAnalysis = {
  storyMeta?: Record<string, unknown>;
  assets?: {
    characters?: Array<Record<string, unknown>>;
    scenes?: Array<Record<string, unknown>>;
    props?: Array<Record<string, unknown>>;
  };
};

function stringifyList(items: string[], fallback = "") {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  return clean.length ? clean.map((item) => `- ${item}`).join("\n") : fallback;
}

function compact(value: unknown, maxLength = 260) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function parseJsonMaybe<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const object = text.match(/\{[\s\S]*\}/);
  return object?.[0] ?? text;
}

function normalizeDraft(value: Partial<ProductionBibleDraft>): ProductionBibleDraft {
  return {
    title: String(value.title || "Production Bible").trim(),
    worldSetting: String(value.worldSetting || "").trim(),
    visualStyle: String(value.visualStyle || "").trim(),
    eraConstraints: String(value.eraConstraints || "").trim(),
    locationRules: String(value.locationRules || "").trim(),
    characterRules: String(value.characterRules || "").trim(),
    sceneRules: String(value.sceneRules || "").trim(),
    propRules: String(value.propRules || "").trim(),
    positivePromptTemplate: String(value.positivePromptTemplate || "").trim(),
    negativePromptTemplate: String(value.negativePromptTemplate || "").trim(),
    complianceRules: String(value.complianceRules || "").trim(),
    metadata: value.metadata && typeof value.metadata === "object" ? value.metadata : {},
  };
}

async function getSourceContext(projectId: string, episodeId?: string | null) {
  ensureProductionBibleTable();
  ensureStoryPipelineTables();

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");

  const episodeRows = episodeId
    ? await db.select().from(episodes).where(eq(episodes.id, episodeId))
    : [];
  const episode = episodeRows[0] ?? null;

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(
      episodeId
        ? and(eq(characters.projectId, projectId), or(isNull(characters.episodeId), eq(characters.episodeId, episodeId)))
        : eq(characters.projectId, projectId),
    )
    .orderBy(asc(characters.scope), asc(characters.name));

  const storyAssets = await db
    .select()
    .from(assets)
    .where(eq(assets.projectId, projectId))
    .orderBy(assets.type, desc(assets.importance), asc(assets.name));

  const risks = await db
    .select()
    .from(complianceReports)
    .where(eq(complianceReports.projectId, projectId))
    .orderBy(desc(complianceReports.riskLevel), asc(complianceReports.riskType))
    .limit(30);

  const [draftState] = await db
    .select()
    .from(importStates)
    .where(eq(importStates.projectId, projectId));

  return {
    project,
    episode,
    characters: projectCharacters,
    assets: storyAssets,
    risks,
    importState: draftState ?? null,
    storyAnalysis: parseJsonMaybe<StoryAnalysis>(draftState?.storyAnalysis, {}),
  };
}

function buildFallbackDraft(context: Awaited<ReturnType<typeof getSourceContext>>): ProductionBibleDraft {
  const { project, episode, characters: characterRows, assets: assetRows, risks, storyAnalysis } = context;
  const storyMeta = storyAnalysis.storyMeta || {};
  const scriptText = episode?.script || project.script || context.importState?.fullText || "";
  const sceneAssets = assetRows.filter((asset) => asset.type === "scene");
  const propAssets = assetRows.filter((asset) => asset.type === "prop");

  const worldFacts = [
    project.worldSetting,
    compact(storyMeta.time),
    compact(storyMeta.background),
    compact(storyMeta.locationBackground),
    compact(episode?.description),
    scriptText ? `剧本长度约 ${scriptText.length} 字。` : "",
  ].filter(Boolean) as string[];

  const visualFacts = [
    project.colorPalette ? `全局色彩方案：${project.colorPalette}` : "",
    compact(storyMeta.visualStyleBase),
    compact(storyMeta.genre),
    "保持现实主义短剧画面逻辑，角色、场景和道具必须优先服从已确认资产。",
  ].filter(Boolean);

  const characterRules = characterRows.map((char) => {
    const details = [
      char.description,
      char.visualHint && `视觉标识：${char.visualHint}`,
      char.performanceStyle && `表演风格：${char.performanceStyle}`,
      char.heightCm ? `身高：${char.heightCm}cm` : "",
      char.bodyType && char.bodyType !== "average" ? `体型：${char.bodyType}` : "",
    ].filter(Boolean).join("；");
    return `${char.name}：${details || "保持姓名、外貌、服装、表演状态稳定。"}。`;
  });

  const sceneRules = sceneAssets.map((asset) =>
    `${asset.name}：${compact(asset.description || asset.visualConstraints || "保持空间结构、光线和陈设稳定。")}`,
  );

  const propRules = propAssets.map((asset) =>
    `${asset.name}：${compact(asset.description || asset.visualConstraints || "保持外观、位置和使用状态稳定。")}`,
  );

  const compliance = risks.map((risk) =>
    `${risk.riskLevel}/${risk.riskType}：${compact(risk.sourceText, 80)}；${compact(risk.suggestion || risk.reason, 140)}`,
  );

  return normalizeDraft({
    title: episode ? `${project.title} - ${episode.title} 生产设定库` : `${project.title} 生产设定库`,
    worldSetting: stringifyList(worldFacts, "- 暂无明确世界观，请在后续解析中补充时代、地域、题材和主线。"),
    visualStyle: stringifyList(visualFacts),
    eraConstraints: stringifyList([
      "所有画面元素必须符合故事时代、地域和社会背景。",
      "禁止出现与时代不符的手机、屏幕、车辆、服装、标识和室内装修。",
      "遇到不确定年代信息时，使用朴素、低风险、非品牌化的现实主义元素。",
    ]),
    locationRules: stringifyList([
      "建筑、街道、室内陈设和生活方式要与地域背景一致。",
      "同一高频场景复用空间结构、主光方向、色调和关键陈设。",
      ...sceneRules.slice(0, 12),
    ]),
    characterRules: stringifyList([
      "主角和核心配角必须保持脸型、发型、体型、服装基调和表演气质一致。",
      "角色关系必须影响站位、视线、距离和肢体互动。",
      ...characterRules.slice(0, 20),
    ]),
    sceneRules: stringifyList(sceneRules, "- 场景资产尚未入库；故事板生成时应从剧本场次和 Production Bible 推导稳定空间。"),
    propRules: stringifyList(propRules, "- 道具资产尚未入库；关键道具必须在镜头卡中标记并保持外观/持有状态。"),
    positivePromptTemplate: [
      "现实主义短剧画面，电影感构图，自然光，清晰主体，稳定人物脸型和服装，符合 Production Bible 的时代/地域/风格约束。",
      "镜头必须体现人物关系、情绪重点、动作状态、景别、机位和剧情意图。",
    ].join("\n"),
    negativePromptTemplate: [
      "不要动漫风、游戏CG风、过度磨皮、网红滤镜、品牌/IP/真实公众人物暗示。",
      "不要字幕、水印、logo、UI、错误文字、时代穿帮物、变形手脸、额外肢体、漂浮人物。",
    ].join("\n"),
    complianceRules: stringifyList([
      "所有镜头和故事板生成前必须避开合规风险，必要时改写为弱化表达。",
      ...compliance.slice(0, 20),
    ], "- 暂无合规报告；保持低风险现实主义表达，避免暴力血腥、情色擦边、真实品牌/IP 和敏感公共议题。"),
    metadata: {
      source: "fallback",
      characterCount: characterRows.length,
      assetCount: assetRows.length,
      riskCount: risks.length,
    },
  });
}

function buildBibleGenerationPrompt(context: Awaited<ReturnType<typeof getSourceContext>>) {
  const fallback = buildFallbackDraft(context);
  const source = {
    project: {
      title: context.project.title,
      idea: context.project.idea,
      outline: context.project.outline,
      worldSetting: context.project.worldSetting,
      colorPalette: context.project.colorPalette,
    },
    episode: context.episode
      ? {
          title: context.episode.title,
          description: context.episode.description,
          keywords: context.episode.keywords,
          outline: context.episode.outline,
          colorPalette: context.episode.colorPalette,
        }
      : null,
    storyMeta: context.storyAnalysis.storyMeta || {},
    characters: context.characters.slice(0, 60).map((char) => ({
      name: char.name,
      description: char.description,
      visualHint: char.visualHint,
      performanceStyle: char.performanceStyle,
      scope: char.scope,
    })),
    assets: context.assets.slice(0, 100).map((asset) => ({
      type: asset.type,
      name: asset.name,
      importance: asset.importance,
      description: asset.description,
      visualConstraints: asset.visualConstraints,
      negativeConstraints: asset.negativeConstraints,
      confirmed: Boolean(asset.confirmed),
    })),
    complianceRisks: context.risks.map((risk) => ({
      riskLevel: risk.riskLevel,
      riskType: risk.riskType,
      sourceText: risk.sourceText,
      reason: risk.reason,
      suggestion: risk.suggestion,
    })),
    fallbackDraft: fallback,
  };

  return `你是工业化 AI 短剧生产流程里的 Production Bible 负责人。请根据输入资料生成一份可被镜头卡、故事板、生图提示词直接消费的生产设定库。

要求：
- 不要写泛泛的创作建议，要写可执行的约束。
- 优先固定人物、场景、道具、时代、地域、风格和合规边界。
- 不要包含真实导演/演员/品牌/IP名。
- 输出必须是严格 JSON，不要 markdown。
- 所有字段使用中文。

输出 JSON 字段：
{
  "title": "生产设定库标题",
  "worldSetting": "世界观、时代、地域、题材、主线、情绪基调",
  "visualStyle": "画面风格、色彩、摄影、质感、禁用风格",
  "eraConstraints": "年代规则：允许元素、禁止元素、穿帮风险",
  "locationRules": "地域/建筑/生活方式/场景空间规则",
  "characterRules": "人物形象、性格、关系、服装、表演稳定规则",
  "sceneRules": "高频场景稳定规则",
  "propRules": "关键道具稳定规则",
  "positivePromptTemplate": "给故事板/生图使用的正向提示词模板",
  "negativePromptTemplate": "给故事板/生图使用的负向提示词模板",
  "complianceRules": "内容合规和视觉合规规则"
}

输入资料：
${JSON.stringify(source, null, 2)}`;
}

export async function getActiveProductionBible(projectId: string, episodeId?: string | null) {
  ensureProductionBibleTable();
  const rows = await db
    .select()
    .from(productionBibles)
    .where(
      episodeId
        ? and(eq(productionBibles.projectId, projectId), eq(productionBibles.isActive, 1), eq(productionBibles.episodeId, episodeId))
        : and(eq(productionBibles.projectId, projectId), eq(productionBibles.isActive, 1), isNull(productionBibles.episodeId)),
    )
    .orderBy(desc(productionBibles.version))
    .limit(1);

  if (rows[0]) return rows[0];

  return db
    .select()
    .from(productionBibles)
    .where(and(eq(productionBibles.projectId, projectId), eq(productionBibles.isActive, 1)))
    .orderBy(desc(productionBibles.version))
    .limit(1)
    .then((fallbackRows) => fallbackRows[0] ?? null);
}

export async function listProductionBibles(projectId: string, episodeId?: string | null) {
  ensureProductionBibleTable();
  return db
    .select()
    .from(productionBibles)
    .where(
      episodeId
        ? and(eq(productionBibles.projectId, projectId), or(eq(productionBibles.episodeId, episodeId), isNull(productionBibles.episodeId)))
        : eq(productionBibles.projectId, projectId),
    )
    .orderBy(desc(productionBibles.isActive), desc(productionBibles.version), desc(productionBibles.createdAt));
}

export async function createAndActivateProductionBible(input: {
  projectId: string;
  episodeId?: string | null;
  sourceScriptId?: string | null;
  draft: ProductionBibleDraft;
  status?: "draft" | "active";
}) {
  ensureProductionBibleTable();
  const existing = await db
    .select({ version: productionBibles.version })
    .from(productionBibles)
    .where(
      input.episodeId
        ? and(eq(productionBibles.projectId, input.projectId), eq(productionBibles.episodeId, input.episodeId))
        : and(eq(productionBibles.projectId, input.projectId), isNull(productionBibles.episodeId)),
    )
    .orderBy(desc(productionBibles.version))
    .limit(1);

  const now = new Date();
  const version = (existing[0]?.version ?? 0) + 1;
  await db
    .update(productionBibles)
    .set({ isActive: 0, status: "archived", updatedAt: now })
    .where(
      input.episodeId
        ? and(eq(productionBibles.projectId, input.projectId), eq(productionBibles.episodeId, input.episodeId))
        : and(eq(productionBibles.projectId, input.projectId), isNull(productionBibles.episodeId)),
    );

  const bibleId = genId();
  const draft = normalizeDraft(input.draft);
  await db.insert(productionBibles).values({
    id: bibleId,
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
    sourceScriptId: input.sourceScriptId ?? null,
    version,
    title: draft.title,
    worldSetting: draft.worldSetting,
    visualStyle: draft.visualStyle,
    eraConstraints: draft.eraConstraints,
    locationRules: draft.locationRules,
    characterRules: draft.characterRules,
    sceneRules: draft.sceneRules,
    propRules: draft.propRules,
    positivePromptTemplate: draft.positivePromptTemplate,
    negativePromptTemplate: draft.negativePromptTemplate,
    complianceRules: draft.complianceRules,
    status: input.status ?? "active",
    isActive: 1,
    metadata: {
      ...draft.metadata,
      generatedAt: now.toISOString(),
    },
    createdAt: now,
    updatedAt: now,
  });

  const [created] = await db.select().from(productionBibles).where(eq(productionBibles.id, bibleId));
  return created;
}

export async function generateProductionBible(input: {
  projectId: string;
  episodeId?: string | null;
  modelConfig?: ModelConfigPayload;
}) {
  const context = await getSourceContext(input.projectId, input.episodeId);

  let draft = buildFallbackDraft(context);
  let source: "fallback" | "ai" = "fallback";

  if (input.modelConfig?.text) {
    try {
      const provider = resolveAIProvider(input.modelConfig);
      const result = await provider.generateText(buildBibleGenerationPrompt(context), {
        systemPrompt: "你是工业化短剧 Production Bible 生成专家。只输出严格 JSON。",
        temperature: 0.2,
      });
      const parsed = JSON.parse(extractJson(result)) as Partial<ProductionBibleDraft>;
      draft = normalizeDraft({
        ...draft,
        ...parsed,
        metadata: {
          ...draft.metadata,
          source: "ai",
        },
      });
      source = "ai";
    } catch (error) {
      draft = normalizeDraft({
        ...draft,
        metadata: {
          ...draft.metadata,
          source: "fallback",
          aiError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  const created = await createAndActivateProductionBible({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
    draft: normalizeDraft({
      ...draft,
      metadata: {
        ...draft.metadata,
        source,
      },
    }),
    status: "active",
  });

  await db
    .update(projects)
    .set({
      worldSetting: created.worldSetting,
      colorPalette: created.visualStyle || created.worldSetting,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, input.projectId));

  return created;
}

export function formatProductionBibleContext(
  bible: typeof productionBibles.$inferSelect | null | undefined,
) {
  if (!bible) return "";
  return [
    "## Production Bible / 生产设定库（最高优先级）",
    bible.worldSetting && `### 世界观设定\n${bible.worldSetting}`,
    bible.visualStyle && `### 视觉风格\n${bible.visualStyle}`,
    bible.eraConstraints && `### 年代规则\n${bible.eraConstraints}`,
    bible.locationRules && `### 地域与场景规则\n${bible.locationRules}`,
    bible.characterRules && `### 人物规则\n${bible.characterRules}`,
    bible.sceneRules && `### 场景资产规则\n${bible.sceneRules}`,
    bible.propRules && `### 道具资产规则\n${bible.propRules}`,
    bible.positivePromptTemplate && `### 正向提示词模板\n${bible.positivePromptTemplate}`,
    bible.negativePromptTemplate && `### 负向提示词模板\n${bible.negativePromptTemplate}`,
    bible.complianceRules && `### 合规规则\n${bible.complianceRules}`,
    "所有镜头卡、故事板、参考图和关键帧提示词必须服从以上设定。若剧本局部描述与 Production Bible 冲突，以 Production Bible 为准。",
  ].filter(Boolean).join("\n\n");
}

export async function getProductionBiblePromptBlock(projectId: string, episodeId?: string | null) {
  return formatProductionBibleContext(await getActiveProductionBible(projectId, episodeId));
}
