import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, shots, dialogues, characters, storyboardVersions } from "@/lib/db/schema";
import { eq, and, asc, desc as descOrder, inArray } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: projectId, versionId } = await params;
  const userId = getUserIdFromRequest(_request);

  const [project] = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [version] = await db
    .select()
    .from(storyboardVersions)
    .where(and(eq(storyboardVersions.id, versionId), eq(storyboardVersions.projectId, projectId)));
  if (!version) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  const versionShots = await db
    .select()
    .from(shots)
    .where(and(eq(shots.projectId, projectId), eq(shots.versionId, versionId)))
    .orderBy(asc(shots.sequence));

  const { shotAssets } = await import("@/lib/db/schema");
  const assetRows = versionShots.length
    ? await db
        .select()
        .from(shotAssets)
        .where(inArray(shotAssets.shotId, versionShots.map((s) => s.id)))
        .orderBy(shotAssets.type, shotAssets.sequenceInType, descOrder(shotAssets.assetVersion))
    : [];

  const assetsByShot = new Map<string, typeof assetRows>();
  for (const row of assetRows) {
    if (!assetsByShot.has(row.shotId)) assetsByShot.set(row.shotId, []);
    assetsByShot.get(row.shotId)!.push(row);
  }

  const enriched = await Promise.all(
    versionShots.map(async (shot) => {
      const shotDialogues = await db
        .select({
          id: dialogues.id,
          text: dialogues.text,
          characterId: dialogues.characterId,
          characterName: characters.name,
          sequence: dialogues.sequence,
        })
        .from(dialogues)
        .innerJoin(characters, eq(dialogues.characterId, characters.id))
        .where(eq(dialogues.shotId, shot.id))
        .orderBy(asc(dialogues.sequence));

      const assets = (assetsByShot.get(shot.id) ?? []).map((a) => ({
        id: a.id,
        type: a.type,
        isActive: a.isActive,
        prompt: a.prompt,
        fileUrl: a.fileUrl,
        status: a.status,
        characters: a.characters ? JSON.parse(a.characters) : null,
        modelProvider: a.modelProvider,
        modelId: a.modelId,
        meta: a.meta ? JSON.parse(a.meta) : null,
      }));

      return { ...shot, dialogues: shotDialogues, assets };
    })
  );

  return NextResponse.json({
    version: {
      id: version.id,
      label: version.label,
      versionNum: version.versionNum,
      createdAt: version.createdAt instanceof Date ? Math.floor(version.createdAt.getTime() / 1000) : version.createdAt,
    },
    shots: enriched,
  });
}
