import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { recordPipelineIssue, type PipelineSeverity } from "@/lib/industrial-pipeline";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({})) as {
    stage?: string;
    issueType?: string;
    severity?: PipelineSeverity;
    sourceVersionType?: string;
    sourceVersionId?: string;
    sourceObjectType?: string;
    sourceObjectId?: string;
    sourceRange?: unknown;
    sourceText?: string;
    message?: string;
    suggestedAction?: string;
  };

  if (!body.stage || !body.issueType || !body.message) {
    return NextResponse.json({ error: "stage, issueType and message are required" }, { status: 400 });
  }

  const issue = await recordPipelineIssue({
    projectId,
    stage: body.stage,
    issueType: body.issueType,
    severity: body.severity,
    sourceVersionType: body.sourceVersionType,
    sourceVersionId: body.sourceVersionId,
    sourceObjectType: body.sourceObjectType,
    sourceObjectId: body.sourceObjectId,
    sourceRange: body.sourceRange,
    sourceText: body.sourceText,
    message: body.message,
    suggestedAction: body.suggestedAction,
  });

  return NextResponse.json({ issue }, { status: 201 });
}
