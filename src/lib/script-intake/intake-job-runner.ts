import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateText } from "ai";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db, ensureScriptIntakeTables, ensureStoryPipelineTables } from "@/lib/db";
import {
  confirmedScriptVersions,
  intakeJobLogs,
  intakeJobStages,
  intakeJobs,
  projects,
  scriptChunks,
  scripts,
  tasks,
} from "@/lib/db/schema";
import { id as genId } from "@/lib/id";
import { addImportLog, chunkText, extractTextFromFile } from "@/lib/import-utils";
import {
  cleanScriptText,
  detectScriptLanguage,
  structureScriptText,
  type StructuredScript,
} from "@/lib/script-structure";
import {
  buildStructuredScriptJson,
  type StructuredScriptJson,
} from "@/lib/script-intake/structured-script-json";
import {
  applyEnrichmentPatchesToText,
  generateScriptVisualEnrichmentPreview,
  type EnrichmentPatch,
} from "@/lib/script-visual-enrichment";
import {
  createLanguageModel,
  extractJSON,
  resolveLanguageModelConfigs,
  supportsOpenAIJsonMode,
  type ProviderConfig,
} from "@/lib/ai/ai-sdk";
import { enqueueTask } from "@/lib/task-queue";

export const INTAKE_STAGES = [
  { stage: "upload_document", sequence: 1, progress: 5 },
  { stage: "extract_raw_text", sequence: 2, progress: 12 },
  { stage: "clean_text", sequence: 3, progress: 18 },
  { stage: "light_compliance_precheck", sequence: 4, progress: 22 },
  { stage: "detect_document_type", sequence: 5, progress: 28 },
  { stage: "parse_sections", sequence: 6, progress: 34 },
  { stage: "parse_script_body", sequence: 7, progress: 42 },
  { stage: "document_cleaner", sequence: 8, progress: 48 },
  { stage: "parse_dialogue_action_emotion", sequence: 9, progress: 54 },
  { stage: "structured_script_json", sequence: 10, progress: 60 },
  { stage: "story_visual_bible", sequence: 11, progress: 64 },
  { stage: "ai_structure_review", sequence: 12, progress: 68 },
  { stage: "script_visual_enrichment", sequence: 13, progress: 78 },
  { stage: "enrichment_validation", sequence: 14, progress: 84 },
  { stage: "text_compliance_review", sequence: 15, progress: 90 },
  { stage: "human_review", sequence: 16, progress: 94 },
  { stage: "confirmed_script_version", sequence: 17, progress: 100 },
] as const;

const SCRIPT_INTAKE_AI_TIMEOUT_MS = Math.max(
  10_000,
  Number.parseInt(process.env.SCRIPT_INTAKE_AI_TIMEOUT_MS ?? "", 10) || 90_000,
);
const SCRIPT_INTAKE_STALE_RUNNING_MS = Math.max(
  SCRIPT_INTAKE_AI_TIMEOUT_MS * 4,
  Number.parseInt(process.env.SCRIPT_INTAKE_STALE_RUNNING_MS ?? "", 10) || 600_000,
);
const SCRIPT_INTAKE_MAX_AI_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number.parseInt(process.env.SCRIPT_INTAKE_AI_CONCURRENCY ?? "", 10) || 4),
);
const SCRIPT_INTAKE_AI_PER_KEY_CONCURRENCY = Math.max(
  1,
  Math.min(4, Number.parseInt(process.env.SCRIPT_INTAKE_AI_PER_KEY_CONCURRENCY ?? "", 10) || 1),
);
const SCRIPT_INTAKE_AI_FALLBACKS_PER_CHUNK = Math.max(
  1,
  Math.min(3, Number.parseInt(process.env.SCRIPT_INTAKE_AI_FALLBACKS_PER_CHUNK ?? "", 10) || 1),
);

type IntakeStageName = typeof INTAKE_STAGES[number]["stage"];
type IntakeJob = typeof intakeJobs.$inferSelect;
type IntakeStage = typeof intakeJobStages.$inferSelect;

type StageResult = Record<string, unknown>;
type StageRunnerOutput = {
  result?: StageResult;
  issues?: IntakeIssue[];
  logs?: unknown[];
  skip?: boolean;
};
type StageRunContext = {
  runId: string;
  isCurrent: () => Promise<boolean>;
  updateProgress: (progress: number) => Promise<boolean>;
};
type IntakeIssue = {
  stage: string;
  severity: "low" | "medium" | "high";
  category: string;
  message: string;
  text?: string;
  suggestion?: string;
  lineNumber?: number;
  characterOffset?: number;
  episodeId?: string;
  episodeTitle?: string;
  sceneId?: string;
  sceneTitle?: string;
  context?: string;
};

type StoryMetaAnalysis = {
  time?: string;
  background?: string;
  visualStyleBase?: string;
  genre?: string;
  locationBackground?: string;
};

type StoryAssetAnalysis = {
  storyMeta?: StoryMetaAnalysis;
};

interface IntakeOptions {
  sourceMode?: "file" | "text";
  modelConfig?: { text?: ProviderConfig | null } | null;
  allowAiOverwrite?: boolean;
}

export interface StartScriptIntakeJobInput {
  projectId: string;
  sourceFilename: string;
  sourceType?: string;
  sourceBuffer?: Buffer;
  sourceText?: string;
  modelConfig?: { text?: ProviderConfig | null } | null;
  allowAiOverwrite?: boolean;
}

export interface ConfirmScriptIntakeInput {
  projectId: string;
  jobId: string;
  userId: string;
  content?: string;
  reviewNotes?: unknown;
}

function now() {
  return new Date();
}

function timeMs(value: Date | number | string | null | undefined) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readOptions(job: IntakeJob): IntakeOptions {
  return toRecord(job.options) as IntakeOptions;
}

function sanitizeFilename(filename: string) {
  const base = path.basename(filename || "script.txt");
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 160) || "script.txt";
}

function sourceTypeFromFilename(filename: string) {
  return path.extname(filename).replace(/^\./, "").toLowerCase() || "txt";
}

function compact(value: unknown, maxLength = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function cleanMetaText(value: unknown, maxLength = 160) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getAiConfigs(options: IntakeOptions) {
  return resolveLanguageModelConfigs(options.modelConfig?.text);
}

function getAiConcurrency(configs: ProviderConfig[], itemCount: number) {
  const keyCount = Math.max(1, configs.length || 1);
  const keyLimitedConcurrency = keyCount * SCRIPT_INTAKE_AI_PER_KEY_CONCURRENCY;
  return Math.max(1, Math.min(SCRIPT_INTAKE_MAX_AI_CONCURRENCY, keyLimitedConcurrency, itemCount || 1));
}

function getAiConcurrencyMeta(configs: ProviderConfig[], itemCount: number) {
  return {
    concurrency: getAiConcurrency(configs, itemCount),
    keyCount: configs.length,
    perKeyConcurrency: SCRIPT_INTAKE_AI_PER_KEY_CONCURRENCY,
    maxConcurrency: SCRIPT_INTAKE_MAX_AI_CONCURRENCY,
  };
}

function rotateConfigs(configs: ProviderConfig[], offset: number) {
  if (configs.length <= 1) return configs;
  const index = ((offset % configs.length) + configs.length) % configs.length;
  return [...configs.slice(index), ...configs.slice(0, index)];
}

function selectChunkConfigs(configs: ProviderConfig[], offset: number) {
  return rotateConfigs(configs, offset).slice(0, Math.min(configs.length, SCRIPT_INTAKE_AI_FALLBACKS_PER_CHUNK));
}

function lineNumberAt(text: string, offset: number) {
  if (offset < 0) return undefined;
  return text.slice(0, offset).split("\n").length;
}

function contextAround(text: string, offset: number, length: number) {
  if (offset < 0) return "";
  const start = Math.max(0, offset - 80);
  const end = Math.min(text.length, offset + Math.max(length, 1) + 80);
  return compact(text.slice(start, end), 220);
}

function annotateIssuesWithScriptContext(issues: IntakeIssue[], sourceText: string) {
  if (!issues.length || !sourceText.trim()) return issues;
  const structured = structureScriptText(sourceText);
  return issues.map((issue) => {
    if (issue.lineNumber || issue.sceneId || !issue.text?.trim()) return issue;
    const quote = issue.text.trim();
    const offset = sourceText.indexOf(quote);
    if (offset < 0) return issue;
    const scene = structured.scenes.find((item) => offset >= item.startIndex && offset < item.endIndex);
    const episode = structured.episodes.find((item) => offset >= item.startIndex && offset < item.endIndex);
    return {
      ...issue,
      characterOffset: offset,
      lineNumber: lineNumberAt(sourceText, offset),
      episodeId: episode?.id,
      episodeTitle: episode?.title,
      sceneId: scene?.id,
      sceneTitle: scene?.title,
      context: contextAround(sourceText, offset, quote.length),
    };
  });
}

function summarizeTextRevision(before: string, after: string, source: string) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const changedSamples: Array<{ lineNumber: number; before: string; after: string }> = [];
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  let changedLineCount = 0;
  for (let index = 0; index < maxLines; index += 1) {
    const beforeLine = beforeLines[index] ?? "";
    const afterLine = afterLines[index] ?? "";
    if (beforeLine === afterLine) continue;
    changedLineCount += 1;
    if (changedSamples.length < 8) {
      changedSamples.push({
        lineNumber: index + 1,
        before: compact(beforeLine, 160),
        after: compact(afterLine, 160),
      });
    }
  }
  return {
    source,
    changed: before !== after,
    beforeHash: hashText(before),
    afterHash: hashText(after),
    beforeCharCount: before.length,
    afterCharCount: after.length,
    charDelta: after.length - before.length,
    changedLineCount,
    changedSamples,
    samples: changedSamples,
  };
}

