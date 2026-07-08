import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { createLanguageModel, extractJSON, resolveLanguageModelConfigs, supportsOpenAIJsonMode } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db, ensureImportStatesTable, ensureStoryPipelineTables } from "@/lib/db";
import {
  complianceReports,
  importStates,
  projects,
  scriptChunks,
  scripts,
} from "@/lib/db/schema";
import { buildChunkStructurePrompt, CHUNK_STRUCTURE_SYSTEM } from "@/lib/ai/prompts/chunk-structure";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog } from "@/lib/import-utils";
import { id as genId } from "@/lib/id";
import { structureScriptText } from "@/lib/script-structure";

export const maxDuration = 900;

type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

interface ChunkComplianceFlag {
  type?: string;
  risk_level?: RiskLevel;
  riskLevel?: RiskLevel;
  text?: string;
  reason?: string;
  suggestion?: string;
  need_human_review?: boolean;
  needHumanReview?: boolean;
}

interface ChunkAssetCandidate {
  name?: string;
  aliases?: string[];
  role?: string;
  type?: string;
  description?: string;
}

interface StructureVisualDetails {
  location_detail?: string;
  blocking?: string;
  props?: string[];
  set_dressing?: string[];
  wardrobe_detail?: string;
  action_detail?: string;
  emotion?: string;
  lighting?: string;
  atmosphere?: string;
}

interface StructureVisualAssetCandidate {
  name?: string;
  type?: "character" | "scene" | "prop" | "set_dressing" | "prompt_detail" | string;
  importance?: string;
}

interface StructureVisualPatch {
  beat_id?: string;
  original_text?: string;
  enriched_text?: string;
  added_visual_details?: StructureVisualDetails;
  asset_candidates?: StructureVisualAssetCandidate[];
  source_type?: string;
  confidence?: number;
}

interface StructureVisualEnrichment {
  patches?: StructureVisualPatch[];
  acceptedPatches?: StructureVisualPatch[];
  stats?: Record<string, unknown>;
}

interface ChunkStructureAnalysis {
  chunk_id: string;
  summary: string;
  compliance_flags: ChunkComplianceFlag[];
  assets: {
    characters: ChunkAssetCandidate[];
    scenes: ChunkAssetCandidate[];
    props: ChunkAssetCandidate[];
  };
  world_facts: string[];
  timeline_events: string[];
  continuity_notes: string[];
  emotion_changes: string[];
  key_plot_points: string[];
}

interface StructureBody {
  scriptId?: string;
  text?: string;
  visualEnrichment?: StructureVisualEnrichment | null;
  modelConfig?: { text?: ProviderConfig | null };
  concurrency?: number;
  retryFallback?: boolean;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function positiveIntEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function compactModelError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function describeTextModelConfig(config: ProviderConfig) {
  let host = "";
  try {
    host = config.baseUrl ? new URL(config.baseUrl).host : "";
  } catch {
    host = "";
  }
  return [config.protocol, host, config.modelId].filter(Boolean).join(":");
}

async function runWithTextModelRetries<T>(
  configs: ProviderConfig[],
  pickConfig: () => ProviderConfig,
  attempts: number,
  runner: (config: ProviderConfig) => Promise<T>
) {
  const maxAttempts = Math.max(1, Math.min(configs.length, attempts));
  const errors: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const config = pickConfig();
    try {
      return await runner(config);
    } catch (error) {
      errors.push(`${describeTextModelConfig(config)}: ${compactModelError(error)}`);
    }
  }

  throw new Error(`Failed after ${maxAttempts} text model config attempt(s). Last error: ${errors.at(-1) || "Unknown error"}`);
}

function asStringArray(value: unknown) {
  return asArray<unknown>(value)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeAssetCandidate(value: unknown): ChunkAssetCandidate | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = String(record.name || "").trim();
  if (!name) return null;
  return {
    name,
    aliases: asStringArray(record.aliases),
    role: String(record.role || "").trim(),
    type: String(record.type || "").trim(),
    description: String(record.description || "").trim(),
  };
}

