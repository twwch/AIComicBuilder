import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { agentBindings, agents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";

const VALID_CATEGORIES = [
  "script_outline",
  "script_generate",
  "script_parse",
  "character_extract",
  "shot_split",
  "keyframe_prompts",
  "video_prompts",
  "ref_image_prompts",
  "ref_video_prompts",
] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bindings = await db
    .select({
      id: agentBindings.id,
      projectId: agentBindings.projectId,
      category: agentBindings.category,
      agentId: agentBindings.agentId,
      agentName: agents.name,
    })
    .from(agentBindings)
    .leftJoin(agents, eq(agentBindings.agentId, agents.id))
    .where(eq(agentBindings.projectId, projectId));
  return NextResponse.json(bindings);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const project = await assertProjectOwnership(request, projectId);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    category: string;
    agentId: string | null;
  };

  if (!(VALID_CATEGORIES as readonly string[]).includes(body.category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  if (!body.agentId) {
    await db
      .delete(agentBindings)
      .where(
        and(
          eq(agentBindings.projectId, projectId),
          eq(agentBindings.category, body.category as typeof agentBindings.$inferInsert.category),
        ),
      );
    return NextResponse.json({ ok: true });
  }

  const [ownedAgent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, body.agentId), eq(agents.userId, project.userId)));
  if (!ownedAgent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const [existing] = await db
    .select()
    .from(agentBindings)
    .where(
      and(
        eq(agentBindings.projectId, projectId),
        eq(agentBindings.category, body.category as typeof agentBindings.$inferInsert.category),
      ),
    );

  if (existing) {
    await db
      .update(agentBindings)
      .set({ agentId: body.agentId })
      .where(eq(agentBindings.id, existing.id));
  } else {
    await db.insert(agentBindings).values({
      id: genId(),
      projectId,
      category: body.category as typeof agentBindings.$inferInsert.category,
      agentId: body.agentId,
    });
  }

  return NextResponse.json({ ok: true });
}