function normalizeStoryAnalysis(value: unknown): StoryAssetAnalysis | null {
  const meta = toRecord(toRecord(value).storyMeta);
  const storyMeta: StoryMetaAnalysis = {
    time: cleanMetaText(meta.time, 120),
    background: cleanMetaText(meta.background, 180),
    visualStyleBase: cleanMetaText(meta.visualStyleBase, 220),
    genre: cleanMetaText(meta.genre, 80),
    locationBackground: cleanMetaText(meta.locationBackground, 120),
  };
  return Object.values(storyMeta).some(Boolean) ? { storyMeta } : null;
}

function detectStoryEra(text: string) {
  const year = text.match(/(19[0-9]{2}|20[0-9]{2})\s*年?/);
  if (year) return `${year[1]} 年代中国`;
  if (/八十年代|80年代|1980年代|1980s/i.test(text)) return "1980年代中国";
  if (/七十年代|70年代|1970年代|1970s/i.test(text)) return "1970年代中国";
  if (/九十年代|90年代|1990年代|1990s/i.test(text)) return "1990年代中国";
  if (/民国|军阀|谍战|抗战/.test(text)) return "民国/近代中国";
  if (/古代|唐代|宋代|明代|清代|汉代|古装|仙侠|武侠|宫廷/.test(text)) return "古代中国";
  if (/末世|废土|末日|灾变|丧尸|避难所/.test(text)) return "近未来末世/废土中国";
  return "当代现实中国";
}

function detectStoryGenre(text: string) {
  if (/末世|废土|丧尸|灾变|避难所/.test(text)) return "末世生存短剧";
  if (/古装|宫廷|权谋|武侠|仙侠|玄幻|修仙|江湖/.test(text)) return "古装/东方幻想短剧";
  if (/民国|军阀|谍战|抗战/.test(text)) return "年代/民国短剧";
  if (/校园|青春|学生|学校/.test(text)) return "青春校园短剧";
  if (/豪门|总裁|公司|职场|商业|婚恋|离婚|复仇/.test(text)) return "都市情感短剧";
  if (/医院|医生|护士|急救|手术/.test(text)) return "医疗情感短剧";
  return "现实主义短剧";
}

function detectLocationBackground(text: string, structured: StructuredScript) {
  const sceneTitles = structured.scenes
    .map((scene) => cleanMetaText(scene.title, 32))
    .filter((title) => title && !/^Full script$/i.test(title));
  const uniqueTitles = [...new Set(sceneTitles)].slice(0, 6);
  if (uniqueTitles.length) return uniqueTitles.join("、");
  const candidates = ["医院", "公司", "学校", "别墅", "办公室", "客厅", "街道", "酒店", "警局", "避难所", "基地", "宫殿"]
    .filter((item) => text.includes(item));
  return [...new Set(candidates)].slice(0, 6).join("、") || "主要场景待人工确认";
}

function buildLocalStoryAnalysis(text: string): StoryAssetAnalysis {
  const structured = structureScriptText(text);
  const time = detectStoryEra(text);
  const genre = detectStoryGenre(text);
  const locationBackground = detectLocationBackground(text, structured);
  const background = [
    genre,
    locationBackground ? `主要空间：${locationBackground}` : "",
    `剧本结构：${structured.summary.episodeCount} 集/段、${structured.summary.sceneCount} 场`,
  ].filter(Boolean).join("；");
  const visualStyleBase = [
    time,
    genre,
    "真人实拍短剧写实风格",
    "服装、建筑、道具、色彩、光线必须服从同一时代和世界观",
  ].join("；");
  return {
    storyMeta: {
      time,
      background,
      visualStyleBase,
      genre,
      locationBackground,
    },
  };
}

function validateStoryBible(storyAnalysis: StoryAssetAnalysis | null): IntakeIssue[] {
  const meta = storyAnalysis?.storyMeta || {};
  const required: Array<[keyof StoryMetaAnalysis, string]> = [
    ["time", "故事时间/年代"],
    ["background", "世界观/社会背景"],
    ["visualStyleBase", "统一视觉风格"],
    ["genre", "题材类型"],
    ["locationBackground", "主要地域/空间背景"],
  ];
  return required
    .filter(([key]) => !cleanMetaText(meta[key]))
    .map(([, label]) => ({
      stage: "story_visual_bible",
      severity: "high" as const,
      category: "story_bible_required",
      message: `锁稿前必须确认${label}。`,
      suggestion: `请在故事设定中补全${label}，再确认剧本。`,
      text: "",
    }));
}

function hasApprovedStoryBible(value: unknown) {
  return validateStoryBible(normalizeStoryAnalysis(value)).length === 0;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
}

async function addJobLog(
  job: Pick<IntakeJob, "id" | "projectId">,
  stage: string,
  level: "info" | "warn" | "error",
  message: string,
  meta?: unknown,
) {
  await db.insert(intakeJobLogs).values({
    id: genId(),
    jobId: job.id,
    projectId: job.projectId,
    stage,
    level,
    message,
    metaJson: meta ?? {},
    createdAt: now(),
  });
}

async function updateJob(
  jobId: string,
  patch: Partial<typeof intakeJobs.$inferInsert>,
) {
  await db
    .update(intakeJobs)
    .set({ ...patch, updatedAt: now() })
    .where(eq(intakeJobs.id, jobId));
}

async function updateStage(
  stageId: string,
  status: IntakeStage["status"],
  patch: Partial<typeof intakeJobStages.$inferInsert> = {},
) {
  await db
    .update(intakeJobStages)
    .set({
      ...patch,
      status,
      updatedAt: now(),
      ...(status === "running" && { startedAt: now() }),
      ...((status === "completed" || status === "failed" || status === "skipped") && { finishedAt: now() }),
    })
    .where(eq(intakeJobStages.id, stageId));
}

async function loadJob(jobId: string) {
  const [job] = await db.select().from(intakeJobs).where(eq(intakeJobs.id, jobId));
  return job ?? null;
}

async function loadStage(jobId: string, stage: IntakeStageName) {
  const [row] = await db
    .select()
    .from(intakeJobStages)
    .where(and(eq(intakeJobStages.jobId, jobId), eq(intakeJobStages.stage, stage)));
  return row ?? null;
}

class StaleStageRunError extends Error {
  constructor(stageName: IntakeStageName) {
    super(`Stale stage run ignored: ${stageName}`);
    this.name = "StaleStageRunError";
  }
}

function getStageRunId(stage: IntakeStage | null) {
  const logs = toRecord(stage?.logsJson);
  const runId = logs.runId;
  return typeof runId === "string" ? runId : "";
}

async function isCurrentStageRun(jobId: string, stageName: IntakeStageName, runId: string) {
  const [job, stage] = await Promise.all([loadJob(jobId), loadStage(jobId, stageName)]);
  return (
    Boolean(runId) &&
    job?.status === "running" &&
    job.currentStage === stageName &&
    stage?.status === "running" &&
    getStageRunId(stage) === runId
  );
}

