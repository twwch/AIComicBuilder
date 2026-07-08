import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { recordPipelineCost } from "@/lib/industrial-pipeline";

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
    objectType?: string;
    objectId?: string;
    provider?: string;
    modelId?: string;
    costCents?: number;
    currency?: string;
    usage?: unknown;
  };
  if (!body.stage) {
    return NextResponse.json({ error: "stage is required" }, { status: 400 });
  }

  const cost = await recordPipelineCost({
    projectId,
    stage: body.stage,
    objectType: body.objectType,
    objectId: body.objectId,
    provider: body.provider,
    modelId: body.modelId,
    costCents: body.costCents,
    currency: body.currency,
    usage: body.usage,
  });

  return NextResponse.json({ cost }, { status: 201 });
}
