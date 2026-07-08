import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { compileVisualAssetVersion } from "@/lib/industrial-pipeline";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({})) as {
    assetLibraryVersionId?: string;
  };

  try {
    const version = await compileVisualAssetVersion({
      projectId,
      assetLibraryVersionId: body.assetLibraryVersionId,
    });
    return NextResponse.json({ visual_asset_version: version }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to compile visual assets",
    }, { status: 409 });
  }
}
