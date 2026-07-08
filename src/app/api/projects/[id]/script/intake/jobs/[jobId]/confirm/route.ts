import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { confirmScriptIntakeJob } from "@/lib/script-intake/intake-job-runner";

export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const { id: projectId, jobId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    content?: unknown;
    reviewNotes?: unknown;
  };

  try {
    const result = await confirmScriptIntakeJob({
      projectId,
      jobId,
      userId: getUserIdFromRequest(request),
      content: typeof body.content === "string" ? body.content : undefined,
      reviewNotes: body.reviewNotes,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to confirm script intake";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
