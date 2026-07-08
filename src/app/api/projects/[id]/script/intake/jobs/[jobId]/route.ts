import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { registerPipelineHandlers } from "@/lib/pipeline";
import {
  ensureScriptIntakeJobQueued,
  getScriptIntakeJobStatus,
} from "@/lib/script-intake/intake-job-runner";
import { startWorker } from "@/lib/task-queue";

function ensureIntakeWorkerReady() {
  registerPipelineHandlers();
  startWorker();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const { id: projectId, jobId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureIntakeWorkerReady();
  await ensureScriptIntakeJobQueued(projectId, jobId);

  const status = await getScriptIntakeJobStatus(projectId, jobId);
  if (!status) {
    return NextResponse.json({ error: "Intake job not found" }, { status: 404 });
  }

  return NextResponse.json(status);
}
