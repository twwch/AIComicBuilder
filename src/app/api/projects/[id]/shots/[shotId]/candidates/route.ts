import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shotAssets, shots, projects } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

export async function GET(
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

  const rows = await db
    .select()
    .from(shotAssets)
    .where(eq(shotAssets.shotId, shotId))
    .orderBy(shotAssets.generationId, shotAssets.type, shotAssets.sequenceInType);

  const groups = new Map<string, typeof rows>();
  const activeMap = new Map<string, typeof rows[0]>(); // type:seq → active row

  for (const row of rows) {
    const gid = row.generationId ?? `ungrouped_${row.id}`;
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid)!.push(row);
    if (row.isActive === 1) {
      const key = `${row.type}:${row.sequenceInType}`;
      activeMap.set(key, row);
    }
  }

  const candidates = [...groups.entries()].map(([gid, assets]) => ({
    generationId: gid,
    createdAt: assets[0].createdAt,
    assetCount: assets.length,
    assets: assets.map((a) => ({
      id: a.id,
      type: a.type,
      sequenceInType: a.sequenceInType,
      assetVersion: a.assetVersion,
      isActive: a.isActive,
      prompt: a.prompt,
      fileUrl: a.fileUrl,
      status: a.status,
    })),
    isActive: assets.some((a) => a.isActive === 1),
  }));

  candidates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ candidates, activeAssets: Object.fromEntries(activeMap) });
}
