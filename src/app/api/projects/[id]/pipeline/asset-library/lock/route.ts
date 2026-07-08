import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { lockAssetLibraryVersion } from "@/lib/industrial-pipeline";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({})) as {
    confirmedScriptVersionId?: string;
    assetIds?: string[];
    reviewSummary?: unknown;
  };

  try {
    const version = await lockAssetLibraryVersion({
      projectId,
      confirmedScriptVersionId: body.confirmedScriptVersionId,
      assetIds: Array.isArray(body.assetIds) ? body.assetIds : undefined,
      reviewSummary: body.reviewSummary,
      userId: project.userId,
    });
    return NextResponse.json({ asset_library_version: version }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to lock asset library",
    }, { status: 409 });
  }
}
