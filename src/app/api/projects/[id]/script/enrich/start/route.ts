import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import {
  runScriptEnrichmentJob,
  startScriptEnrichmentJob,
} from "@/lib/script-enrichment/enrichment-job-runner";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";

export const runtime = "nodejs";
export const maxDuration = 30;

interface StartBody {
  script?: string;
  modelConfig?: { text?: ProviderConfig | null } | null;
  useAI?: boolean;
  fallbackToLocal?: boolean;
  concurrency?: number;
  beatGroupSize?: number;
  maxBeatsPerChunk?: number;
  maxRetries?: number;
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

  const body = (await request.json().catch(() => ({}))) as StartBody;
  const sourceText = String(body.script || project.script || "").trim();
  if (!sourceText) {
    return NextResponse.json({ error: "Script text is empty" }, { status: 400 });
  }

  try {
    const job = await startScriptEnrichmentJob({
      projectId,
      sourceText,
      modelConfig: body.modelConfig,
      useAI: body.useAI,
      fallbackToLocal: body.fallbackToLocal,
      concurrency: body.concurrency,
      beatGroupSize: body.beatGroupSize,
      maxBeatsPerChunk: body.maxBeatsPerChunk,
      maxRetries: body.maxRetries,
    });
    setTimeout(() => {
      void runScriptEnrichmentJob(job.jobId).catch((error) => {
        console.error("[ScriptEnrichment] Background kick failed:", error);
      });
    }, 0);
    return NextResponse.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