function normalizeAnalysis(value: unknown, chunkId: string): ChunkStructureAnalysis {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const assets = record.assets && typeof record.assets === "object"
    ? (record.assets as Record<string, unknown>)
    : {};

  return {
    chunk_id: String(record.chunk_id || record.chunkId || chunkId),
    summary: String(record.summary || "").trim(),
    compliance_flags: asArray<ChunkComplianceFlag>(record.compliance_flags || record.complianceFlags),
    assets: {
      characters: asArray<unknown>(assets.characters).map(normalizeAssetCandidate).filter((item): item is ChunkAssetCandidate => Boolean(item)),
      scenes: asArray<unknown>(assets.scenes).map(normalizeAssetCandidate).filter((item): item is ChunkAssetCandidate => Boolean(item)),
      props: asArray<unknown>(assets.props).map(normalizeAssetCandidate).filter((item): item is ChunkAssetCandidate => Boolean(item)),
    },
    world_facts: asStringArray(record.world_facts || record.worldFacts),
    timeline_events: asStringArray(record.timeline_events || record.timelineEvents),
    continuity_notes: asStringArray(record.continuity_notes || record.continuityNotes),
    emotion_changes: asStringArray(record.emotion_changes || record.emotionChanges),
    key_plot_points: asStringArray(record.key_plot_points || record.keyPlotPoints),
  };
}

function normalizeRiskLevel(value: unknown): RiskLevel {
  const level = String(value || "low").toLowerCase();
  if (level === "none" || level === "low" || level === "medium" || level === "high" || level === "critical") {
    return level;
  }
  return "low";
}

function parseAnalysis(text: string, chunkId: string) {
  const json = extractJSON(text)
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
  try {
    return normalizeAnalysis(JSON.parse(json), chunkId);
  } catch (firstError) {
    const repaired = repairJsonText(json);
    try {
      return normalizeAnalysis(JSON.parse(repaired), chunkId);
    } catch {
      const quoteRepaired = escapeLooseStringQuotes(repaired).replace(/,\s*([}\]])/g, "$1");
      try {
        return normalizeAnalysis(JSON.parse(quoteRepaired), chunkId);
      } catch {
        const message = firstError instanceof Error ? firstError.message : "Invalid chunk JSON";
        throw new ChunkStructureParseError(message, json.slice(0, 1000));
      }
    }
  }
}

class ChunkStructureParseError extends Error {
  snippet: string;

  constructor(message: string, snippet: string) {
    super(message);
    this.name = "ChunkStructureParseError";
    this.snippet = snippet;
  }
}

function repairJsonText(json: string) {
  const normalized = json
    .replace(/^\uFEFF/, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
  return repairJsonStringLines(normalized)
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/:\s*"([^"]*(?:\n|\r)[^"]*)"/g, (_match, value: string) => {
      return `: "${value.replace(/\r?\n/g, "\\n").replace(/\t/g, "\\t")}"`;
    });
}

function hasUnescapedQuote(value: string) {
  let escaped = false;
  for (const ch of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") return true;
  }
  return false;
}

function repairJsonStringLines(json: string) {
  return json
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(\s*"[^"]+"\s*:\s*")([\s\S]*?)\s*$/);
      if (!match) return line;

      const [, prefix, value] = match;
      if (!value || hasUnescapedQuote(value)) return line;

      const commaMatch = value.match(/^(.*?)(,?)$/);
      if (!commaMatch) return line;

      return `${prefix}${commaMatch[1]}"${commaMatch[2]}`;
    })
    .join("\n");
}

function escapeLooseStringQuotes(json: string) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (!inString) {
      if (ch === "\"") inString = true;
      result += ch;
      continue;
    }

    if (escaped) {
      escaped = false;
      result += ch;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      result += ch;
      continue;
    }

    if (ch === "\"") {
      let nextIndex = i + 1;
      while (nextIndex < json.length && /\s/.test(json[nextIndex])) {
        nextIndex++;
      }
      const next = json[nextIndex];
      const isClosingQuote = next === ":" || next === "," || next === "}" || next === "]" || next === undefined;

      if (isClosingQuote) {
        inString = false;
        result += ch;
      } else {
        result += "\\\"";
      }
      continue;
    }

    result += ch;
  }

  return result;
}

function classifyStructureError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "AbortError" || /abort|timeout|timed out/i.test(message)) {
    return { type: "timeout", message: `单块 AI 解析超时：${message}` };
  }
  if (error instanceof ChunkStructureParseError || /JSON|parse|Unexpected token|Expected/i.test(message)) {
    return { type: "json_parse", message: `AI 返回 JSON 无法解析：${message}` };
  }
  return { type: "ai_request", message };
}

