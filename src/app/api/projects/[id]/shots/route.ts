import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, dialogues, characters, shotAssets } from "@/lib/db/schema";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { id as genId } from "@/lib/id";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const projectShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  // Enrich with dialogues
  const enriched = await Promise.all(
    projectShots.map(async (shot) => {
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
      return { ...shot, dialogues: shotDialogues };
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: "add" | "duplicate";
    sourceShotId?: string;
    episodeId?: string | null;
    versionId?: string | null;
  };

  const action = body.action ?? "add";

  if (action === "duplicate") {
    if (!body.sourceShotId) {
      return NextResponse.json({ error: "sourceShotId is required" }, { status: 400 });
    }

    const [source] = await db
      .select()
      .from(shots)
      .where(and(eq(shots.id, body.sourceShotId), eq(shots.projectId, projectId)));

    if (!source) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const sequenceScope = [
      eq(shots.projectId, projectId),
      gt(shots.sequence, source.sequence),
    ];
    if (source.episodeId) {
      sequenceScope.push(eq(shots.episodeId, source.episodeId));
    } else {
      sequenceScope.push(isNull(shots.episodeId));
    }
    if (source.versionId) {
      sequenceScope.push(eq(shots.versionId, source.versionId));
    } else {
      sequenceScope.push(isNull(shots.versionId));
    }

    await db
      .update(shots)
      .set({ sequence: sql`${shots.sequence} + 1` })
      .where(and(...sequenceScope));

    const newShotId = genId();
    const [created] = await db
      .insert(shots)
      .values({
        id: newShotId,
        projectId,
        sequence: source.sequence + 1,
        prompt: source.prompt,
        motionScript: source.motionScript,
        cameraDirection: source.cameraDirection,
        duration: source.duration,
        videoScript: source.videoScript,
        videoPrompt: source.videoPrompt,
        transitionIn: source.transitionIn,
        transitionOut: source.transitionOut,
        episodeId: source.episodeId,
        versionId: source.versionId,
        sceneId: source.sceneId,
        compositionGuide: source.compositionGuide,
        focalPoint: source.focalPoint,
        depthOfField: source.depthOfField,
        soundDesign: source.soundDesign,
        musicCue: source.musicCue,
        costumeOverrides: source.costumeOverrides,
        status: "pending",
      })
      .returning();

    const sourceDialogues = await db
      .select()
      .from(dialogues)
      .where(eq(dialogues.shotId, source.id))
      .orderBy(asc(dialogues.sequence));

    if (sourceDialogues.length > 0) {
      await db.insert(dialogues).values(
        sourceDialogues.map((dialogue) => ({
          id: genId(),
          shotId: newShotId,
          characterId: dialogue.characterId,
          text: dialogue.text,
          audioUrl: null,
          sequence: dialogue.sequence,
          startRatio: dialogue.startRatio,
          endRatio: dialogue.endRatio,
        }))
      );
    }

    const activeAssets = await db
      .select()
      .from(shotAssets)
      .where(and(eq(shotAssets.shotId, source.id), eq(shotAssets.isActive, 1)))
      .orderBy(shotAssets.type, shotAssets.sequenceInType);

    if (activeAssets.length > 0) {
      await db.insert(shotAssets).values(
        activeAssets.map((asset) => ({
          id: genId(),
          shotId: newShotId,
          type: asset.type,
          sequenceInType: asset.sequenceInType,
          assetVersion: 1,
          isActive: 1,
          prompt: asset.prompt,
          fileUrl: asset.fileUrl,
          status: asset.status,
          characters: asset.characters,
          modelProvider: asset.modelProvider,
          modelId: asset.modelId,
          meta: asset.meta,
        }))
      );
    }

    return NextResponse.json(created, { status: 201 });
  }

  const shotScope = [eq(shots.projectId, projectId)];
  if (body.episodeId) shotScope.push(eq(shots.episodeId, body.episodeId));
  else shotScope.push(isNull(shots.episodeId));
  if (body.versionId) shotScope.push(eq(shots.versionId, body.versionId));
  else shotScope.push(isNull(shots.versionId));

  const existingShots = await db
    .select({ sequence: shots.sequence })
    .from(shots)
    .where(and(...shotScope));
  const nextSequence = Math.max(0, ...existingShots.map((shot) => shot.sequence)) + 1;

  const [created] = await db
    .insert(shots)
    .values({
      id: genId(),
      projectId,
      sequence: nextSequence,
      prompt: "",
      motionScript: "",
      cameraDirection: "static",
      duration: 8,
      transitionIn: "cut",
      transitionOut: "cut",
      episodeId: body.episodeId ?? null,
      versionId: body.versionId ?? null,
      depthOfField: "medium",
      status: "pending",
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
