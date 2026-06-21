import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { AgentUpdateSchema, parseOrThrow } from "@/lib/validation";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const raw = await request.json();
  const body = parseOrThrow(AgentUpdateSchema, raw);

  const [existing] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.userId, userId)));

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .update(agents)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.category !== undefined && { category: body.category as typeof agents.$inferInsert.category }),
      ...(body.appId !== undefined && { appId: body.appId }),
      ...(body.apiKey !== undefined && { apiKey: body.apiKey }),
      ...(body.description !== undefined && { description: body.description }),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, id));

  const [updated] = await db.select().from(agents).where(eq(agents.id, id));
  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);

  const [existing] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.userId, userId)));

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(agents).where(eq(agents.id, id));
  return NextResponse.json({ ok: true });
}
