import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, ensureImportStatesTable, ensureScriptEnrichmentTables } from "@/lib/db";
import {
  agentBindings,
  agents,
  assets as storyAssets,
  importStates,
  projects,
  scriptChunks,
  scriptEnrichmentJobs,
  scriptEnrichmentLogs,
  scriptEnrichmentTasks,
  scripts,
} from "@/lib/db/schema";
import { id as genId } from "@/lib/id";
import { addImportLog } from "@/lib/import-utils";
import { getActiveProductionBible } from "@/lib/production-bible";
import { enqueueTask } from "@/lib/task-queue";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import type { AgentPlatform } from "@/lib/ai/agent-caller";
import {
  applyEnrichmentPatchesToText,
  generateScriptVisualEnrichmentPreview,
  normalizeEnrichmentInput,
  type EnrichmentPatch,
  type NormalizedBeat,
} from "@/lib/script-visual-enrichment";
import { scoreDetailSufficiency } from "./detail-sufficiency-scorer";

const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 5;
const DEFAULT_BEAT_GROUP_SIZE = 3;
const DEFAULT_MAX_BEATS_PER_CHUNK = 10;
const DEFAULT_MAX_RETRIES = 2;

type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface StartScriptEnrichmentJobInput {
  projectId: string;
  sourceText: string;
  modelConfig?: { text?: ProviderConfig | null } | null;
  useAI?: boolean;
  fallbackToLocal?: boolean;
  concurrency?: number;
  beatGroupSize?: number;
  maxBeatsPerChunk?: number;
  maxRetries?: number;
}

interface EnrichmentJobOptions {
  sourceText: string;
  modelConfig?: { text?: ProviderConfig | null } | null;
  useAI?: boolean;
  fallbackToLocal?: boolean;
  concurrency: number;
  beatGroupSize: number;
  maxBeatsPerChunk: number;
  maxRetries: number;
}

interface EnrichmentTaskInput {
  chunkId: string;
  chunkIndex: number;
  episodeIndex: number;
  sceneIndex: number;
  episodeId: string;
  sceneId: string;
  sceneTitle: string;
  sceneText: string;
  beats: NormalizedBeat[];
}

