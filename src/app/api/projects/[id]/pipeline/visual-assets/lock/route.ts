import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { lockVisualAssetVersion } from "@/lib/industrial-pipeline";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({})) as {
    visualAssetVersionId?: string;
    allowMissingImages?: boolean;
  };
  if (!body.visualAssetVersionId) {
    return NextResponse.json({ error: "visualAssetVersionId is required" }, { status: 400 });
  }

  try {
    const version = await lockVisualAssetVersion({
      projectId,
      visualAssetVersionId: body.visualAssetVersionId,
      allowMissingImages: body.allowMissingImages === true,
      userId: project.userId,
    });
    return NextResponse.json({ visual_asset_version: version });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to lock visual assets",
    }, { status: 409 });
  }
}
