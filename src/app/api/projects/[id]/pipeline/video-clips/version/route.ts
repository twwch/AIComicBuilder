import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { createVideoClipVersion } from "@/lib/industrial-pipeline";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({})) as {
    storyboardVersionId?: string;
    clips?: unknown[];
    approve?: boolean;
    quality?: unknown;
  };

  try {
    const version = await createVideoClipVersion({
      projectId,
      storyboardVersionId: body.storyboardVersionId,
      clips: body.clips,
      approve: body.approve === true,
      quality: body.quality,
    });
    return NextResponse.json({ video_clip_version: version }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to create video clip version",
    }, { status: 409 });
  }
}
