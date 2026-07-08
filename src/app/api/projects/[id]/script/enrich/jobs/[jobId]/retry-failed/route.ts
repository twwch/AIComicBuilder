import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { retryFailedScriptEnrichmentTasks } from "@/lib/script-enrichment/enrichment-job-runner";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const { id: projectId, jobId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const status = await retryFailedScriptEnrichmentTasks(projectId, jobId);
  return NextResponse.json(status);
}
