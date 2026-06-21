import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { AgentSchema, parseOrThrow } from "@/lib/validation";

export async function GET(request: Request) {
  const userId = getUserIdFromRequest(request);
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.userId, userId));
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const userId = getUserIdFromRequest(request);
  const raw = await request.json();
  const body = parseOrThrow(AgentSchema, raw);

  const id = genId();
  const now = new Date();
  await db.insert(agents).values({
    id,
    userId,
    name: body.name,
    platform: body.platform as typeof agents.$inferInsert.platform,
    category: body.category as typeof agents.$inferInsert.category,
    appId: body.appId,
    apiKey: body.apiKey,
    description: body.description,
    createdAt: now,
    updatedAt: now,
  });

  const [created] = await db.select().from(agents).where(eq(agents.id, id));
  return NextResponse.json(created, { status: 201 });
}
