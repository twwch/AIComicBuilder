import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentBindings,
  agents,
  assets as storyAssets,
  importStates,
  projects as projectsTable,
} from "@/lib/db/schema";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { getActiveProductionBible } from "@/lib/production-bible";
import { addImportLog } from "@/lib/import-utils";
import {
  applyEnrichmentPatchesToText,
  generateScriptVisualEnrichmentPreview,
} from "@/lib/script-visual-enrichment";
import type { AgentPlatform } from "@/lib/ai/agent-caller";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";

export const runtime = "nodejs";
export const maxDuration = 360;

interface EnrichPreviewBody {
  script?: string;
  episodes?: unknown[];
  scenes?: unknown[];
  beats?: unknown[];
  assets?: unknown[];
  productionBible?: unknown;
  modelConfig?: { text?: ProviderConfig | null } | null;
  useAI?: boolean;
  applyToText?: boolean;
  fallbackToLocal?: boolean;
  maxBeats?: number;
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as EnrichPreviewBody;
  const script = String(body.script || project.script || "").trim();
  const scenes = Array.isArray(body.scenes) ? body.scenes : [];
  const beats = Array.isArray(body.beats) ? body.beats : [];

  if (!script && scenes.length === 0 && beats.length === 0) {
    return NextResponse.json({ error: "script, scenes, or beats is required" }, { status: 400 });
  }

  const projectAssets = Array.isArray(body.assets) ? body.assets : await loadProjectAssets(projectId);
  const productionBible =
    body.productionBible && typeof body.productionBible === "object"
      ? body.productionBible
      : await getActiveProductionBible(projectId);
  const boundAgent = body.useAI === false ? null : await loadBoundEnrichmentAgent(projectId);
  const useAI = body.useAI ?? Boolean(boundAgent);
  const applyToText = body.applyToText !== false;

  await addImportLog(
    projectId,
    2,
    "running",
    `开始补充剧本视觉细节：${script.length} 字，模式 ${useAI ? "AI" : "快速规则"}`,
    {
      charCount: script.length,
      useAI,
      applyToText,
      maxBeats: body.maxBeats,
    },
  );

  try {
    const result = await generateScriptVisualEnrichmentPreview({
      script,
      episodes: Array.isArray(body.episodes) ? body.episodes : [],
      scenes,
      beats,
      assets: projectAssets,
      productionBible,
      modelConfig: body.modelConfig,
      agentConfig: boundAgent,
      useAI,
      fallbackToLocal: body.fallbackToLocal,
      maxBeats: body.maxBeats,
    });

    const applied = applyToText
      ? applyEnrichmentPatchesToText(script, result.validation.accepted_patches)
      : {
          text: script,
          appliedCount: 0,
          skippedCount: result.validation.accepted_patches.length,
        };

    await addImportLog(
      projectId,
      2,
      "running",
      applyToText
        ? `剧本视觉细节补充完成：应用 ${applied.appliedCount} 段，跳过 ${applied.skippedCount} 段`
        : `剧本视觉细节候选完成：${result.validation.accepted_patches.length} 段，未改写原文`,
      {
        appliedPatchCount: applied.appliedCount,
        skippedPatchCount: applied.skippedCount,
        totalBeats: result.stats.total_beats,
        status: result.validation.status,
      },
    );

    if (applyToText && applied.text !== script) {
      const stepStatus = { 1: "done", 2: "idle", 3: "idle", 4: "idle", 5: "idle" };
      await db
        .insert(importStates)
        .values({
          projectId,
          currentStep: 2,
          stepStatus,
          fullText: applied.text,
          reviewIssues: [],
          storyAnalysis: null,
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
            updatedAt: new Date(),
          },
        });

      await db
        .update(projectsTable)
        .set({ script: applied.text, updatedAt: new Date() })
        .where(eq(projectsTable.id, projectId));

      await addImportLog(
        projectId,
        2,
        "running",
        `AI 细节补全文本已保存到草稿：${applied.text.length} 字`,
        {
          charCount: applied.text.length,
          appliedPatchCount: applied.appliedCount,
        },
      );
    }

    return NextResponse.json({
      ...result,
      enrichedText: applied.text,
      appliedPatchCount: applied.appliedCount,
      skippedPatchCount: applied.skippedCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await addImportLog(
      projectId,
      2,
      "error",
      `AI 细节补全失败：${message}`,
      {
        charCount: script.length,
        useAI,
        applyToText,
        maxBeats: body.maxBeats,
      },
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
