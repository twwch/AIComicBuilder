import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { getScriptEnrichmentJobStatus } from "@/lib/script-enrichment/enrichment-job-runner";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const { id: projectId, jobId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const status = await getScriptEnrichmentJobStatus(projectId, jobId);
  if (!status) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json(status);
}
