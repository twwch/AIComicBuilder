import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";

async function assertShotInProject(shotId: string, projectId: string) {
  const [row] = await db
    .select({ id: shots.id })
    .from(shots)
    .where(and(eq(shots.id, shotId), eq(shots.projectId, projectId)));
  return !!row;
}

/**
 * PATCH /api/projects/[id]/shots/[shotId]
 * Updates only metadata fields on the shots table. Image/video assets live
 * in the shot_assets table and must be patched via /shots/[shotId]/assets.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await assertShotInProject(shotId, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as Partial<{
    prompt: string;
    duration: number;
    sequence: number;
    motionScript: string | null;
    videoScript: string | null;
    videoPrompt: string | null;
    cameraDirection: string;
    transitionIn: string;
    transitionOut: string;
    sceneId: string | null;
    compositionGuide: string;
    focalPoint: string;
    depthOfField: string;
    soundDesign: string;
    musicCue: string;
    costumeOverrides: string;
  }>;

  const allowed: Record<string, unknown> = {};
  const ALLOWED_KEYS = [
    "prompt",
    "duration",
    "sequence",
    "motionScript",
    "videoScript",
    "videoPrompt",
    "cameraDirection",
    "transitionIn",
    "transitionOut",
    "sceneId",
    "compositionGuide",
    "focalPoint",
    "depthOfField",
    "soundDesign",
    "musicCue",
    "costumeOverrides",
  ] as const;
  for (const key of ALLOWED_KEYS) {
    if (key in body) allowed[key] = (body as Record<string, unknown>)[key];
  }

  if (Object.keys(allowed).length === 0) {
    const [row] = await db.select().from(shots).where(eq(shots.id, shotId));
    return NextResponse.json(row);
  }

  const [updated] = await db
    .update(shots)
    .set(allowed)
    .where(eq(shots.id, shotId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [target] = await db
    .select()
    .from(shots)
    .where(and(eq(shots.id, shotId), eq(shots.projectId, projectId)));
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.delete(shots).where(eq(shots.id, shotId));
  const scope = [
    eq(shots.projectId, projectId),
    gt(shots.sequence, target.sequence),
  ];
  if (target.episodeId) scope.push(eq(shots.episodeId, target.episodeId));
  else scope.push(isNull(shots.episodeId));
  if (target.versionId) scope.push(eq(shots.versionId, target.versionId));
  else scope.push(isNull(shots.versionId));
  await db
    .update(shots)
    .set({ sequence: sql`${shots.sequence} - 1` })
    .where(and(...scope));
  return new NextResponse(null, { status: 204 });
}
