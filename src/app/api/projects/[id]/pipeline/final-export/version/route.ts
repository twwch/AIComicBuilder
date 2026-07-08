import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { createFinalExportVersion } from "@/lib/industrial-pipeline";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({})) as {
    videoClipVersionId?: string;
    exports?: unknown[];
    timeline?: unknown;
    complete?: boolean;
  };

  try {
    const version = await createFinalExportVersion({
      projectId,
      videoClipVersionId: body.videoClipVersionId,
      exports: body.exports,
      timeline: body.timeline,
      complete: body.complete === true,
    });
    return NextResponse.json({ final_export_version: version }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to create final export version",
    }, { status: 409 });
  }
}
