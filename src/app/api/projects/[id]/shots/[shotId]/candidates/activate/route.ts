import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shotAssets, shots, projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;
  const userId = getUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [shot] = await db
    .select({ id: shots.id })
    .from(shots)
    .where(and(eq(shots.id, shotId), eq(shots.projectId, projectId)));
  if (!shot) return NextResponse.json({ error: "Shot not found" }, { status: 404 });

  const { generationId } = await request.json();
  if (!generationId || typeof generationId !== "string") {
    return NextResponse.json({ error: "generationId is required" }, { status: 400 });
  }

  const targetAssets = await db
    .select()
    .from(shotAssets)
    .where(and(eq(shotAssets.shotId, shotId), eq(shotAssets.generationId, generationId)));

  if (targetAssets.length === 0) {
    return NextResponse.json({ error: `No assets found for generationId: ${generationId}` }, { status: 404 });
  }

  // Determine unique (type, sequenceInType) slots from target assets
  const slots = new Set<string>();
  for (const a of targetAssets) {
    slots.add(`${a.type}:${a.sequenceInType}`);
  }

  const now = new Date();

  // Deactivate current active assets in those slots, then activate the target's assets
  for (const slot of slots) {
    const [type, seqStr] = slot.split(":");
    const sequenceInType = parseInt(seqStr, 10);

    // Deactivate all currently active in this slot
    await db
      .update(shotAssets)
      .set({ isActive: 0, updatedAt: now })
      .where(
        and(
          eq(shotAssets.shotId, shotId),
          eq(shotAssets.type, type as any),
          eq(shotAssets.sequenceInType, sequenceInType),
          eq(shotAssets.isActive, 1)
        )
      );

    // Activate target asset for this slot
    const target = targetAssets.find(
      (a) => a.type === type && a.sequenceInType === sequenceInType
    );
    if (target) {
      await db
        .update(shotAssets)
        .set({ isActive: 1, updatedAt: now })
        .where(eq(shotAssets.id, target.id));
    }
  }

  return NextResponse.json({ success: true, activatedCount: targetAssets.length });
}
