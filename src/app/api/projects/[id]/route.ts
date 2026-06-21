import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, characters, shots, dialogues, storyboardVersions } from "@/lib/db/schema";
import { eq, asc, and, desc } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { markDownstreamStale } from "@/lib/staleness";
import { ProjectUpdateSchema, parseOrThrow } from "@/lib/validation";

async function resolveProject(id: string, userId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return project ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const versionId = url.searchParams.get("versionId") ?? undefined;
  const excludeShots = url.searchParams.get("exclude") === "shots";

  // Fetch all versions for this project (newest first)
  const allVersions = await db
    .select()
    .from(storyboardVersions)
    .where(eq(storyboardVersions.projectId, id))
    .orderBy(desc(storyboardVersions.versionNum));

  // Resolve which version to show shots for
  const resolvedVersionId = versionId ?? allVersions[0]?.id;

  // Fetch related data
  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, id));

  // Episodes list (always needed for navigation)
  const projectEpisodes = await db
    .select()
    .from(episodes)
    .where(eq(episodes.projectId, id))
    .orderBy(asc(episodes.sequence));

  // Lightweight mode: skip shots/assets/dialogues
  let enrichedShots: Array<Record<string, unknown>> = [];
  if (!excludeShots) {
    const projectShots = resolvedVersionId
      ? await db
          .select()
          .from(shots)
          .where(and(eq(shots.projectId, id), eq(shots.versionId, resolvedVersionId)))
          .orderBy(asc(shots.sequence))
      : [];

    const { shotAssets } = await import("@/lib/db/schema");
    const { inArray, desc: descOrder } = await import("drizzle-orm");
    const assetRows = projectShots.length
      ? await db
          .select()
          .from(shotAssets)
          .where(inArray(shotAssets.shotId, projectShots.map((s) => s.id)))
          .orderBy(shotAssets.type, shotAssets.sequenceInType, descOrder(shotAssets.assetVersion))
      : [];
    const assetsByShot = new Map<string, typeof assetRows>();
    for (const row of assetRows) {
      if (!assetsByShot.has(row.shotId)) assetsByShot.set(row.shotId, []);
      assetsByShot.get(row.shotId)!.push(row);
    }

    const dialogueRows = projectShots.length
      ? await db
          .select({
            id: dialogues.id,
            shotId: dialogues.shotId,
            text: dialogues.text,
            characterId: dialogues.characterId,
            characterName: characters.name,
            sequence: dialogues.sequence,
          })
          .from(dialogues)
          .innerJoin(characters, eq(dialogues.characterId, characters.id))
          .where(inArray(dialogues.shotId, projectShots.map((s) => s.id)))
          .orderBy(asc(dialogues.sequence))
      : [];
    const dialoguesByShot = new Map<string, typeof dialogueRows>();
    for (const row of dialogueRows) {
      if (!dialoguesByShot.has(row.shotId)) dialoguesByShot.set(row.shotId, []);
      dialoguesByShot.get(row.shotId)!.push(row);
    }

    enrichedShots = projectShots.map((shot) => {
      const shotDialogues = dialoguesByShot.get(shot.id) ?? [];
      const assets = (assetsByShot.get(shot.id) ?? []).map((a) => ({
        id: a.id,
        shotId: a.shotId,
        type: a.type,
        sequenceInType: a.sequenceInType,
        assetVersion: a.assetVersion,
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
    }) as Array<Record<string, unknown>>;
  }

  return NextResponse.json({
    ...project,
    episodes: projectEpisodes,
    characters: projectCharacters,
    shots: enrichedShots,
    versions: allVersions.map((v) => ({
      id: v.id,
      label: v.label,
      versionNum: v.versionNum,
      createdAt: v.createdAt instanceof Date ? Math.floor(v.createdAt.getTime() / 1000) : v.createdAt,
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await request.json();
  const body = parseOrThrow(ProjectUpdateSchema, raw);
  const { title, idea, script, outline, status, generationMode, useProjectPrompts, colorPalette, worldSetting, targetDuration, bgmUrl } = body;

  const [updated] = await db
    .update(projects)
    .set({
      ...(title !== undefined && { title }),
      ...(idea !== undefined && { idea }),
      ...(script !== undefined && { script }),
      ...(outline !== undefined && { outline }),
      ...(status !== undefined && { status }),
      ...(generationMode !== undefined && { generationMode }),
      ...(useProjectPrompts !== undefined && { useProjectPrompts }),
      ...(colorPalette !== undefined && { colorPalette }),
      ...(worldSetting !== undefined && { worldSetting }),
      ...(targetDuration !== undefined && { targetDuration }),
      ...(bgmUrl !== undefined && { bgmUrl }),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
    .returning();

  if (script !== undefined) {
    await markDownstreamStale("project", id);
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(projects).where(eq(projects.id, id));
  return new NextResponse(null, { status: 204 });
}