interface EnrichmentTaskResult {
  status: TaskStatus;
  skippedReason?: string;
  skippedBeatIds?: string[];
  acceptedPatches?: EnrichmentPatch[];
  allPatches?: EnrichmentPatch[];
  stats?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  appliedPatchCount?: number;
  skippedPatchCount?: number;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readJobOptions(job: typeof scriptEnrichmentJobs.$inferSelect): EnrichmentJobOptions {
  const options = readRecord(job.options);
  return {
    sourceText: String(options.sourceText || ""),
    modelConfig: options.modelConfig as EnrichmentJobOptions["modelConfig"],
    useAI: options.useAI !== false,
    fallbackToLocal: options.fallbackToLocal === true,
    concurrency: clamp(Number(options.concurrency ?? DEFAULT_CONCURRENCY), 1, MAX_CONCURRENCY),
    beatGroupSize: clamp(Number(options.beatGroupSize ?? DEFAULT_BEAT_GROUP_SIZE), 1, 8),
    maxBeatsPerChunk: clamp(Number(options.maxBeatsPerChunk ?? DEFAULT_MAX_BEATS_PER_CHUNK), 1, 30),
    maxRetries: clamp(Number(options.maxRetries ?? DEFAULT_MAX_RETRIES), 0, 5),
  };
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function chunkArray<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function formatChunkTitle(chunk: typeof scriptChunks.$inferSelect) {
  const metadata = readRecord(chunk.metadata);
  return String(
    metadata.episodeTitle ||
      metadata.sceneTitle ||
      (chunk.episodeIndex ? `Episode ${chunk.episodeIndex}` : "") ||
      `Chunk ${chunk.chunkIndex + 1}`,
  );
}

async function addJobLog(
  projectId: string,
  jobId: string,
  level: "info" | "warn" | "error",
  message: string,
  meta?: unknown,
) {
  ensureScriptEnrichmentTables();
  await db.insert(scriptEnrichmentLogs).values({
    id: genId(),
    projectId,
    jobId,
    level,
    message,
    metaJson: meta ?? {},
  });
}

async function loadLatestScript(projectId: string) {
  const [script] = await db
    .select()
    .from(scripts)
    .where(eq(scripts.projectId, projectId))
    .orderBy(desc(scripts.createdAt));
  return script ?? null;
}

async function loadProjectAssets(projectId: string) {
  return db
    .select({
      id: storyAssets.id,
      type: storyAssets.type,
      name: storyAssets.name,
      aliases: storyAssets.aliases,
      importance: storyAssets.importance,
      description: storyAssets.description,
      visualConstraints: storyAssets.visualConstraints,
    })
    .from(storyAssets)
    .where(eq(storyAssets.projectId, projectId))
    .orderBy(asc(storyAssets.type), asc(storyAssets.name));
}

async function loadBoundEnrichmentAgent(projectId: string) {
  const [binding] = await db
    .select({ agentId: agentBindings.agentId })
    .from(agentBindings)
    .where(and(
      eq(agentBindings.projectId, projectId),
      eq(agentBindings.category, "script_visual_enrichment"),
    ));
  if (!binding?.agentId) return null;

  const [agent] = await db
    .select({
      platform: agents.platform,
      appId: agents.appId,
      apiKey: agents.apiKey,
    })
    .from(agents)
    .where(eq(agents.id, binding.agentId));

  if (!agent) return null;
  return {
    platform: agent.platform as AgentPlatform,
    appId: agent.appId,
    apiKey: agent.apiKey,
  };
}

async function buildTaskInputs(
  scriptId: string,
  options: EnrichmentJobOptions,
): Promise<EnrichmentTaskInput[]> {
  const chunks = await db
    .select()
    .from(scriptChunks)
    .where(eq(scriptChunks.scriptId, scriptId))
    .orderBy(asc(scriptChunks.chunkIndex));

  const taskInputs: EnrichmentTaskInput[] = [];
  for (const chunk of chunks) {
    const sceneId = chunk.id;
    const episodeId = chunk.episodeId || `episode_${chunk.episodeIndex || chunk.chunkIndex + 1}`;
    const sceneTitle = formatChunkTitle(chunk);
    const context = normalizeEnrichmentInput({
      script: chunk.text,
      scenes: [{
        id: sceneId,
        episode_id: episodeId,
        title: sceneTitle,
        text: chunk.text,
        location: sceneTitle,
        description: chunk.text.slice(0, 240),
      }],
      maxBeats: options.maxBeatsPerChunk,
    });

    const beats = context.beats.length
      ? context.beats
      : [{
          id: `${sceneId}_beat_001`,
          scene_id: sceneId,
          episode_id: episodeId,
          text: chunk.text,
          scene_title: sceneTitle,
          scene_text: chunk.text,
        }];

    chunkArray(beats.slice(0, options.maxBeatsPerChunk), options.beatGroupSize)
      .forEach((group) => {
        taskInputs.push({
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          episodeIndex: chunk.episodeIndex || 0,
          sceneIndex: chunk.sceneIndex || 0,
          episodeId,
          sceneId,
          sceneTitle,
          sceneText: chunk.text,
          beats: group,
        });
      });
  }

  return taskInputs;
}

async function refreshJobProgress(jobId: string) {
  const tasks = await db
    .select({ status: scriptEnrichmentTasks.status })
    .from(scriptEnrichmentTasks)
    .where(eq(scriptEnrichmentTasks.jobId, jobId));

  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const skipped = tasks.filter((task) => task.status === "skipped").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const finished = completed + skipped + failed;
  const progress = total > 0 ? Math.round((finished / total) * 100) : 0;

  await db
    .update(scriptEnrichmentJobs)
    .set({
      totalTasks: total,
      completedTasks: completed,
      skippedTasks: skipped,
      failedTasks: failed,
      progress,
      updatedAt: new Date(),
    })
    .where(eq(scriptEnrichmentJobs.id, jobId));

  return { total, completed, skipped, failed, finished, progress };
}

function getAcceptedPatchesFromTask(task: typeof scriptEnrichmentTasks.$inferSelect) {
  const result = readRecord(task.resultJson) as unknown as EnrichmentTaskResult;
  return Array.isArray(result.acceptedPatches) ? result.acceptedPatches : [];
}

async function collectAcceptedPatches(jobId: string) {
  const tasks = await db
    .select()
    .from(scriptEnrichmentTasks)
    .where(eq(scriptEnrichmentTasks.jobId, jobId))
    .orderBy(asc(scriptEnrichmentTasks.sequence));

  return tasks.flatMap(getAcceptedPatchesFromTask);
}

async function rebuildAndPersistEnrichedText(
  job: typeof scriptEnrichmentJobs.$inferSelect,
  options: EnrichmentJobOptions,
) {
  const patches = await collectAcceptedPatches(job.id);
  const baseText = options.sourceText || "";
  const applied = applyEnrichmentPatchesToText(baseText, patches);
  const stepStatus = { 1: "done", 2: "idle", 3: "idle", 4: "idle", 5: "idle" };

  ensureImportStatesTable();
  await db
    .insert(importStates)
    .values({
      projectId: job.projectId,
      currentStep: 2,
      stepStatus,
      fullText: applied.text,
      reviewIssues: [],
      storyAnalysis: null,
      enrichmentJobId: job.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: importStates.projectId,
      set: {
        currentStep: 2,
        stepStatus,
        fullText: applied.text,
        reviewIssues: [],
        storyAnalysis: null,
        enrichmentJobId: job.id,
        updatedAt: new Date(),
      },
    });

  await db
    .update(projects)
    .set({ script: applied.text, updatedAt: new Date() })
    .where(eq(projects.id, job.projectId));

  return {
    text: applied.text,
    patchCount: patches.length,
    appliedPatchCount: applied.appliedCount,
    skippedPatchCount: applied.skippedCount,
  };
}

export async function startScriptEnrichmentJob(input: StartScriptEnrichmentJobInput) {
  ensureScriptEnrichmentTables();
  ensureImportStatesTable();

  const script = await loadLatestScript(input.projectId);
  if (!script) throw new Error("No parsed script found");

  const sourceText = String(input.sourceText || script.cleanedText || script.rawText || "").trim();
  if (!sourceText) throw new Error("Script text is empty");

  const options: EnrichmentJobOptions = {
    sourceText,
    modelConfig: input.modelConfig,
    useAI: input.useAI !== false,
    fallbackToLocal: input.fallbackToLocal === true,
    concurrency: clamp(input.concurrency ?? DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY),
    beatGroupSize: clamp(input.beatGroupSize ?? DEFAULT_BEAT_GROUP_SIZE, 1, 8),
    maxBeatsPerChunk: clamp(input.maxBeatsPerChunk ?? DEFAULT_MAX_BEATS_PER_CHUNK, 1, 30),
    maxRetries: clamp(input.maxRetries ?? DEFAULT_MAX_RETRIES, 0, 5),
  };
  const taskInputs = await buildTaskInputs(script.id, options);
  if (taskInputs.length === 0) throw new Error("No enrichment tasks can be created");

  const jobId = genId();
  const now = new Date();
  await db.insert(scriptEnrichmentJobs).values({
    id: jobId,
    projectId: input.projectId,
    scriptId: script.id,
    status: "queued",
    totalTasks: taskInputs.length,
    baseTextHash: hashText(sourceText),
    options,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(scriptEnrichmentTasks).values(
    taskInputs.map((taskInput, index) => ({
      id: genId(),
      jobId,
      projectId: input.projectId,
      scriptId: script.id,
      chunkId: taskInput.chunkId,
      episodeId: taskInput.episodeId,
      sceneId: taskInput.sceneId,
      beatId: taskInput.beats.map((beat) => beat.id).join(","),
      sequence: index,
      status: "pending" as const,
      inputHash: hashText(JSON.stringify(taskInput)),
      inputJson: taskInput,
      maxRetries: options.maxRetries,
      createdAt: now,
      updatedAt: now,
    })),
  );

  await db
    .insert(importStates)
    .values({
      projectId: input.projectId,
      currentStep: 2,
      stepStatus: { 1: "done", 2: "running", 3: "idle", 4: "idle", 5: "idle" },
      fullText: sourceText,
      reviewIssues: [],
      storyAnalysis: null,
      enrichmentJobId: jobId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: importStates.projectId,
      set: {
        currentStep: 2,
        stepStatus: { 1: "done", 2: "running", 3: "idle", 4: "idle", 5: "idle" },
        fullText: sourceText,
        reviewIssues: [],
        storyAnalysis: null,
        enrichmentJobId: jobId,
        updatedAt: now,
      },
    });

  await addJobLog(input.projectId, jobId, "info", `Created ${taskInputs.length} enrichment tasks`, {
    scriptId: script.id,
    beatGroupSize: options.beatGroupSize,
    maxBeatsPerChunk: options.maxBeatsPerChunk,
  });
  await addImportLog(input.projectId, 2, "running", `AI 细节补全任务已创建：${taskInputs.length} 个小任务`, {
    jobId,
    totalTasks: taskInputs.length,
  });

  await enqueueTask({
    type: "script_visual_enrichment",
    projectId: input.projectId,
    payload: { jobId },
    maxRetries: 1,
  });

  return {
    jobId,
    status: "queued" as const,
    totalTasks: taskInputs.length,
  };
}

async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  patch: Partial<typeof scriptEnrichmentTasks.$inferInsert> = {},
) {
  await db
    .update(scriptEnrichmentTasks)
    .set({
      status,
      ...patch,
      updatedAt: new Date(),
      ...(status === "running" && { startedAt: new Date() }),
      ...((status === "completed" || status === "failed" || status === "skipped") && { finishedAt: new Date() }),
    })
    .where(eq(scriptEnrichmentTasks.id, taskId));
}

async function processEnrichmentTask(
  job: typeof scriptEnrichmentJobs.$inferSelect,
  task: typeof scriptEnrichmentTasks.$inferSelect,
  options: EnrichmentJobOptions,
) {
  const input = task.inputJson as EnrichmentTaskInput | null;
  if (!input?.beats?.length) {
    await updateTaskStatus(task.id, "skipped", {
      resultJson: { status: "skipped", skippedReason: "empty_input" } satisfies EnrichmentTaskResult,
    });
    return;
  }

  await updateTaskStatus(task.id, "running");
  await db
    .update(scriptEnrichmentJobs)
    .set({
      currentEpisode: input.episodeIndex ? `EP${input.episodeIndex}` : input.episodeId,
      currentScene: input.sceneTitle,
      updatedAt: new Date(),
    })
    .where(eq(scriptEnrichmentJobs.id, job.id));

  const scored = input.beats.map((beat) => ({
    beat,
    score: scoreDetailSufficiency(beat.text),
  }));
  const beatsNeedingAi = scored
    .filter((item) => item.score.status === "needs_enrichment")
    .map((item) => item.beat);

  if (beatsNeedingAi.length === 0) {
    await updateTaskStatus(task.id, "skipped", {
      resultJson: {
        status: "skipped",
        skippedReason: "detail_sufficient",
        skippedBeatIds: input.beats.map((beat) => beat.id),
      } satisfies EnrichmentTaskResult,
    });
    await addJobLog(job.projectId, job.id, "info", `Skipped ${input.beats.length} detailed beats`, {
      taskId: task.id,
      chunkId: input.chunkId,
    });
    return;
  }

  const productionBible = await getActiveProductionBible(job.projectId);
  const assets = await loadProjectAssets(job.projectId);
  const boundAgent = options.useAI === false ? null : await loadBoundEnrichmentAgent(job.projectId);
  const result = await generateScriptVisualEnrichmentPreview({
    script: input.sceneText,
    scenes: [{
      id: input.sceneId,
      episode_id: input.episodeId,
      title: input.sceneTitle,
      text: input.sceneText,
      location: input.sceneTitle,
      description: input.sceneText.slice(0, 240),
    }],
    beats: beatsNeedingAi,
    assets,
    productionBible,
    modelConfig: options.modelConfig,
    agentConfig: boundAgent,
    useAI: options.useAI,
    fallbackToLocal: options.fallbackToLocal,
    maxBeats: beatsNeedingAi.length,
  });

  await updateTaskStatus(task.id, "completed", {
    resultJson: {
      status: "completed",
      acceptedPatches: result.validation.accepted_patches,
      allPatches: result.patches,
      stats: result.stats as unknown as Record<string, unknown>,
      validation: result.validation as unknown as Record<string, unknown>,
      skippedBeatIds: scored
        .filter((item) => item.score.status === "detail_sufficient")
        .map((item) => item.beat.id),
    } satisfies EnrichmentTaskResult,
  });
  await addJobLog(job.projectId, job.id, "info", `Completed enrichment task ${task.sequence + 1}`, {
    taskId: task.id,
    acceptedPatches: result.validation.accepted_patches.length,
    totalBeats: result.stats.total_beats,
  });
}

export async function runScriptEnrichmentJob(jobId: string) {
  ensureScriptEnrichmentTables();

  const [existingJob] = await db
    .select()
    .from(scriptEnrichmentJobs)
    .where(eq(scriptEnrichmentJobs.id, jobId));
  if (!existingJob) throw new Error(`Enrichment job not found: ${jobId}`);
  if (existingJob.status === "completed" || existingJob.status === "cancelled") return { status: existingJob.status };
  if (existingJob.status === "running") return { status: "running" };

  const [job] = await db
    .update(scriptEnrichmentJobs)
    .set({
      status: "running",
      startedAt: existingJob.startedAt || new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(scriptEnrichmentJobs.id, jobId),
      inArray(scriptEnrichmentJobs.status, ["queued", "failed"]),
    ))
    .returning();
  if (!job) throw new Error(`Enrichment job not found: ${jobId}`);

  const options = readJobOptions(job);
  await addJobLog(job.projectId, job.id, "info", "Enrichment worker started");

  try {
    while (true) {
      const [currentJob] = await db
        .select()
        .from(scriptEnrichmentJobs)
        .where(eq(scriptEnrichmentJobs.id, jobId));
      if (!currentJob || currentJob.status === "cancelled") {
        await addJobLog(job.projectId, job.id, "warn", "Enrichment worker cancelled");
        return { status: "cancelled" };
      }

      const pendingTasks = await db
        .select()
        .from(scriptEnrichmentTasks)
        .where(and(
          eq(scriptEnrichmentTasks.jobId, jobId),
          eq(scriptEnrichmentTasks.status, "pending"),
        ))
        .orderBy(asc(scriptEnrichmentTasks.sequence))
        .limit(options.concurrency);

      if (pendingTasks.length === 0) {
        const progress = await refreshJobProgress(jobId);
        const finalStatus: JobStatus = progress.total === 0 ? "failed" : "completed";
        await db
          .update(scriptEnrichmentJobs)
          .set({
            status: finalStatus,
            progress: 100,
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(scriptEnrichmentJobs.id, jobId));
        const persisted = await rebuildAndPersistEnrichedText(currentJob, options);
        await addJobLog(job.projectId, job.id, progress.failed > 0 ? "warn" : "info", "Enrichment job finished", {
          ...progress,
          ...persisted,
        });
        await addImportLog(
          job.projectId,
          2,
          progress.failed > 0 ? "error" : "running",
          progress.failed > 0
            ? `AI 细节补全部分完成：成功 ${progress.completed}，跳过 ${progress.skipped}，失败 ${progress.failed}`
            : `AI 细节补全完成：成功 ${progress.completed}，跳过 ${progress.skipped}`,
          {
            jobId,
            ...progress,
            ...persisted,
          },
        );
        return { status: finalStatus, ...progress, ...persisted };
      }

      await Promise.all(pendingTasks.map(async (task) => {
        try {
          await processEnrichmentTask(job, task, options);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const retryCount = (task.retryCount || 0) + 1;
          const retryable = retryCount <= (task.maxRetries || options.maxRetries);
          await updateTaskStatus(task.id, retryable ? "pending" : "failed", {
            retryCount,
            errorMessage: message,
            resultJson: {
              status: retryable ? "pending" : "failed",
              skippedReason: message,
            } satisfies EnrichmentTaskResult,
          });
          await addJobLog(job.projectId, job.id, retryable ? "warn" : "error", `Enrichment task failed: ${message}`, {
            taskId: task.id,
            retryCount,
            retryable,
          });
        }
      }));

      const progress = await refreshJobProgress(jobId);
      const [latestJob] = await db
        .select()
        .from(scriptEnrichmentJobs)
        .where(eq(scriptEnrichmentJobs.id, jobId));
      if (latestJob) {
        await rebuildAndPersistEnrichedText(latestJob, options);
      }
      await addJobLog(job.projectId, job.id, "info", `Progress ${progress.finished}/${progress.total}`, progress);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(scriptEnrichmentJobs)
      .set({
        status: "failed",
        errorMessage: message,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scriptEnrichmentJobs.id, jobId));
    await addJobLog(job.projectId, job.id, "error", `Enrichment job failed: ${message}`);
    await addImportLog(job.projectId, 2, "error", `AI 细节补全任务失败：${message}`, { jobId });
    throw error;
  }
}

export async function getScriptEnrichmentJobStatus(projectId: string, jobId: string) {
  ensureScriptEnrichmentTables();
  await refreshJobProgress(jobId);

  const [job] = await db
    .select()
    .from(scriptEnrichmentJobs)
    .where(and(eq(scriptEnrichmentJobs.id, jobId), eq(scriptEnrichmentJobs.projectId, projectId)));
  if (!job) return null;

  const recentLogs = await db
    .select()
    .from(scriptEnrichmentLogs)
    .where(eq(scriptEnrichmentLogs.jobId, jobId))
    .orderBy(desc(scriptEnrichmentLogs.createdAt))
    .limit(20);
  const [state] = await db
    .select({ fullText: importStates.fullText })
    .from(importStates)
    .where(eq(importStates.projectId, projectId));
  const patches = await collectAcceptedPatches(jobId);

  return {
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    total_tasks: job.totalTasks,
    completed_tasks: job.completedTasks,
    failed_tasks: job.failedTasks,
    skipped_tasks: job.skippedTasks,
    current_episode: job.currentEpisode || "",
    current_scene: job.currentScene || "",
    error_message: job.errorMessage || "",
    enrichedText: state?.fullText || "",
    visualEnrichment: {
      patches,
      stats: {
        total_beats: patches.length,
        enriched_beats: patches.length,
        needs_review: patches.filter((patch) => patch.needs_human_review).length,
        invalid: 0,
      },
      validation: {
        status: patches.some((patch) => patch.needs_human_review) ? "needs_review" : "valid",
        warnings: [],
        errors: [],
        accepted_patches: patches,
      },
    },
    recent_logs: recentLogs.reverse().map((log) => ({
      id: log.id,
      level: log.level,
      message: log.message,
      meta: log.metaJson,
      created_at: log.createdAt,
    })),
  };
}

export async function cancelScriptEnrichmentJob(projectId: string, jobId: string) {
  ensureScriptEnrichmentTables();
  await db
    .update(scriptEnrichmentJobs)
    .set({
      status: "cancelled",
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(scriptEnrichmentJobs.id, jobId), eq(scriptEnrichmentJobs.projectId, projectId)));
  await db
    .update(scriptEnrichmentTasks)
    .set({
      status: "failed",
      errorMessage: "cancelled",
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(scriptEnrichmentTasks.jobId, jobId),
      inArray(scriptEnrichmentTasks.status, ["pending", "running"]),
    ));
  await refreshJobProgress(jobId);
  await addJobLog(projectId, jobId, "warn", "Enrichment job cancelled");
  return getScriptEnrichmentJobStatus(projectId, jobId);
}

export async function retryFailedScriptEnrichmentTasks(projectId: string, jobId: string) {
  ensureScriptEnrichmentTables();
  await db
    .update(scriptEnrichmentTasks)
    .set({
      status: "pending",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(scriptEnrichmentTasks.jobId, jobId),
      eq(scriptEnrichmentTasks.projectId, projectId),
      eq(scriptEnrichmentTasks.status, "failed"),
    ));
  await db
    .update(scriptEnrichmentJobs)
    .set({
      status: "queued",
      errorMessage: null,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(scriptEnrichmentJobs.id, jobId), eq(scriptEnrichmentJobs.projectId, projectId)));
  await refreshJobProgress(jobId);
  await addJobLog(projectId, jobId, "info", "Failed enrichment tasks queued for retry");
  await enqueueTask({
    type: "script_visual_enrichment",
    projectId,
    payload: { jobId },
    maxRetries: 1,
  });
  return getScriptEnrichmentJobStatus(projectId, jobId);
}
