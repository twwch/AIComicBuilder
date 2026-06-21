import { NextResponse } from "next/server";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { getProjectReadiness, readinessSummary } from "@/lib/shot-readiness";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await assertProjectOwnership(req, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const episodeId = searchParams.get("episodeId") ?? undefined;

  const entries = await getProjectReadiness(id, episodeId);
  const summary = readinessSummary(entries);

  return NextResponse.json({ entries, summary });
}
