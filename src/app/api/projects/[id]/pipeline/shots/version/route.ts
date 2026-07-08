import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { createShotVersion } from "@/lib/industrial-pipeline";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({})) as {
    confirmedScriptVersionId?: string;
    assetLibraryVersionId?: string;
    shots?: unknown[];
    lock?: boolean;
  };

  try {
    const version = await createShotVersion({
      projectId,
      confirmedScriptVersionId: body.confirmedScriptVersionId,
      assetLibraryVersionId: body.assetLibraryVersionId,
      shots: body.shots,
      lock: body.lock === true,
      userId: project.userId,
    });
    return NextResponse.json({ shot_version: version }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to create shot version",
    }, { status: 409 });
  }
}