function compactText(value: unknown, maxLength = 360) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function uniqueByName(items: ChunkAssetCandidate[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const name = String(item.name || "").trim();
    if (!name) return false;
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildFallbackAnalysis(chunk: typeof scriptChunks.$inferSelect, reason: string): ChunkStructureAnalysis {
  const text = chunk.text || "";
  const characters: ChunkAssetCandidate[] = [];
  const rolePattern = /(女主角|男主角|反派女配|渣男前夫|黄金配角|配角|主角)[：:]\s*([^\n（(【】]{2,12})/g;

  for (const match of text.matchAll(rolePattern)) {
    characters.push({
      name: match[2].trim(),
      role: match[1],
      description: compactText(text.slice(match.index || 0, (match.index || 0) + 420), 220),
    });
  }

  for (const name of ["沈南乔", "陆霆骁", "林婉儿", "赵启明", "陆母"]) {
    if (!text.includes(name)) continue;
    const index = text.indexOf(name);
    characters.push({
      name,
      role: /沈南乔|陆霆骁/.test(name) ? "main" : "supporting",
      description: compactText(text.slice(Math.max(0, index - 80), index + 260), 220),
    });
  }

  const scenes = ["沈家客厅", "军区大院", "民政局", "医院", "军区医院", "国营机械厂", "陆家", "基地", "机库", "庄园"]
    .filter((name) => text.includes(name))
    .map((name) => {
      const index = text.indexOf(name);
      return {
        name,
        type: "location",
        description: compactText(text.slice(Math.max(0, index - 80), index + 220), 180),
      };
    });

  const props = ["轮椅", "银针", "灵泉", "照片", "金条", "病历", "录音", "卡车", "飞机模型", "全家福"]
    .filter((name) => text.includes(name))
    .map((name) => {
      const index = text.indexOf(name);
      return {
        name,
        type: "prop",
        description: compactText(text.slice(Math.max(0, index - 80), index + 220), 180),
      };
    });

  return {
    chunk_id: chunk.id,
    summary: compactText(text, 500),
    compliance_flags: [],
    assets: {
      characters: uniqueByName(characters).slice(0, 30),
      scenes: uniqueByName(scenes).slice(0, 30),
      props: uniqueByName(props).slice(0, 30),
    },
    world_facts: [
      "AI structure JSON was incomplete; this chunk used local fallback extraction.",
      compactText(text, 260),
    ],
    timeline_events: [],
    continuity_notes: [`Fallback structure used for chunk ${chunk.chunkIndex}: ${reason}`],
    emotion_changes: [],
    key_plot_points: [],
  };
}

function getStoredAnalysis(chunk: typeof scriptChunks.$inferSelect): ChunkStructureAnalysis | null {
  const metadata = chunk.metadata && typeof chunk.metadata === "object"
    ? (chunk.metadata as Record<string, unknown>)
    : {};
  if (!metadata.analysis) return null;
  return normalizeAnalysis(metadata.analysis, chunk.id);
}

function isFallbackChunk(chunk: typeof scriptChunks.$inferSelect) {
  const metadata = chunk.metadata && typeof chunk.metadata === "object"
    ? (chunk.metadata as Record<string, unknown>)
    : {};
  return Boolean(metadata.fallbackStructure);
}

function stripFallbackMetadata(metadata: Record<string, unknown>) {
  const { fallbackStructure, structureWarning, ...rest } = metadata;
  void fallbackStructure;
  void structureWarning;
  return rest;
}

function buildLocalFallbackAnalysis(chunk: typeof scriptChunks.$inferSelect, reason: string): ChunkStructureAnalysis {
  const text = chunk.text || "";
  const characters: ChunkAssetCandidate[] = [];
  const rolePattern = /(?:主角|男主|女主|反派|配角|人物|角色)[:：]\s*([^\n，,。；;、【】]{2,16})/g;

  for (const match of text.matchAll(rolePattern)) {
    const name = (match[1] || "").trim();
    if (!name) continue;
    characters.push({
      name,
      role: "character",
      description: compactText(text.slice(match.index || 0, (match.index || 0) + 360), 220),
    });
  }

  const sceneNames = new Set<string>();
  for (const match of text.matchAll(/(?:地点|场景|外景|内景|转场)[:：]?\s*([^\n，,。；;【】]{2,24})/g)) {
    const name = (match[1] || "").trim();
    if (name) sceneNames.add(name);
  }
  const scenes = [...sceneNames].slice(0, 30).map((name) => {
    const index = text.indexOf(name);
    return {
      name,
      type: "location",
      description: compactText(text.slice(Math.max(0, index - 80), index + 220), 180),
    };
  });

  const propNames = new Set<string>();
  for (const match of text.matchAll(/(?:道具|物件|证据|文件|照片|录音|信物)[:：]?\s*([^\n，,。；;【】]{2,18})/g)) {
    const name = (match[1] || "").trim();
    if (name) propNames.add(name);
  }
  const props = [...propNames].slice(0, 30).map((name) => {
    const index = text.indexOf(name);
    return {
      name,
      type: "prop",
      description: compactText(text.slice(Math.max(0, index - 80), index + 220), 180),
    };
  });

  return {
    chunk_id: chunk.id,
    summary: compactText(text, 500),
    compliance_flags: [],
    assets: {
      characters: uniqueByName(characters).slice(0, 30),
      scenes: uniqueByName(scenes).slice(0, 30),
      props: uniqueByName(props).slice(0, 30),
    },
    world_facts: [
      "AI structure request timed out or returned invalid JSON; this chunk used local fallback extraction.",
      compactText(text, 260),
    ],
    timeline_events: [],
    continuity_notes: [`Fallback structure used for chunk ${chunk.chunkIndex}: ${reason}`],
    emotion_changes: [],
    key_plot_points: [],
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function mergeAssets(items: ChunkAssetCandidate[]) {
  const byName = new Map<string, ChunkAssetCandidate & { count: number }>();
  for (const item of items) {
    const name = String(item.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...item, aliases: item.aliases || [], count: 1 });
      continue;
    }
    existing.count++;
    existing.aliases = [...new Set([...(existing.aliases || []), ...(item.aliases || [])])];
    if ((item.description || "").length > (existing.description || "").length) {
      existing.description = item.description;
    }
    if (!existing.role && item.role) existing.role = item.role;
    if (!existing.type && item.type) existing.type = item.type;
  }
  return [...byName.values()]
    .sort((a, b) => b.count - a.count || a.name!.localeCompare(b.name!))
    .map(({ count, ...item }) => ({ ...item, frequency: count }));
}

function compactForPrompt(value: unknown, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function getVisualPatches(visualEnrichment?: StructureVisualEnrichment | null) {
  const patches = visualEnrichment?.acceptedPatches?.length
    ? visualEnrichment.acceptedPatches
    : visualEnrichment?.patches || [];
  return patches.filter((patch) => String(patch.original_text || "").trim());
}

function formatVisualPatchForPrompt(patch: StructureVisualPatch) {
  const details = patch.added_visual_details || {};
  const detailsText = [
    details.location_detail && `location=${compactForPrompt(details.location_detail)}`,
    details.blocking && `blocking=${compactForPrompt(details.blocking)}`,
    details.action_detail && `action=${compactForPrompt(details.action_detail)}`,
    details.emotion && `emotion=${compactForPrompt(details.emotion)}`,
    details.lighting && `lighting=${compactForPrompt(details.lighting)}`,
    details.atmosphere && `atmosphere=${compactForPrompt(details.atmosphere)}`,
    details.props?.length ? `props=${details.props.map((item) => compactForPrompt(item, 40)).join(", ")}` : "",
    details.set_dressing?.length ? `set_dressing=${details.set_dressing.map((item) => compactForPrompt(item, 40)).join(", ")}` : "",
    details.wardrobe_detail && `wardrobe=${compactForPrompt(details.wardrobe_detail)}`,
  ].filter(Boolean).join("; ");
  const candidates = (patch.asset_candidates || [])
    .filter((candidate) => candidate.name && candidate.type !== "prompt_detail")
    .map((candidate) => `${candidate.name}(${candidate.type || "asset"}:${candidate.importance || "temporary"})`)
    .slice(0, 8)
    .join(", ");
  return [
    `source: ${compactForPrompt(patch.original_text, 160)}`,
    detailsText ? `visual: ${detailsText}` : "",
    candidates ? `asset_candidates: ${candidates}` : "",
  ].filter(Boolean).join("\n");
}

function buildVisualContextByChunk(
  chunks: Array<typeof scriptChunks.$inferSelect>,
  visualEnrichment?: StructureVisualEnrichment | null,
) {
  const byChunkId = new Map<string, string[]>();
  const usedPatchIds = new Set<number>();
  const patches = getVisualPatches(visualEnrichment);

  patches.forEach((patch, patchIndex) => {
    const original = String(patch.original_text || "").trim();
    if (!original) return;
    const owner = chunks.find((chunk) => chunk.text.includes(original));
    if (!owner) return;
    const current = byChunkId.get(owner.id) || [];
    if (current.length >= 8) return;
    current.push(formatVisualPatchForPrompt(patch));
    byChunkId.set(owner.id, current);
    usedPatchIds.add(patchIndex);
  });

  return {
    byChunkId,
    patchCount: patches.length,
    usedPatchCount: usedPatchIds.size,
  };
}

function assetsFromVisualEnrichment(visualEnrichment?: StructureVisualEnrichment | null) {
  const assets = {
    characters: [] as ChunkAssetCandidate[],
    scenes: [] as ChunkAssetCandidate[],
    props: [] as ChunkAssetCandidate[],
  };

  for (const patch of getVisualPatches(visualEnrichment)) {
    const details = patch.added_visual_details || {};
    const candidates = patch.asset_candidates || [];
    for (const candidate of candidates) {
      const name = String(candidate.name || "").trim();
      if (!name || candidate.type === "prompt_detail") continue;
      const description = [
        details.location_detail,
        details.blocking,
        details.action_detail,
        details.lighting,
        details.atmosphere,
      ].map((item) => compactForPrompt(item, 60)).filter(Boolean).join("；");
      const item: ChunkAssetCandidate = {
        name,
        type: String(candidate.type || ""),
        description: description || compactForPrompt(patch.enriched_text || patch.original_text, 80),
      };
      if (candidate.type === "character") assets.characters.push(item);
      if (candidate.type === "scene") assets.scenes.push(item);
      if (candidate.type === "prop" || candidate.type === "set_dressing") assets.props.push(item);
    }
  }

  return assets;
}

function buildStoryAnalysis(
  scriptId: string,
  analyses: ChunkStructureAnalysis[],
  visualEnrichment?: StructureVisualEnrichment | null,
) {
  const worldFacts = analyses.flatMap((item) => item.world_facts);
  const timeline = analyses.flatMap((item) => item.timeline_events);
  const continuity = analyses.flatMap((item) => item.continuity_notes);
  const visualAssets = assetsFromVisualEnrichment(visualEnrichment);

  return {
    scriptId,
    storyMeta: {
      background: worldFacts.slice(0, 12).join("; "),
      visualStyleBase: continuity.slice(0, 8).join("; "),
      genre: "",
      time: timeline.slice(0, 8).join("; "),
      locationBackground: worldFacts
        .filter((item) => /[\u4e00-\u9fff]/.test(item) && /(场|地|县|市|村|学校|医院|公司|房|屋)/.test(item))
        .slice(0, 8)
        .join("; "),
    },
    assets: {
      characters: mergeAssets([...analyses.flatMap((item) => item.assets.characters), ...visualAssets.characters]),
      scenes: mergeAssets([...analyses.flatMap((item) => item.assets.scenes), ...visualAssets.scenes]),
      props: mergeAssets([...analyses.flatMap((item) => item.assets.props), ...visualAssets.props]),
    },
    chunks: analyses,
    continuityNotes: continuity,
    timelineEvents: timeline,
    keyPlotPoints: analyses.flatMap((item) => item.key_plot_points),
    emotionChanges: analyses.flatMap((item) => item.emotion_changes),
  };
}

function issueCategoryFromRisk(type: string) {
  if (/ip|portrait|political|platform|violence|sexual|medical/i.test(type)) return "prohibited";
  if (/continuity/i.test(type)) return "continuity";
  if (/setting/i.test(type)) return "setting";
  return "other";
}

function issueSeverityFromRisk(level: RiskLevel) {
  if (level === "critical" || level === "high") return "high";
  if (level === "medium") return "medium";
  return "low";
}

function buildReviewIssues(analyses: ChunkStructureAnalysis[]) {
  return analyses.flatMap((analysis) =>
    analysis.compliance_flags
      .map((flag) => {
        const riskLevel = normalizeRiskLevel(flag.risk_level || flag.riskLevel);
        const type = String(flag.type || "other");
        const exactQuote = String(flag.text || "").trim();
        const reason = String(flag.reason || "").trim();
        const suggestion = String(flag.suggestion || "").trim();
        if (riskLevel === "none" || (!exactQuote && !reason)) return null;
        return {
          category: issueCategoryFromRisk(type),
          severity: issueSeverityFromRisk(riskLevel),
          title: `${type}: ${riskLevel}`,
          exactQuote,
          explanation: reason,
          suggestion,
          replacement: suggestion,
          replaceMode: "first" as const,
          chunkId: analysis.chunk_id,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  );
}

async function getTargetScript(projectId: string, scriptId?: string) {
  if (scriptId) {
    const [script] = await db
      .select()
      .from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.projectId, projectId)));
    return script ?? null;
  }

  const [latest] = await db
    .select()
    .from(scripts)
    .where(eq(scripts.projectId, projectId))
    .orderBy(desc(scripts.createdAt))
    .limit(1);
  return latest ?? null;
}

async function syncScriptTextForStructure(
  projectId: string,
  script: typeof scripts.$inferSelect,
  text?: string,
) {
  const incomingText = String(text || "").trim();
  const currentText = String(script.cleanedText || script.rawText || "").trim();
  if (!incomingText || incomingText === currentText) return script;

  const structured = structureScriptText(incomingText);
  const cleanedText = structured.cleanedText;
  if (!cleanedText.trim()) {
    throw new Error("Enriched script text is empty");
  }

  await db.delete(scriptChunks).where(eq(scriptChunks.scriptId, script.id));

  const metadata = script.metadata && typeof script.metadata === "object"
    ? script.metadata as Record<string, unknown>
    : {};
  const updatedMetadata = {
    ...metadata,
    ...structured.summary,
    enrichmentApplied: true,
    enrichmentUpdatedAt: new Date().toISOString(),
  };

  const [updatedScript] = await db
    .update(scripts)
    .set({
      cleanedText,
      contentHash: createHash("sha256").update(cleanedText).digest("hex"),
      status: "chunked",
      metadata: updatedMetadata,
      updatedAt: new Date(),
    })
    .where(eq(scripts.id, script.id))
    .returning();

  if (structured.chunks.length > 0) {
    await db.insert(scriptChunks).values(
      structured.chunks.map((chunk) => ({
        id: genId(),
        scriptId: script.id,
        projectId,
        chunkIndex: chunk.chunkIndex,
        episodeIndex: chunk.episodeIndex,
        sceneIndex: chunk.sceneIndex,
        text: chunk.text,
        startIndex: chunk.startIndex,
        endIndex: chunk.endIndex,
        overlapBefore: chunk.overlapBefore,
        overlapAfter: chunk.overlapAfter,
        status: "pending" as const,
        metadata: {
          ...chunk.metadata,
          localChunkId: chunk.id,
          source: "enriched_text",
        },
      })),
    );
  }

  await db
    .update(projects)
    .set({ script: cleanedText, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  await addImportLog(
    projectId,
    2,
    "running",
    `enriched script synced before review: ${cleanedText.length} chars, ${structured.chunks.length} chunks`,
    {
      scriptId: script.id,
      charCount: cleanedText.length,
      chunkCount: structured.chunks.length,
    },
  );

  return updatedScript ?? { ...script, cleanedText, metadata: updatedMetadata };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureImportStatesTable();
  ensureStoryPipelineTables();

  const body = (await request.json()) as StructureBody;
  const textModelConfigs = resolveLanguageModelConfigs(body.modelConfig?.text);
  if (textModelConfigs.length === 0) {
    return NextResponse.json({ error: "No text model" }, { status: 400 });
  }

  let script = await getTargetScript(projectId, body.scriptId);
  if (!script) {
    return NextResponse.json({ error: "No parsed script found" }, { status: 404 });
  }
  script = await syncScriptTextForStructure(projectId, script, body.text);

  const chunks = await db
    .select()
    .from(scriptChunks)
    .where(eq(scriptChunks.scriptId, script.id))
    .orderBy(asc(scriptChunks.chunkIndex));

  if (chunks.length === 0) {
    return NextResponse.json({ error: "Script has no chunks" }, { status: 400 });
  }

  const visualContext = buildVisualContextByChunk(chunks, body.visualEnrichment);
  if (visualContext.patchCount > 0) {
    await addImportLog(
      projectId,
      2,
      "running",
      `隐藏视觉补充已接入审阅：${visualContext.usedPatchCount}/${visualContext.patchCount} 段匹配到原文 chunk`,
      {
        patchCount: visualContext.patchCount,
        usedPatchCount: visualContext.usedPatchCount,
      },
    );
  }

  const perKeyConcurrency = positiveIntEnv("IMPORT_TEXT_PER_KEY_CONCURRENCY", 2);
  const maxConcurrency = positiveIntEnv("IMPORT_STRUCTURE_MAX_CONCURRENCY", 16);
  const poolConcurrency = textModelConfigs.length * perKeyConcurrency;
  const concurrency = Math.max(1, Math.min(maxConcurrency, Math.max(body.concurrency ?? 0, poolConcurrency)));
  const textModelAttempts = positiveIntEnv("IMPORT_TEXT_MODEL_ATTEMPTS", textModelConfigs.length);
  let modelCursor = 0;
  const nextTextModelConfig = () => {
    const config = textModelConfigs[modelCursor % textModelConfigs.length];
    modelCursor += 1;
    return config;
  };
  const chunkTimeoutMs = Math.max(60_000, Number(process.env.IMPORT_STRUCTURE_CHUNK_TIMEOUT_MS || 240_000));
  const retryFallback = body.retryFallback ?? true;

  await addImportLog(
    projectId,
    2,
    "running",
    `开始 chunk 结构化解析：${chunks.length} 块，并发 ${concurrency}，文本 key ${textModelConfigs.length} 个，单块超时 ${Math.round(chunkTimeoutMs / 1000)} 秒`
  );
  await db
    .insert(importStates)
    .values({
      projectId,
      currentStep: 2,
      stepStatus: { 1: "done", 2: "running", 3: "idle", 4: "idle", 5: "idle" },
      fullText: script.cleanedText || script.rawText,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: importStates.projectId,
      set: {
        currentStep: 2,
        stepStatus: { 1: "done", 2: "running", 3: "idle", 4: "idle", 5: "idle" },
        fullText: script.cleanedText || script.rawText,
        updatedAt: new Date(),
      },
    });

  let completedChunks = chunks.filter(
    (chunk) => chunk.status === "parsed" && getStoredAnalysis(chunk) && (!retryFallback || !isFallbackChunk(chunk))
  ).length;
  const recordChunkProgress = async (
    chunk: typeof scriptChunks.$inferSelect,
    fallback = false,
    warning?: { type: string; message: string },
  ) => {
    completedChunks += 1;
    const sourceLabel = fallback ? "本地兜底解析" : "AI解析";
    const warningSuffix = warning ? `，原因：${warning.type}` : "";
    await addImportLog(
      projectId,
      2,
      "running",
      `chunk progress: ${completedChunks}/${chunks.length} (chunk ${chunk.chunkIndex + 1}，${sourceLabel}${warningSuffix})`,
      {
        scriptId: script.id,
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        completedChunks,
        totalChunks: chunks.length,
        fallback,
        source: fallback ? "local" : "ai",
        sourceLabel,
        warning,
      }
    );
  };

  const results = await mapWithConcurrency(chunks, concurrency, async (chunk) => {
    const shouldRetryFallback = retryFallback && isFallbackChunk(chunk);
    const storedAnalysis = chunk.status === "parsed" && !shouldRetryFallback ? getStoredAnalysis(chunk) : null;
    if (storedAnalysis) {
      const fallback = isFallbackChunk(chunk);
      return {
        ok: true as const,
        chunkId: chunk.id,
        analysis: storedAnalysis,
        cached: true,
        fallback,
        source: fallback ? "local" as const : "ai" as const,
      };
    }

    try {
      await db
        .update(scriptChunks)
        .set({ status: "pending", updatedAt: new Date() })
        .where(eq(scriptChunks.id, chunk.id));

      const metadata = chunk.metadata && typeof chunk.metadata === "object"
        ? (chunk.metadata as Record<string, unknown>)
        : {};
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), chunkTimeoutMs);
      const result = await (async () => {
        try {
          return await runWithTextModelRetries(textModelConfigs, nextTextModelConfig, textModelAttempts, async (modelConfig) => {
            return await generateText({
            model: createLanguageModel(modelConfig),
            system: CHUNK_STRUCTURE_SYSTEM,
            prompt: buildChunkStructurePrompt({
              chunkId: chunk.id,
              chunkIndex: chunk.chunkIndex,
              totalChunks: chunks.length,
              episodeIndex: chunk.episodeIndex,
              sceneIndex: chunk.sceneIndex,
              episodeTitle: String(metadata.episodeTitle || ""),
              sceneTitle: String(metadata.sceneTitle || ""),
              text: chunk.text,
              visualContext: (visualContext.byChunkId.get(chunk.id) || []).join("\n\n"),
            }),
            providerOptions: supportsOpenAIJsonMode(modelConfig)
              ? { openai: { response_format: { type: "json_object" as const } } }
              : undefined,
            temperature: 0.1,
            maxRetries: 1,
            maxOutputTokens: 6000,
            abortSignal: controller.signal,
          });
          });
        } finally {
          clearTimeout(timeout);
        }
      })();

      const analysis = parseAnalysis(result.text, chunk.id);
      const cleanMetadata = stripFallbackMetadata(metadata);

      await db
        .update(scriptChunks)
        .set({
          status: "parsed",
          metadata: {
            ...cleanMetadata,
            analysis,
            usage: result.usage,
            source: "ai",
            visualEnrichmentUsed: (visualContext.byChunkId.get(chunk.id) || []).length,
          },
          updatedAt: new Date(),
        })
        .where(eq(scriptChunks.id, chunk.id));

      await db.delete(complianceReports).where(eq(complianceReports.chunkId, chunk.id));
      const reports = analysis.compliance_flags
        .map((flag) => ({
          riskLevel: normalizeRiskLevel(flag.risk_level || flag.riskLevel),
          riskType: String(flag.type || "other"),
          sourceText: String(flag.text || ""),
          reason: String(flag.reason || ""),
          suggestion: String(flag.suggestion || ""),
          needHumanReview: flag.need_human_review || flag.needHumanReview ? 1 : 0,
        }))
        .filter((flag) => flag.riskLevel !== "none" && (flag.sourceText || flag.reason));

      if (reports.length > 0) {
        await db.insert(complianceReports).values(
          reports.map((report) => ({
            id: genId(),
            projectId,
            scriptId: script.id,
            chunkId: chunk.id,
            ...report,
            status: "open" as const,
          }))
        );
      }

      await recordChunkProgress(chunk);
      return { ok: true as const, chunkId: chunk.id, analysis, usage: result.usage, fallback: false, source: "ai" as const };
    } catch (err) {
      const warning = classifyStructureError(err);
      const metadata = chunk.metadata && typeof chunk.metadata === "object"
        ? (chunk.metadata as Record<string, unknown>)
        : {};
      const fallbackAnalysis = buildLocalFallbackAnalysis(chunk, warning.message);
      await db
        .update(scriptChunks)
        .set({
          status: "parsed",
          metadata: {
            ...metadata,
            analysis: fallbackAnalysis,
            structureWarning: warning.message,
            structureWarningType: warning.type,
            structureWarningSnippet: err instanceof ChunkStructureParseError ? err.snippet : "",
            fallbackStructure: true,
            source: "local",
          },
          updatedAt: new Date(),
        })
        .where(eq(scriptChunks.id, chunk.id));
      await recordChunkProgress(chunk, true, warning);
      return { ok: true as const, chunkId: chunk.id, analysis: fallbackAnalysis, warning: warning.message, fallback: true, source: "local" as const };
    }
  });

  const analyses: ChunkStructureAnalysis[] = [];
  const failedChunks: Array<{ chunkId: string; error: string }> = [];
  let aiParsedChunks = 0;
  let localFallbackChunks = 0;
  for (const item of results) {
    if (item.ok) {
      analyses.push(item.analysis);
      if (item.fallback) {
        localFallbackChunks += 1;
      } else {
        aiParsedChunks += 1;
      }
    } else {
      const failedItem = item as { chunkId: string; error?: string };
      failedChunks.push({
        chunkId: failedItem.chunkId,
        error: failedItem.error || "Unknown structure error",
      });
    }
  }
  const storyAnalysis = buildStoryAnalysis(script.id, analyses, body.visualEnrichment);
  const issues = buildReviewIssues(analyses);
  const status = failedChunks.length === chunks.length ? "failed" : "parsed";

  await db
    .update(scripts)
    .set({
      status,
      metadata: {
        ...(script.metadata && typeof script.metadata === "object" ? script.metadata : {}),
        storyAnalysis,
        issues,
        failedChunks,
        visualEnrichment: {
          patchCount: visualContext.patchCount,
          usedPatchCount: visualContext.usedPatchCount,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(scripts.id, script.id));

  await db
    .insert(importStates)
    .values({
      projectId,
      currentStep: 2,
      stepStatus: { 1: "done", 2: "idle", 3: "idle", 4: "idle", 5: "idle" },
      fullText: script.cleanedText || script.rawText,
      storyAnalysis,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: importStates.projectId,
      set: {
        currentStep: 2,
        stepStatus: { 1: "done", 2: "idle", 3: "idle", 4: "idle", 5: "idle" },
        fullText: script.cleanedText || script.rawText,
        storyAnalysis,
        updatedAt: new Date(),
      },
    });

  await addImportLog(
    projectId,
    2,
    failedChunks.length > 0 ? "running" : "done",
    `chunk structure parsed: ${analyses.length}/${chunks.length} succeeded, AI解析 ${aiParsedChunks} 块，本地兜底解析 ${localFallbackChunks} 块，${failedChunks.length} failed`,
    { scriptId: script.id, storyAnalysis, issues, failedChunks, aiParsedChunks, localFallbackChunks }
  );

  return NextResponse.json({
    scriptId: script.id,
    totalChunks: chunks.length,
    parsedChunks: analyses.length,
    failedChunks,
    issues,
    analyses,
    storyAnalysis,
  });
}