async function updateStageRunProgress(jobId: string, stageName: IntakeStageName, runId: string, progress: number) {
  const current = await isCurrentStageRun(jobId, stageName, runId);
  if (!current) return false;
  await updateJob(jobId, { progress });
  return true;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function loadStageResult<T extends StageResult = StageResult>(
  jobId: string,
  stage: IntakeStageName,
) {
  const row = await loadStage(jobId, stage);
  return toRecord(row?.resultJson) as T;
}

async function getLatestCandidateText(jobId: string) {
  const priority: Array<{ stage: IntakeStageName; key: string }> = [
    { stage: "text_compliance_review", key: "candidateText" },
    { stage: "script_visual_enrichment", key: "candidateText" },
    { stage: "document_cleaner", key: "candidateText" },
    { stage: "parse_script_body", key: "candidateText" },
    { stage: "parse_sections", key: "candidateText" },
    { stage: "clean_text", key: "cleanedText" },
    { stage: "extract_raw_text", key: "rawText" },
  ];

  for (const item of priority) {
    const result = await loadStageResult(jobId, item.stage);
    const value = result[item.key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

async function getStoryAnalysisForJob(jobId: string) {
  const storyBible = await loadStageResult<{ storyAnalysis?: StoryAssetAnalysis }>(jobId, "story_visual_bible");
  return normalizeStoryAnalysis(storyBible.storyAnalysis);
}

function summarizeStructure(structured: StructuredScript) {
  return {
    summary: structured.summary,
    episodes: structured.episodes.map((episode) => ({
      id: episode.id,
      episodeIndex: episode.episodeIndex,
      sequence: episode.sequence,
      title: episode.title,
      startIndex: episode.startIndex,
      endIndex: episode.endIndex,
      sceneIndexes: episode.sceneIndexes,
      sceneCount: episode.sceneCount,
      chunkCount: episode.chunkCount,
    })),
    scenes: structured.scenes.map((scene) => ({
      id: scene.id,
      episodeIndex: scene.episodeIndex,
      sceneIndex: scene.sceneIndex,
      sequence: scene.sequence,
      title: scene.title,
      startIndex: scene.startIndex,
      endIndex: scene.endIndex,
      chunkCount: scene.chunkCount,
    })),
    chunks: structured.chunks.map((chunk) => ({
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      episodeIndex: chunk.episodeIndex,
      sceneIndex: chunk.sceneIndex,
      startIndex: chunk.startIndex,
      endIndex: chunk.endIndex,
      metadata: chunk.metadata,
    })),
  };
}

async function persistScriptText(params: {
  job: IntakeJob;
  scriptId?: string | null;
  title: string;
  sourceFilename: string;
  sourceType: string;
  rawText: string;
  text: string;
  status?: "uploaded" | "cleaning" | "chunked" | "parsed" | "failed";
}) {
  ensureStoryPipelineTables();
  const structured = structureScriptText(params.text);
  const scriptId = params.scriptId || genId();
  const structuredJson = buildStructuredScriptJson(structured, params.text);
  const metadata = summarizeStructure(structured);
  const metadataWithStructuredSummary = {
    ...metadata,
    structuredScriptJson: {
      schemaVersion: structuredJson.schemaVersion,
      summary: structuredJson.summary,
      statistics: structuredJson.statistics,
    },
  };
  const existing = params.scriptId
    ? await db.select({ id: scripts.id }).from(scripts).where(eq(scripts.id, params.scriptId)).limit(1)
    : [];

  if (existing.length > 0) {
    await db.delete(scriptChunks).where(eq(scriptChunks.scriptId, scriptId));
    await db
      .update(scripts)
      .set({
        title: params.title,
        sourceFilename: params.sourceFilename,
        sourceType: params.sourceType,
        language: structured.summary.language,
        contentHash: hashText(params.text),
        rawText: params.rawText,
        cleanedText: params.text,
        structuredJson,
        status: params.status ?? "chunked",
        metadata: metadataWithStructuredSummary,
        updatedAt: now(),
      })
      .where(eq(scripts.id, scriptId));
  } else {
    await db.insert(scripts).values({
      id: scriptId,
      projectId: params.job.projectId,
      title: params.title,
      sourceFilename: params.sourceFilename,
      sourceType: params.sourceType,
      language: structured.summary.language,
      contentHash: hashText(params.text),
      rawText: params.rawText,
      cleanedText: params.text,
      structuredJson,
      status: params.status ?? "chunked",
      metadata: metadataWithStructuredSummary,
      createdAt: now(),
      updatedAt: now(),
    });
  }

  if (structured.chunks.length > 0) {
    await db.insert(scriptChunks).values(
      structured.chunks.map((chunk) => ({
        id: genId(),
        scriptId,
        projectId: params.job.projectId,
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
        },
        createdAt: now(),
        updatedAt: now(),
      })),
    );
  }

  await db
    .update(projects)
    .set({ script: params.text, updatedAt: now() })
    .where(eq(projects.id, params.job.projectId));

  await updateJob(params.job.id, { scriptId });
  return { scriptId, structured, structuredJson, metadata: metadataWithStructuredSummary };
}

async function loadCurrentScript(job: IntakeJob) {
  const latestJob = await loadJob(job.id);
  const scriptId = latestJob?.scriptId || job.scriptId;
  if (!scriptId) return null;
  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.projectId, job.projectId)));
  return script ?? null;
}

async function ensureStructuredJsonForJob(job: IntakeJob): Promise<StructuredScriptJson> {
  const script = await loadCurrentScript(job);
  if (!script) throw new Error("Script body must be parsed before structured JSON generation");
  if (script.structuredJson && typeof script.structuredJson === "object") {
    return script.structuredJson as StructuredScriptJson;
  }

  const text = String(script.cleanedText || script.rawText || await getLatestCandidateText(job.id));
  const structured = structureScriptText(text);
  const structuredJson = buildStructuredScriptJson(structured, text);
  const metadata = script.metadata && typeof script.metadata === "object"
    ? script.metadata as Record<string, unknown>
    : {};
  await db
    .update(scripts)
    .set({
      structuredJson,
      metadata: {
        ...metadata,
        structuredScriptJson: {
          schemaVersion: structuredJson.schemaVersion,
          summary: structuredJson.summary,
          statistics: structuredJson.statistics,
        },
      },
      updatedAt: now(),
    })
    .where(eq(scripts.id, script.id));
  return structuredJson;
}

function compactStructuredJsonStats(structuredJson: StructuredScriptJson) {
  return {
    schemaVersion: structuredJson.schemaVersion,
    episodeCount: structuredJson.episodes.length,
    sceneCount: structuredJson.scenes.length,
    chunkCount: structuredJson.chunks.length,
    unitCount: structuredJson.units.length,
    unitCounts: structuredJson.statistics.unitCounts,
    topSpeakers: structuredJson.statistics.speakerCounts.slice(0, 20),
    topEmotions: structuredJson.statistics.emotionCounts.slice(0, 20),
  };
}

function localDocumentCleaner(text: string) {
  const lines = cleanScriptText(text)
    .split("\n")
    .filter((line) => !/^\s*(?:page\s*)?\d+\s*(?:\/\s*\d+)?\s*$/i.test(line.trim()))
    .filter((line) => !/^\s*[-_=]{4,}\s*$/.test(line.trim()));
  return cleanScriptText(lines.join("\n"));
}

function findScriptBodyStart(text: string) {
  const lines = text.split("\n");
  const sceneMarkerPattern = /[\u3010\[]\s*\u573a\u666f\s*[0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e]+/;
  const episodeHeadingPattern = /^\s*\u7b2c\s*(?:[0-9]{1,4}|[\u96f6\u3007\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343]+)\s*[\u96c6\u8bdd\u56de]\s*[：:].*/;
  const bodySectionPattern = /(?:\u5206\u96c6\u5267\u672c|\u5267\u672c\u6b63\u6587|\u6b63\u6587\u5267\u672c|\u62cd\u6444\u811a\u672c|\u5b8c\u6574\u5267\u672c|\u5206\u573a\u5267\u672c)/;
  const nonBodySectionPattern = /(?:\u5206\u96c6\u5927\u7eb2|\u4f5c\u54c1\u7b80\u4ecb|\u4eba\u7269\u5c0f\u4f20|\u6838\u5fc3\u8bbe\u5b9a|\u9898\u6750\u6807\u7b7e)/;

  let offset = 0;
  let lastBodySectionOffset = -1;
  let sawNonBodySection = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    if (nonBodySectionPattern.test(line)) sawNonBodySection = true;
    if (bodySectionPattern.test(line)) lastBodySectionOffset = offset + line.length + 1;

    if (episodeHeadingPattern.test(line)) {
      const nextBlock = lines.slice(index, Math.min(lines.length, index + 8)).join("\n");
      const startsAfterBodySection = lastBodySectionOffset >= 0 && offset >= lastBodySectionOffset;
      if (sceneMarkerPattern.test(nextBlock) && (startsAfterBodySection || sawNonBodySection || offset > 500)) {
        return {
          startIndex: offset,
          reason: startsAfterBodySection ? "body_section_marker" : "first_episode_with_scenes",
        };
      }
    }

    offset += line.length + 1;
  }

  return { startIndex: 0, reason: "full_text" };
}

