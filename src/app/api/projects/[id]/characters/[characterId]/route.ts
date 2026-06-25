import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { normalizeUploadPath } from "@/lib/utils/upload-path";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id: projectId, characterId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Ensure character belongs to this project
  const [existing] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.projectId, projectId)));
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as Partial<{
    name: string;
    description: string;
    visualHint: string;
    scope: string;
    episodeId: string | null;
    referenceImage: string;
  }>;

  // When promoting to main, auto-clear episodeId
  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.visualHint !== undefined) updateData.visualHint = body.visualHint;
  if (body.referenceImage !== undefined) {
    updateData.referenceImage = normalizeUploadPath(
      body.referenceImage,
      process.env.UPLOAD_DIR || "./uploads",
    );
  }
  if (body.scope !== undefined) {
    updateData.scope = body.scope;
    if (body.scope === "main") {
      updateData.episodeId = null;
    }
  }
  if (body.episodeId !== undefined && body.scope !== "main") {
    updateData.episodeId = body.episodeId;
  }

  const [updated] = await db
    .update(characters)
    .set(updateData)
    .where(eq(characters.id, characterId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id: projectId, characterId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db
    .delete(characters)
    .where(and(eq(characters.id, characterId), eq(characters.projectId, projectId)));
  return new NextResponse(null, { status: 204 });
}
