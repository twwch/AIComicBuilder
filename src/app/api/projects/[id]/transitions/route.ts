import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { projects } from "@/lib/db/schema";
import { recommendTransitions, mergeTransitions } from "@/lib/transition-recommender";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [ownerCheck] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!ownerCheck) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(request.url);
  const episodeId = url.searchParams.get("episodeId");

  const whereConditions = [eq(shots.projectId, projectId)];
  if (episodeId) whereConditions.push(eq(shots.episodeId, episodeId));
  const shotRows = await db
    .select({
      id: shots.id,
      sequence: shots.sequence,
      prompt: shots.prompt,
      motionScript: shots.motionScript,
      videoScript: shots.videoScript,
      cameraDirection: shots.cameraDirection,
      duration: shots.duration,
      sceneId: shots.sceneId,
      transitionIn: shots.transitionIn,
      transitionOut: shots.transitionOut,
    })
    .from(shots)
    .where(and(...whereConditions))
    .orderBy(asc(shots.sequence));

  const recommendations = recommendTransitions(shotRows);
  return NextResponse.json({ shots: shotRows.length, recommendations });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [ownerCheck] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!ownerCheck) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json()) as { episodeId?: string; confirm?: boolean };
  const episodeId = body?.episodeId;
  const confirm = body?.confirm === true;

  const whereConditions = [eq(shots.projectId, projectId)];
  if (episodeId) whereConditions.push(eq(shots.episodeId, episodeId));
  const shotRows = await db
    .select({
      id: shots.id,
      sequence: shots.sequence,
      prompt: shots.prompt,
      motionScript: shots.motionScript,
      videoScript: shots.videoScript,
      cameraDirection: shots.cameraDirection,
      duration: shots.duration,
      sceneId: shots.sceneId,
      transitionIn: shots.transitionIn,
      transitionOut: shots.transitionOut,
    })
    .from(shots)
    .where(and(...whereConditions))
    .orderBy(asc(shots.sequence));

  if (!confirm) {
    const recommendations = recommendTransitions(shotRows);
    return NextResponse.json({ shots: shotRows.length, recommendations, message: "Send confirm:true to apply" });
  }

  const recommendations = recommendTransitions(shotRows);
  const merged = mergeTransitions(shotRows, recommendations);

  for (const m of merged) {
    await db
      .update(shots)
      .set({ transitionIn: m.transitionIn, transitionOut: m.transitionOut })
      .where(eq(shots.id, m.id));
  }

  return NextResponse.json({ updated: merged.length, message: "Transitions applied" });
}
