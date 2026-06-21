/**
 * Manage `shot_assets` rows for a shot.
 *
 *   PUT /api/projects/[id]/shots/[shotId]/assets
 *   body: { items: Array<{
 *     id?: string;          // existing asset id; if absent → insert as new
 *     type: ShotAssetType;
 *     sequenceInType: number;
 *     prompt?: string;
 *     characters?: string[];
 *     fileUrl?: string | null;
 *     status?: "pending" | "generating" | "completed" | "failed";
 *   }> }
 *
 * Logic per type:
 *   - For each `type` group present in `items`, do a sync:
 *     • PATCH existing rows by id (prompt / characters / fileUrl / status)
 *     • INSERT new rows (when no matching id)
 *     • DELETE active rows of that type whose id is no longer in the list
 *
 *   The op is scoped per `type` so e.g. submitting only `reference` items
 *   does not touch the shot's `first_frame`/`last_frame` rows.
 *
 *   DELETE /api/projects/[id]/shots/[shotId]/assets/[assetId] is handled by
 *   the [assetId]/route.ts file (one row removal).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shotAssets, shots } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import type { ShotAssetType } from "@/lib/shot-asset-utils";

interface AssetPatchItem {
  id?: string;
  type: ShotAssetType;
  sequenceInType: number;
  prompt?: string;
  characters?: string[];
  fileUrl?: string | null;
  status?: "pending" | "generating" | "completed" | "failed";
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [shotRow] = await db
    .select({ id: shots.id })
    .from(shots)
    .where(and(eq(shots.id, shotId), eq(shots.projectId, projectId)));
  if (!shotRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await request.json()) as { items: AssetPatchItem[] };
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: "items must be an array" }, { status: 400 });
  }

  // Group submitted items by type
  const byType = new Map<ShotAssetType, AssetPatchItem[]>();
  for (const item of body.items) {
    if (!item.type) continue;
    if (!byType.has(item.type)) byType.set(item.type, []);
    byType.get(item.type)!.push(item);
  }

  const now = new Date();

  for (const [type, items] of byType) {
    // Pull all active rows of this type for this shot
    const existing = await db
      .select()
      .from(shotAssets)
      .where(
        and(
          eq(shotAssets.shotId, shotId),
          eq(shotAssets.type, type),
          eq(shotAssets.isActive, 1)
        )
      );

    const submittedIds = new Set(items.filter((i) => i.id).map((i) => i.id!));
    const deletableIds = existing
      .filter((r) => !submittedIds.has(r.id))
      .map((r) => r.id);

    // 1) Delete rows that are no longer in the submitted list
    if (deletableIds.length > 0) {
      await db.delete(shotAssets).where(inArray(shotAssets.id, deletableIds));
    }

    // 2) Patch + insert
    for (const item of items) {
      const existingRow = item.id ? existing.find((r) => r.id === item.id) : undefined;

      if (existingRow) {
        const update: Record<string, unknown> = { updatedAt: now };
        if (item.prompt !== undefined) update.prompt = item.prompt;
        if (item.characters !== undefined)
          update.characters = JSON.stringify(item.characters);
        if (item.fileUrl !== undefined) update.fileUrl = item.fileUrl;
        if (item.status !== undefined) update.status = item.status;
        if (item.sequenceInType !== existingRow.sequenceInType)
          update.sequenceInType = item.sequenceInType;
        await db
          .update(shotAssets)
          .set(update)
          .where(eq(shotAssets.id, existingRow.id));
      } else {
        await db.insert(shotAssets).values({
          id: item.id || genId(),
          shotId,
          type: item.type,
          sequenceInType: item.sequenceInType,
          assetVersion: 1,
          isActive: 1,
          prompt: item.prompt ?? "",
          fileUrl: item.fileUrl ?? null,
          status: item.status ?? "pending",
          characters: item.characters ? JSON.stringify(item.characters) : null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