function extractScriptBodyText(text: string) {
  const cleanedText = cleanScriptText(text);
  const bodyStart = findScriptBodyStart(cleanedText);
  const bodyText = bodyStart.startIndex > 0
    ? cleanScriptText(cleanedText.slice(bodyStart.startIndex))
    : cleanedText;

  return {
    bodyText,
    changed: bodyText !== cleanedText,
    sourceCharCount: cleanedText.length,
    bodyCharCount: bodyText.length,
    removedPreambleChars: Math.max(0, cleanedText.length - bodyText.length),
    startIndex: bodyStart.startIndex,
    reason: bodyStart.reason,
  };
}

function localComplianceIssues(text: string, stage: string): IntakeIssue[] {
  const rules = [
    { term: "国徽", suggestion: "虚构徽记", category: "state_symbol", severity: "high" as const },
    { term: "国旗", suggestion: "虚构旗帜", category: "state_symbol", severity: "high" as const },
    { term: "军徽", suggestion: "虚构单位标识", category: "state_symbol", severity: "high" as const },
    { term: "警徽", suggestion: "虚构单位标识", category: "law_enforcement", severity: "high" as const },
    { term: "血腥", suggestion: "受伤痕迹", category: "violence", severity: "medium" as const },
    { term: "肢解", suggestion: "严重受伤", category: "violence", severity: "high" as const },
    { term: "下药", suggestion: "暗中陷害", category: "crime_method", severity: "high" as const },
  ];

  return rules
    .filter((rule) => text.includes(rule.term))
    .map((rule) => ({
      stage,
      severity: rule.severity,
      category: rule.category,
      message: `Sensitive term found: ${rule.term}`,
      text: rule.term,
      suggestion: rule.suggestion,
    }));
}

async function callJsonModel(params: {
  configs: ProviderConfig[];
  system: string;
  prompt: string;
  maxOutputTokens?: number;
}) {
  const errors: string[] = [];
  for (const config of params.configs) {
    try {
      const result = await withTimeout(
        generateText({
          model: createLanguageModel(config),
          system: params.system,
          prompt: params.prompt,
          providerOptions: supportsOpenAIJsonMode(config)
            ? { openai: { response_format: { type: "json_object" as const } } }
            : undefined,
          temperature: 0.1,
          maxRetries: 0,
          maxOutputTokens: params.maxOutputTokens ?? 3000,
          timeout: SCRIPT_INTAKE_AI_TIMEOUT_MS,
        }),
        SCRIPT_INTAKE_AI_TIMEOUT_MS,
        "AI JSON call",
      );
      return JSON.parse(extractJSON(result.text)) as unknown;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors.at(-1) || "AI JSON call failed");
}

async function aiStructureReview(
  text: string,
  options: IntakeOptions,
  onChunkStart?: (chunkIndex: number, totalChunks: number) => Promise<void>,
) {
  const configs = getAiConfigs(options);
  if (configs.length === 0) {
    return {
      skipped: true,
      issues: [] as IntakeIssue[],
      message: "No text model configured",
      concurrency: 0,
      keyCount: 0,
      perKeyConcurrency: SCRIPT_INTAKE_AI_PER_KEY_CONCURRENCY,
      maxConcurrency: SCRIPT_INTAKE_MAX_AI_CONCURRENCY,
    };
  }

  const chunks = chunkText(text, 5000);
  const { concurrency, keyCount, perKeyConcurrency, maxConcurrency } = getAiConcurrencyMeta(configs, chunks.length);
  const chunkIssues = await mapConcurrent(chunks, concurrency, async (chunk, index) => {
    await onChunkStart?.(index + 1, chunks.length);
    let parsed: unknown;
    try {
      parsed = await callJsonModel({
        configs: selectChunkConfigs(configs, index),
        system: [
          "You are a script intake structure reviewer.",
          "Review only the supplied episode/scene chunk.",
          "Return strict JSON: {\"issues\":[{\"severity\":\"low|medium|high\",\"category\":\"structure|continuity|format\",\"message\":\"\",\"text\":\"exact source quote when possible\",\"suggestion\":\"\",\"lineNumber\":0,\"sceneTitle\":\"\"}]}",
          "Every issue should include the shortest exact source quote in text so production can locate it before lock.",
          "Do not rewrite the script in this stage.",
        ].join("\n"),
        prompt: `Chunk ${index + 1}/${chunks.length}:\n${chunk}`,
        maxOutputTokens: 2400,
      });
    } catch (error) {
      return [{
        stage: "ai_structure_review",
        severity: "medium",
        category: "ai_review",
        message: `AI structure review chunk ${index + 1}/${chunks.length} failed: ${error instanceof Error ? error.message : String(error)}`,
        suggestion: "Review this chunk manually during human review.",
      }] satisfies IntakeIssue[];
    }
    const rawIssues = Array.isArray(toRecord(parsed).issues) ? toRecord(parsed).issues as unknown[] : [];
    const issues: IntakeIssue[] = [];
    for (const item of rawIssues) {
      const record = toRecord(item);
      issues.push({
        stage: "ai_structure_review",
        severity: record.severity === "high" || record.severity === "medium" ? record.severity : "low",
        category: String(record.category || "structure"),
        message: String(record.message || "Structure issue"),
        text: String(record.text || ""),
        suggestion: String(record.suggestion || ""),
        lineNumber: Number.isFinite(Number(record.lineNumber)) ? Number(record.lineNumber) : undefined,
        sceneTitle: String(record.sceneTitle || ""),
      });
    }
    return issues;
  });

  return {
    skipped: false,
    issues: chunkIssues.flat(),
    message: `Reviewed ${chunks.length} chunks with concurrency ${concurrency} across ${keyCount} key(s)`,
    concurrency,
    keyCount,
    perKeyConcurrency,
    maxConcurrency,
  };
}

async function aiComplianceRewrite(
  text: string,
  options: IntakeOptions,
  onChunkStart?: (chunkIndex: number, totalChunks: number) => Promise<void>,
) {
  const configs = getAiConfigs(options);
  if (configs.length === 0 || options.allowAiOverwrite === false) {
    return {
      skipped: true,
      text,
      issues: [] as IntakeIssue[],
      rewrittenChunks: 0,
      chunkCount: 0,
      concurrency: 0,
      keyCount: configs.length,
      perKeyConcurrency: SCRIPT_INTAKE_AI_PER_KEY_CONCURRENCY,
      maxConcurrency: SCRIPT_INTAKE_MAX_AI_CONCURRENCY,
    };
  }

  const chunks = chunkText(text, 4500);
  const { concurrency, keyCount, perKeyConcurrency, maxConcurrency } = getAiConcurrencyMeta(configs, chunks.length);
  const chunkResults = await mapConcurrent(chunks, concurrency, async (chunk, index) => {
    await onChunkStart?.(index + 1, chunks.length);
    let parsed: unknown;
    try {
      parsed = await callJsonModel({
        configs: selectChunkConfigs(configs, index),
        system: [
          "You are a short-drama text compliance editor.",
          "Rewrite only risky wording. Preserve plot, characters, dialogue intent, ordering, and paragraph structure as much as possible.",
          "The rewritten_text is allowed to replace the body text for this chunk.",
          "Return strict JSON: {\"rewritten_text\":\"\",\"issues\":[{\"severity\":\"low|medium|high\",\"category\":\"\",\"message\":\"\",\"text\":\"\",\"suggestion\":\"\"}]}",
        ].join("\n"),
        prompt: `Chunk ${index + 1}/${chunks.length}:\n${chunk}`,
        maxOutputTokens: Math.min(8000, Math.max(3000, chunk.length + 1000)),
      });
    } catch (error) {
      return {
        text: chunk,
        changed: false,
        issues: [{
          stage: "text_compliance_review",
          severity: "medium",
          category: "ai_rewrite_failed",
          message: `AI compliance rewrite chunk ${index + 1}/${chunks.length} failed: ${error instanceof Error ? error.message : String(error)}`,
          suggestion: "Review this chunk manually during human review.",
        }] satisfies IntakeIssue[],
      };
    }
    const record = toRecord(parsed);
    const rewrittenText = String(record.rewritten_text || record.rewrittenText || chunk).trim();
    const issues: IntakeIssue[] = [];

    const rawIssues = Array.isArray(record.issues) ? record.issues as unknown[] : [];
    for (const item of rawIssues) {
      const issue = toRecord(item);
      issues.push({
        stage: "text_compliance_review",
        severity: issue.severity === "high" || issue.severity === "medium" ? issue.severity : "low",
        category: String(issue.category || "compliance"),
        message: String(issue.message || "Compliance edit"),
        text: String(issue.text || ""),
        suggestion: String(issue.suggestion || ""),
      });
    }
    return {
      text: rewrittenText || chunk,
      changed: Boolean(rewrittenText && compact(rewrittenText) !== compact(chunk)),
      issues,
    };
  });

  return {
    skipped: false,
    text: cleanScriptText(chunkResults.map((result) => result.text).join("\n\n")),
    issues: chunkResults.flatMap((result) => result.issues),
    rewrittenChunks: chunkResults.filter((result) => result.changed).length,
    chunkCount: chunks.length,
    concurrency,
    keyCount,
    perKeyConcurrency,
    maxConcurrency,
  };
}

async function collectIssueSummary(jobId: string) {
  const rows = await db
    .select()
    .from(intakeJobStages)
    .where(eq(intakeJobStages.jobId, jobId))
    .orderBy(asc(intakeJobStages.sequence));
  const issues = rows.flatMap((row) => Array.isArray(row.issuesJson) ? row.issuesJson as IntakeIssue[] : []);
  return {
    total: issues.length,
    high: issues.filter((issue) => issue.severity === "high").length,
    medium: issues.filter((issue) => issue.severity === "medium").length,
    low: issues.filter((issue) => issue.severity === "low").length,
    byStage: rows.map((row) => ({
      stage: row.stage,
      count: Array.isArray(row.issuesJson) ? row.issuesJson.length : 0,
    })),
  };
}

function compactStageResult(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
    if (typeof value === "string" && /text|script|raw|candidate|content/i.test(key) && value.length > 500) {
      compact[key] = {
        omitted: true,
        charCount: value.length,
        preview: value.slice(0, 500),
      };
    } else {
      compact[key] = value;
    }
  }
  return compact;
}

