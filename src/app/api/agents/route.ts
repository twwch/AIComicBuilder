import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { getUserIdFromRequest } from "@/lib/get-user-id";

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
  const body = (await request.json()) as {
    name: string;
    platform?: string;
    category: string;
    appId: string;
    apiKey: string;
    description?: string;
  };

  if (!body.name || !body.category || !body.appId || !body.apiKey) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const validCategories = ["script_outline", "script_generate", "script_parse", "script_visual_enrichment", "character_extract", "shot_split", "keyframe_prompts", "video_prompts", "ref_image_prompts", "ref_video_prompts"];
  if (!validCategories.includes(body.category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const id = genId();
  const now = new Date();
  await db.insert(agents).values({
    id,
    userId,
    name: body.name,
    platform: (body.platform || "bailian") as typeof agents.$inferInsert.platform,
    category: body.category as typeof agents.$inferInsert.category,
    appId: body.appId,
    apiKey: body.apiKey,
    description: body.description || "",
    createdAt: now,
    updatedAt: now,
  });

  const [created] = await db.select().from(agents).where(eq(agents.id, id));
  return NextResponse.json(created, { status: 201 });
}
