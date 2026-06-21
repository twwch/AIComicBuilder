import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";

const EMOTION_PROMPT = `Analyze these shot descriptions from a screenplay and rate each for tension and emotional intensity on a 0-100 scale.

Shots:
{shots}

Output ONLY valid JSON array (no markdown):
[{"shotSequence": 1, "tension": 50, "emotion": 60}, ...]

Guidelines:
- tension: 0=calm/peaceful, 50=mild conflict, 100=peak crisis
- emotion: 0=neutral, 50=moderate feeling, 100=overwhelming emotion`;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await assertProjectOwnership(req, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();

  if (!body.modelConfig?.text) {
    return NextResponse.json({ error: "modelConfig.text is required for emotion analysis" }, { status: 400 });
  }

  const allShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, id))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0) {
    return NextResponse.json({ scores: [] });
  }

  const provider = resolveAIProvider(body.modelConfig);

  const shotsText = allShots
    .map((s) => `Shot ${s.sequence}: ${s.prompt || s.motionScript || ""}`)
    .join("\n");

  try {
    const result = await provider.generateText(
      EMOTION_PROMPT.replace("{shots}", shotsText)
    );
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return NextResponse.json({ scores: [] });
    const scores = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ scores });
  } catch {
    return NextResponse.json({ scores: [] });
  }
}