async function runStage(
  job: IntakeJob,
  stageName: IntakeStageName,
  runner: (job: IntakeJob, stage: IntakeStage, context: StageRunContext) => Promise<StageRunnerOutput>,
) {
  const stage = await loadStage(job.id, stageName);
  if (!stage) throw new Error(`Missing intake stage: ${stageName}`);
  if (stage.status === "completed" || stage.status === "skipped") return true;

  const stageDef = INTAKE_STAGES.find((item) => item.stage === stageName);
  const runId = genId();
  const context: StageRunContext = {
    runId,
    isCurrent: () => isCurrentStageRun(job.id, stageName, runId),
    updateProgress: (progress) => updateStageRunProgress(job.id, stageName, runId, progress),
  };
  await updateJob(job.id, {
    status: "running",
    currentStage: stageName,
    progress: stageDef?.progress ?? job.progress,
    startedAt: job.startedAt || now(),
  });
  await updateStage(stage.id, "running", {
    logsJson: {
      runId,
      startedAt: now().toISOString(),
    },
  });
  await addJobLog(job, stageName, "info", `Stage started: ${stageName}`, { runId });

  try {
    const output = await runner(job, stage, context);
    if (!(await context.isCurrent())) {
      throw new StaleStageRunError(stageName);
    }
    const issueSourceText = String(
      output.result?.candidateText
      || output.result?.cleanedText
      || output.result?.rawText
      || await getLatestCandidateText(job.id).catch(() => "")
    );
    const annotatedIssues = annotateIssuesWithScriptContext(output.issues ?? [], issueSourceText);
    await updateStage(stage.id, output.skip ? "skipped" : "completed", {
      resultJson: output.result ?? {},
      issuesJson: annotatedIssues,
      logsJson: {
        runId,
        finishedAt: now().toISOString(),
        entries: output.logs ?? [],
      },
      errorMessage: null,
    });
    await addJobLog(job, stageName, output.skip ? "warn" : "info", `Stage finished: ${stageName}`, {
      runId,
      skipped: Boolean(output.skip),
      issueCount: annotatedIssues.length,
    });
    await updateJob(job.id, { issueSummary: await collectIssueSummary(job.id) });
    return true;
  } catch (error) {
    if (error instanceof StaleStageRunError) {
      await addJobLog(job, stageName, "warn", error.message, { runId });
      return false;
    }
    if (!(await context.isCurrent())) {
      await addJobLog(job, stageName, "warn", `Stale stage failure ignored: ${stageName}`, { runId });
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    await updateStage(stage.id, "failed", { errorMessage: message });
    await updateJob(job.id, {
      status: "failed",
      currentStage: stageName,
      errorMessage: message,
      finishedAt: now(),
    });
    await addJobLog(job, stageName, "error", `Stage failed: ${message}`);
    throw error;
  }
}

async function runUploadDocument(job: IntakeJob) {
  const stat = await fs.stat(job.sourcePath);
  return {
    result: {
      sourceFilename: job.sourceFilename,
      sourceType: job.sourceType,
      sourcePath: job.sourcePath,
      bytes: stat.size,
    },
  };
}

async function runExtractRawText(job: IntakeJob) {
  const options = readOptions(job);
  const buffer = await fs.readFile(job.sourcePath);
  const rawText = options.sourceMode === "text"
    ? buffer.toString("utf-8")
    : await extractTextFromFile(buffer, job.sourceFilename);
  const text = rawText.trim();
  const issues = text.length < 20
    ? [{
        stage: "extract_raw_text",
        severity: "high" as const,
        category: "empty_or_short_text",
        message: "Extracted text is very short.",
        suggestion: "Upload a docx, txt, or markdown source with selectable text.",
      }]
    : [];
  if (!text) throw new Error("Document contains no extractable text");
  return {
    result: { rawText, charCount: rawText.length, hash: hashText(rawText) },
    issues,
  };
}

async function runCleanText(job: IntakeJob) {
  const raw = await loadStageResult<{ rawText?: string }>(job.id, "extract_raw_text");
  const rawText = String(raw.rawText || "");
  const cleanedText = cleanScriptText(rawText);
  return {
    result: {
      cleanedText,
      charCount: cleanedText.length,
      removedChars: Math.max(0, rawText.length - cleanedText.length),
      hash: hashText(cleanedText),
    },
  };
}

async function runDetectDocumentType(job: IntakeJob) {
  const text = await getLatestCandidateText(job.id);
  const structured = structureScriptText(text);
  const hasEpisodeMarkers = structured.summary.episodeMarkers.length > 0;
  const hasSceneMarkers = structured.summary.sceneMarkers.length > 0;
  const hasDialogue = structured.summary.dialogueCharacters.length > 0;
  const documentType = hasEpisodeMarkers
    ? "episodic_script"
    : hasSceneMarkers
      ? "scene_script"
      : hasDialogue
        ? "dialogue_script"
        : "plain_text_script";

  return {
    result: {
      sourceType: job.sourceType,
      documentType,
      language: detectScriptLanguage(text),
      signals: { hasEpisodeMarkers, hasSceneMarkers, hasDialogue },
    },
  };
}

async function runParseSections(job: IntakeJob) {
  const text = await getLatestCandidateText(job.id);
  const extraction = extractScriptBodyText(text);
  const structured = structureScriptText(extraction.bodyText);
  return {
    result: {
      ...summarizeStructure(structured),
      candidateText: structured.cleanedText,
      extraction: {
        changed: extraction.changed,
        sourceCharCount: extraction.sourceCharCount,
        bodyCharCount: extraction.bodyCharCount,
        removedPreambleChars: extraction.removedPreambleChars,
        startIndex: extraction.startIndex,
        reason: extraction.reason,
      },
    },
  };
}

async function runParseScriptBody(job: IntakeJob) {
  const raw = await loadStageResult<{ rawText?: string }>(job.id, "extract_raw_text");
  const parsed = await loadStageResult<{ candidateText?: string; extraction?: Record<string, unknown> }>(job.id, "parse_sections");
  const text = String(parsed.candidateText || (await getLatestCandidateText(job.id)));
  const title = job.sourceFilename.replace(/\.[^.]+$/, "") || "Imported script";
  const persisted = await persistScriptText({
    job,
    scriptId: job.scriptId,
    title,
    sourceFilename: job.sourceFilename,
    sourceType: job.sourceType,
    rawText: String(raw.rawText || text),
    text,
    status: "chunked",
  });
  await addImportLog(job.projectId, 1, "done", `Script intake parsed: ${text.length} chars, ${persisted.structured.chunks.length} chunks`, {
    intakeJobId: job.id,
    scriptId: persisted.scriptId,
    removedPreambleChars: Number(parsed.extraction?.removedPreambleChars || 0),
  });
  return {
    result: {
      scriptId: persisted.scriptId,
      candidateText: text,
      charCount: text.length,
      sourceCharCount: Number(parsed.extraction?.sourceCharCount || text.length),
      removedPreambleChars: Number(parsed.extraction?.removedPreambleChars || 0),
      chunkCount: persisted.structured.chunks.length,
      episodeCount: persisted.structured.episodes.length,
      sceneCount: persisted.structured.scenes.length,
    },
  };
}

async function runDocumentCleaner(job: IntakeJob) {
  const raw = await loadStageResult<{ rawText?: string }>(job.id, "extract_raw_text");
  const currentText = await getLatestCandidateText(job.id);
  const candidateText = localDocumentCleaner(currentText);
  if (candidateText !== currentText) {
    await persistScriptText({
      job: { ...job, scriptId: job.scriptId },
      scriptId: job.scriptId,
      title: job.sourceFilename.replace(/\.[^.]+$/, "") || "Imported script",
      sourceFilename: job.sourceFilename,
      sourceType: job.sourceType,
      rawText: String(raw.rawText || currentText),
      text: candidateText,
      status: "chunked",
    });
  }
  return {
    result: {
      candidateText,
      changed: candidateText !== currentText,
      charCount: candidateText.length,
    },
  };
}

async function runParseDialogueActionEmotion(job: IntakeJob) {
  const structuredJson = await ensureStructuredJsonForJob(job);
  return {
    result: {
      ...compactStructuredJsonStats(structuredJson),
      persisted: true,
      storedIn: "scripts.structured_json",
    },
  };
}

async function runStructuredScriptJson(job: IntakeJob) {
  const structuredJson = await ensureStructuredJsonForJob(job);
  const stats = compactStructuredJsonStats(structuredJson);
  await addJobLog(job, "structured_script_json", "info", "Structured script JSON persisted", stats);
  return {
    result: {
      ...stats,
      persisted: true,
      storedIn: "scripts.structured_json",
    },
  };
}

async function runStoryVisualBible(job: IntakeJob) {
  const text = await getLatestCandidateText(job.id);
  const localAnalysis = buildLocalStoryAnalysis(text);
  const configs = getAiConfigs(readOptions(job));
  let storyAnalysis: StoryAssetAnalysis | null = localAnalysis;
  let source = "local_rules";
  let aiError = "";

  if (configs.length > 0) {
    try {
      const parsed = await callJsonModel({
        configs,
        system: [
          "You are a production bible editor for short-drama, animation, and AI visual asset pipelines.",
          "Extract only stable, non-spoiler story metadata that every later character, scene, prop, and variant prompt must inherit.",
          "Return strict JSON: {\"storyMeta\":{\"time\":\"\",\"background\":\"\",\"visualStyleBase\":\"\",\"genre\":\"\",\"locationBackground\":\"\"}}",
          "If the script is ambiguous, write a concise production-safe assumption and mark it as needing human confirmation.",
        ].join("\n"),
        prompt: `Script for story/visual bible extraction:\n${text.slice(0, 16000)}`,
        maxOutputTokens: 1800,
      });
      storyAnalysis = normalizeStoryAnalysis(parsed) || localAnalysis;
      source = "ai_story_visual_bible";
    } catch (error) {
      aiError = error instanceof Error ? error.message : String(error);
      storyAnalysis = localAnalysis;
      source = "local_rules_after_ai_failure";
    }
  }

  const issues = validateStoryBible(storyAnalysis);
  return {
    result: {
      storyAnalysis,
      source,
      aiError,
      requiredFields: ["time", "background", "visualStyleBase", "genre", "locationBackground"],
    },
    issues,
  };
}

async function runAiStructureReview(job: IntakeJob, _stage: IntakeStage, context: StageRunContext) {
  const text = await getLatestCandidateText(job.id);
  const result = await aiStructureReview(text, readOptions(job), async (chunkIndex, totalChunks) => {
    const progress = 68 + Math.floor(((chunkIndex - 1) / Math.max(totalChunks, 1)) * 9);
    await context.updateProgress(progress);
    await addJobLog(job, "ai_structure_review", "info", `AI structure review chunk ${chunkIndex}/${totalChunks}`);
  });
  return {
    result: {
      skipped: result.skipped,
      issueCount: result.issues.length,
      message: result.message,
      concurrency: result.concurrency,
      keyCount: result.keyCount,
      perKeyConcurrency: result.perKeyConcurrency,
      maxConcurrency: result.maxConcurrency,
    },
    issues: result.issues,
    skip: result.skipped,
  };
}

async function runLightCompliancePrecheck(job: IntakeJob) {
  const text = await getLatestCandidateText(job.id);
  const issues = localComplianceIssues(text, "light_compliance_precheck");
  return {
    result: { issueCount: issues.length },
    issues,
  };
}

async function runScriptVisualEnrichment(job: IntakeJob, _stage: IntakeStage, context: StageRunContext) {
  const options = readOptions(job);
  const configs = getAiConfigs(options);
  if (configs.length === 0 || options.allowAiOverwrite === false) {
    return {
      result: {
        skipped: true,
        reason: configs.length === 0 ? "No text model configured" : "AI overwrite disabled",
        candidateText: await getLatestCandidateText(job.id),
      },
      skip: true,
    };
  }

  const latestJob = await loadJob(job.id);
  const scriptId = latestJob?.scriptId || job.scriptId;
  if (!scriptId) throw new Error("Script body must be parsed before enrichment");

  const rows = await db
    .select()
    .from(scriptChunks)
    .where(eq(scriptChunks.scriptId, scriptId))
    .orderBy(asc(scriptChunks.chunkIndex));
  let completedChunks = 0;
  const { concurrency, keyCount, perKeyConcurrency, maxConcurrency } = getAiConcurrencyMeta(configs, rows.length);
  const chunkResults = await mapConcurrent(rows, concurrency, async (chunk, index) => {
    const metadata = toRecord(chunk.metadata);
    await addJobLog(job, "script_visual_enrichment", "info", `Visual enrichment chunk ${index + 1}/${rows.length}`);
    try {
      const [textConfig] = rotateConfigs(configs, index);
      const result = await generateScriptVisualEnrichmentPreview({
        script: chunk.text,
        scenes: [{
          id: chunk.id,
          episode_id: String(metadata.episodeId || `episode_${chunk.episodeIndex || 1}`),
          title: String(metadata.sceneTitle || metadata.episodeTitle || `Chunk ${chunk.chunkIndex + 1}`),
          text: chunk.text,
          location: String(metadata.sceneTitle || ""),
          description: chunk.text.slice(0, 240),
        }],
        modelConfig: { ...(options.modelConfig || {}), text: textConfig },
        useAI: true,
        fallbackToLocal: false,
        maxBeats: 8,
      });
      const issues: IntakeIssue[] = [];
      for (const warning of result.validation.warnings) {
        issues.push({
          stage: "script_visual_enrichment",
          severity: "low",
          category: "validation_warning",
          message: String(warning || "Validation warning"),
        });
      }
      for (const error of result.validation.errors) {
        issues.push({
          stage: "script_visual_enrichment",
          severity: "medium",
          category: "validation_error",
          message: String(error || "Validation error"),
        });
      }
      completedChunks += 1;
      await context.updateProgress(78 + Math.floor((completedChunks / Math.max(rows.length, 1)) * 5));
      return {
        patches: result.validation.accepted_patches,
        issues,
      };
    } catch (error) {
      completedChunks += 1;
      await context.updateProgress(78 + Math.floor((completedChunks / Math.max(rows.length, 1)) * 5));
      return {
        patches: [] as EnrichmentPatch[],
        issues: [{
          stage: "script_visual_enrichment",
          severity: "medium",
          category: "ai_chunk_failed",
          message: error instanceof Error ? error.message : String(error),
          text: compact(chunk.text, 160),
        }] satisfies IntakeIssue[],
      };
    }
  });

  const acceptedPatches = chunkResults.flatMap((result) => result.patches);
  const issues = chunkResults.flatMap((result) => result.issues);

  const currentText = await getLatestCandidateText(job.id);
  const applied = applyEnrichmentPatchesToText(currentText, acceptedPatches);
  const revision = summarizeTextRevision(currentText, applied.text, "script_visual_enrichment");
  const raw = await loadStageResult<{ rawText?: string }>(job.id, "extract_raw_text");
  if (applied.appliedCount > 0) {
    if (!(await context.isCurrent())) throw new StaleStageRunError("script_visual_enrichment");
    await persistScriptText({
      job: { ...job, scriptId },
      scriptId,
      title: job.sourceFilename.replace(/\.[^.]+$/, "") || "Imported script",
      sourceFilename: job.sourceFilename,
      sourceType: job.sourceType,
      rawText: String(raw.rawText || currentText),
      text: applied.text,
      status: "chunked",
    });
  }

  return {
    result: {
      candidateText: applied.text,
      patchCount: acceptedPatches.length,
      appliedPatchCount: applied.appliedCount,
      skippedPatchCount: applied.skippedCount,
      chunkCount: rows.length,
      concurrency,
      keyCount,
      perKeyConcurrency,
      maxConcurrency,
      revision,
    },
    issues,
  };
}

async function runEnrichmentValidation(job: IntakeJob) {
  const text = await getLatestCandidateText(job.id);
  const enrichment = await loadStageResult<{
    patchCount?: number;
    appliedPatchCount?: number;
    skippedPatchCount?: number;
  }>(job.id, "script_visual_enrichment");
  const issues: IntakeIssue[] = [];
  if (Number(enrichment.skippedPatchCount || 0) > 0) {
    issues.push({
      stage: "enrichment_validation",
      severity: "low",
      category: "patch_not_applied",
      message: `${enrichment.skippedPatchCount} enrichment patches could not be located in the current body text.`,
    });
  }
  return {
    result: {
      candidateText: text,
      charCount: text.length,
      patchCount: enrichment.patchCount || 0,
      appliedPatchCount: enrichment.appliedPatchCount || 0,
      skippedPatchCount: enrichment.skippedPatchCount || 0,
    },
    issues,
  };
}

async function runTextComplianceReview(job: IntakeJob, _stage: IntakeStage, context: StageRunContext) {
  const currentText = await getLatestCandidateText(job.id);
  const localIssues = localComplianceIssues(currentText, "text_compliance_review");
  const rewrite = await aiComplianceRewrite(currentText, readOptions(job), async (chunkIndex, totalChunks) => {
    const progress = 90 + Math.floor(((chunkIndex - 1) / Math.max(totalChunks, 1)) * 4);
    await context.updateProgress(progress);
    await addJobLog(job, "text_compliance_review", "info", `Text compliance review chunk ${chunkIndex}/${totalChunks}`);
  });
  const raw = await loadStageResult<{ rawText?: string }>(job.id, "extract_raw_text");
  const latestJob = await loadJob(job.id);
  const scriptId = latestJob?.scriptId || job.scriptId;

  if (!rewrite.skipped && rewrite.text !== currentText && scriptId) {
    if (!(await context.isCurrent())) throw new StaleStageRunError("text_compliance_review");
    await persistScriptText({
      job: { ...job, scriptId },
      scriptId,
      title: job.sourceFilename.replace(/\.[^.]+$/, "") || "Imported script",
      sourceFilename: job.sourceFilename,
      sourceType: job.sourceType,
      rawText: String(raw.rawText || currentText),
      text: rewrite.text,
      status: "chunked",
    });
  }
  const revision = summarizeTextRevision(currentText, rewrite.text, "text_compliance_review");

  return {
    result: {
      candidateText: rewrite.text,
      aiRewriteSkipped: rewrite.skipped,
      rewrittenChunks: rewrite.rewrittenChunks,
      chunkCount: rewrite.chunkCount,
      concurrency: rewrite.concurrency,
      keyCount: rewrite.keyCount,
      perKeyConcurrency: rewrite.perKeyConcurrency,
      maxConcurrency: rewrite.maxConcurrency,
      localIssueCount: localIssues.length,
      aiIssueCount: rewrite.issues.length,
      revision,
    },
    issues: [...localIssues, ...rewrite.issues],
    skip: rewrite.skipped && localIssues.length === 0,
  };
}

async function markAwaitingHumanReview(jobId: string) {
  const job = await loadJob(jobId);
  if (!job) throw new Error(`Intake job not found: ${jobId}`);
  const stage = await loadStage(jobId, "human_review");
  const candidateText = await getLatestCandidateText(jobId);
  const issueSummary = await collectIssueSummary(jobId);
  if (stage) {
    await updateStage(stage.id, "running", {
      resultJson: {
        awaitingReview: true,
        candidateText,
        issueSummary,
      },
      issuesJson: [],
    });
  }
  await updateJob(jobId, {
    status: "awaiting_review",
    currentStage: "human_review",
    progress: 94,
    issueSummary,
  });
  await addJobLog(job, "human_review", "info", "Intake job is waiting for human review");
}

function unresolvedHighReviewIssues(reviewNotes: unknown) {
  const notes = toRecord(reviewNotes);
  const issues = Array.isArray(notes.reviewIssues) ? notes.reviewIssues : [];
  return issues
    .map((item) => toRecord(item))
    .filter((issue) =>
      issue.severity === "high"
      && issue.applied !== true
      && issue.waived !== true
      && issue.resolved !== true
    );
}

export async function startScriptIntakeJob(input: StartScriptIntakeJobInput) {
  ensureScriptIntakeTables();
  const jobId = genId();
  const sourceFilename = sanitizeFilename(input.sourceFilename || "script.txt");
  const sourceType = input.sourceType || sourceTypeFromFilename(sourceFilename);
  const sourceMode: "file" | "text" = input.sourceBuffer ? "file" : "text";
  const storageDir = path.join(process.cwd(), "uploads", "intake", input.projectId, jobId);
  await fs.mkdir(storageDir, { recursive: true });
  const sourcePath = path.join(storageDir, sourceFilename);
  const sourceBytes = input.sourceBuffer ?? Buffer.from(input.sourceText || "", "utf-8");
  await fs.writeFile(sourcePath, sourceBytes);

  const options: IntakeOptions = {
    sourceMode,
    modelConfig: input.modelConfig ?? null,
    allowAiOverwrite: input.allowAiOverwrite !== false,
  };
  await db.insert(intakeJobs).values({
    id: jobId,
    projectId: input.projectId,
    sourceFilename,
    sourceType,
    sourcePath,
    status: "queued",
    currentStage: "upload_document",
    progress: 0,
    options,
    createdAt: now(),
    updatedAt: now(),
  });
  await db.insert(intakeJobStages).values(
    INTAKE_STAGES.map((stage) => ({
      id: genId(),
      jobId,
      projectId: input.projectId,
      stage: stage.stage,
      sequence: stage.sequence,
      status: "pending" as const,
      createdAt: now(),
      updatedAt: now(),
    })),
  );
  await addJobLog({ id: jobId, projectId: input.projectId }, "upload_document", "info", "Intake job created", {
    sourceFilename,
    sourceType,
    sourceMode,
  });
  await enqueueTask({
    type: "script_intake",
    projectId: input.projectId,
    payload: { jobId },
    maxRetries: 1,
  });

  return { jobId, status: "queued" as const };
}

async function ensureIntakeStagesForJob(job: IntakeJob) {
  const existing = await db
    .select({ stage: intakeJobStages.stage })
    .from(intakeJobStages)
    .where(eq(intakeJobStages.jobId, job.id));
  const existingStages = new Set(existing.map((row) => row.stage));
  const missing = INTAKE_STAGES.filter((stage) => !existingStages.has(stage.stage));
  if (missing.length === 0) return;

  await db.insert(intakeJobStages).values(
    missing.map((stage) => ({
      id: genId(),
      jobId: job.id,
      projectId: job.projectId,
      stage: stage.stage,
      sequence: stage.sequence,
      status: "pending" as const,
      createdAt: now(),
      updatedAt: now(),
    })),
  );
}

export async function ensureScriptIntakeJobQueued(projectId: string, jobId: string) {
  ensureScriptIntakeTables();
  const [job] = await db
    .select()
    .from(intakeJobs)
    .where(and(eq(intakeJobs.id, jobId), eq(intakeJobs.projectId, projectId)));
  if (!job) return false;
  if (job.status !== "queued" && job.status !== "running") return true;

  const [activeTask] = await db
    .select({ id: tasks.id, status: tasks.status, retries: tasks.retries })
    .from(tasks)
    .where(and(
      eq(tasks.type, "script_intake"),
      inArray(tasks.status, ["pending", "running"]),
      sql`json_extract(${tasks.payload}, '$.jobId') = ${jobId}`,
    ))
    .limit(1);
  if (activeTask) {
    const heartbeatMs = timeMs(job.updatedAt || job.startedAt || job.createdAt);
    const stale = activeTask.status === "running" && heartbeatMs > 0 && Date.now() - heartbeatMs > SCRIPT_INTAKE_STALE_RUNNING_MS;
    if (!stale) return true;

    await db
      .update(tasks)
      .set({
        status: "failed",
        retries: (activeTask.retries ?? 0) + 1,
        error: `Stale script_intake task recovered after ${Math.round((Date.now() - heartbeatMs) / 1000)}s without progress`,
      })
      .where(eq(tasks.id, activeTask.id));
    await addJobLog(job, job.currentStage || "upload_document", "warn", "Stale script intake task was marked failed before re-queue", {
      taskId: activeTask.id,
    });
  }

  await enqueueTask({
    type: "script_intake",
    projectId,
    payload: { jobId },
    maxRetries: 1,
  });
  await addJobLog(job, job.currentStage || "upload_document", "warn", "Script intake task was re-queued after worker recovery");
  return true;
}

export async function runScriptIntakeJob(jobId: string) {
  ensureScriptIntakeTables();
  const job = await loadJob(jobId);
  if (!job) throw new Error(`Intake job not found: ${jobId}`);
  await ensureIntakeStagesForJob(job);
  if (job.status === "confirmed" || job.status === "cancelled") return { status: job.status };
  if (job.status === "awaiting_review") return { status: job.status };

  await updateJob(jobId, {
    status: "running",
    startedAt: job.startedAt || now(),
    errorMessage: null,
  });

  const stageRunners: Partial<Record<
    IntakeStageName,
    (job: IntakeJob, stage: IntakeStage, context: StageRunContext) => Promise<StageRunnerOutput>
  >> = {
    upload_document: runUploadDocument,
    extract_raw_text: runExtractRawText,
    clean_text: runCleanText,
    detect_document_type: runDetectDocumentType,
    parse_sections: runParseSections,
    parse_script_body: runParseScriptBody,
    document_cleaner: runDocumentCleaner,
    parse_dialogue_action_emotion: runParseDialogueActionEmotion,
    structured_script_json: runStructuredScriptJson,
    story_visual_bible: runStoryVisualBible,
    ai_structure_review: runAiStructureReview,
    light_compliance_precheck: runLightCompliancePrecheck,
    script_visual_enrichment: runScriptVisualEnrichment,
    enrichment_validation: runEnrichmentValidation,
    text_compliance_review: runTextComplianceReview,
  };

  for (const stage of INTAKE_STAGES) {
    if (stage.stage === "human_review") {
      await markAwaitingHumanReview(jobId);
      return { status: "awaiting_review" as const };
    }
    if (stage.stage === "confirmed_script_version") break;

    const currentJob = await loadJob(jobId);
    if (!currentJob) throw new Error(`Intake job not found: ${jobId}`);
    const runner = stageRunners[stage.stage];
    if (!runner) continue;
    const isCurrentRun = await runStage(currentJob, stage.stage, runner);
    if (!isCurrentRun) return { status: "stale_stage_run_ignored" as const };
  }

  await markAwaitingHumanReview(jobId);
  return { status: "awaiting_review" as const };
}

export async function getScriptIntakeJobStatus(projectId: string, jobId: string) {
  ensureScriptIntakeTables();
  const [job] = await db
    .select()
    .from(intakeJobs)
    .where(and(eq(intakeJobs.id, jobId), eq(intakeJobs.projectId, projectId)));
  if (!job) return null;
  await ensureIntakeStagesForJob(job);

  const stages = await db
    .select()
    .from(intakeJobStages)
    .where(eq(intakeJobStages.jobId, jobId))
    .orderBy(asc(intakeJobStages.sequence));
  const logs = await db
    .select()
    .from(intakeJobLogs)
    .where(eq(intakeJobLogs.jobId, jobId))
    .orderBy(desc(intakeJobLogs.createdAt))
    .limit(40);
  const candidateText = job.status === "queued" || job.status === "failed" || job.status === "cancelled"
    ? ""
    : await getLatestCandidateText(jobId);
  const storyAnalysis = await getStoryAnalysisForJob(jobId);

  return {
    job_id: job.id,
    project_id: job.projectId,
    script_id: job.scriptId,
    status: job.status,
    current_stage: job.currentStage,
    progress: job.progress,
    issue_summary: job.issueSummary,
    error_message: job.errorMessage || "",
    confirmed_script_version_id: job.confirmedScriptVersionId || "",
    candidate_text: candidateText,
    story_analysis: storyAnalysis,
    stages: stages.map((stage) => ({
      id: stage.id,
      stage: stage.stage,
      sequence: stage.sequence,
      status: stage.status,
      result: compactStageResult(stage.resultJson),
      issues: stage.issuesJson,
      error_message: stage.errorMessage || "",
      started_at: stage.startedAt,
      finished_at: stage.finishedAt,
    })),
    recent_logs: logs.reverse().map((log) => ({
      id: log.id,
      stage: log.stage,
      level: log.level,
      message: log.message,
      meta: log.metaJson,
      created_at: log.createdAt,
    })),
  };
}

export async function confirmScriptIntakeJob(input: ConfirmScriptIntakeInput) {
  ensureScriptIntakeTables();
  const [job] = await db
    .select()
    .from(intakeJobs)
    .where(and(eq(intakeJobs.id, input.jobId), eq(intakeJobs.projectId, input.projectId)));
  if (!job) throw new Error("Intake job not found");
  if (job.status !== "awaiting_review") {
    throw new Error(`Intake job is not ready for confirmation: ${job.status}`);
  }
  const unresolvedHigh = unresolvedHighReviewIssues(input.reviewNotes);
  if (unresolvedHigh.length > 0) {
    throw new Error(`Cannot confirm script: ${unresolvedHigh.length} high-severity review issue(s) must be applied or waived`);
  }
  const reviewNotes = toRecord(input.reviewNotes);
  if (!hasApprovedStoryBible(reviewNotes.storyAnalysis)) {
    throw new Error("Cannot confirm script: story/visual bible must include time, background, visual style, genre, and location background");
  }

  const candidateText = cleanScriptText(input.content || await getLatestCandidateText(input.jobId));
  if (!candidateText) throw new Error("Confirmed script text is empty");

  const raw = await loadStageResult<{ rawText?: string }>(input.jobId, "extract_raw_text");
  const persisted = await persistScriptText({
    job,
    scriptId: job.scriptId,
    title: job.sourceFilename.replace(/\.[^.]+$/, "") || "Confirmed script",
    sourceFilename: job.sourceFilename,
    sourceType: job.sourceType,
    rawText: String(raw.rawText || candidateText),
    text: candidateText,
    status: "parsed",
  });
  const confirmedStructuredJson = buildStructuredScriptJson(persisted.structured, candidateText);

  const [versionResult] = await db
    .select({ maxVersion: max(confirmedScriptVersions.versionNum) })
    .from(confirmedScriptVersions)
    .where(eq(confirmedScriptVersions.projectId, input.projectId));
  const versionNum = (versionResult?.maxVersion ?? 0) + 1;
  const versionId = genId();
  await db
    .update(confirmedScriptVersions)
    .set({ status: "archived" })
    .where(and(
      eq(confirmedScriptVersions.projectId, input.projectId),
      eq(confirmedScriptVersions.status, "active"),
    ));
  await db.insert(confirmedScriptVersions).values({
    id: versionId,
    projectId: input.projectId,
    scriptId: persisted.scriptId,
    intakeJobId: input.jobId,
    versionNum,
    title: job.sourceFilename.replace(/\.[^.]+$/, "") || `Script v${versionNum}`,
    language: persisted.structured.summary.language,
    contentHash: hashText(candidateText),
    content: candidateText,
    structureJson: {
      ...summarizeStructure(persisted.structured),
      structuredScriptJson: confirmedStructuredJson,
    },
    reviewSummary: {
      issueSummary: await collectIssueSummary(input.jobId),
      reviewNotes: input.reviewNotes ?? null,
    },
    confirmedBy: input.userId,
    status: "active",
    createdAt: now(),
  });

  const humanStage = await loadStage(input.jobId, "human_review");
  if (humanStage) {
    await updateStage(humanStage.id, "completed", {
      resultJson: { confirmed: true, confirmedScriptVersionId: versionId },
      issuesJson: [],
    });
  }
  const confirmedStage = await loadStage(input.jobId, "confirmed_script_version");
  if (confirmedStage) {
    await updateStage(confirmedStage.id, "completed", {
      resultJson: { confirmedScriptVersionId: versionId, versionNum },
      issuesJson: [],
    });
  }
  await updateJob(input.jobId, {
    status: "confirmed",
    currentStage: "confirmed_script_version",
    progress: 100,
    scriptId: persisted.scriptId,
    confirmedScriptVersionId: versionId,
    finishedAt: now(),
  });
  await addJobLog(job, "confirmed_script_version", "info", "Confirmed script version created", {
    confirmedScriptVersionId: versionId,
    versionNum,
  });
  await addImportLog(input.projectId, 1, "done", `Confirmed script version created: v${versionNum}`, {
    intakeJobId: input.jobId,
    confirmedScriptVersionId: versionId,
  });

  return {
    confirmed_script_version_id: versionId,
    version_num: versionNum,
    script_id: persisted.scriptId,
    content_hash: hashText(candidateText),
  };
}
