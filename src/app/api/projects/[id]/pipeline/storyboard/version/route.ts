import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { createStoryboardPipelineVersion } from "@/lib/industrial-pipeline";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({})) as {
    shotVersionId?: string;
    visualAssetVersionId?: string;
    frames?: unknown[];
    lock?: boolean;
  };

  try {
    const version = await createStoryboardPipelineVersion({
      projectId,
      shotVersionId: body.shotVersionId,
      visualAssetVersionId: body.visualAssetVersionId,
      frames: body.frames,
      lock: body.lock === true,
      userId: project.userId,
    });
    return NextResponse.json({ storyboard_version: version }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to create storyboard version",
    }, { status: 409 });
  }
}
