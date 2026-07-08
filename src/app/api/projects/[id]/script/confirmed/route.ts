import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { db, ensureScriptIntakeTables } from "@/lib/db";
import { confirmedScriptVersions } from "@/lib/db/schema";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureScriptIntakeTables();
  const rows = await db
    .select({
      id: confirmedScriptVersions.id,
      scriptId: confirmedScriptVersions.scriptId,
      intakeJobId: confirmedScriptVersions.intakeJobId,
      versionNum: confirmedScriptVersions.versionNum,
      title: confirmedScriptVersions.title,
      language: confirmedScriptVersions.language,
      contentHash: confirmedScriptVersions.contentHash,
      content: confirmedScriptVersions.content,
      structureJson: confirmedScriptVersions.structureJson,
      reviewSummary: confirmedScriptVersions.reviewSummary,
      status: confirmedScriptVersions.status,
      createdAt: confirmedScriptVersions.createdAt,
    })
    .from(confirmedScriptVersions)
    .where(eq(confirmedScriptVersions.projectId, projectId))
    .orderBy(desc(confirmedScriptVersions.versionNum), desc(confirmedScriptVersions.createdAt));

  return NextResponse.json({
    active: rows.find((row) => row.status === "active") ?? null,
    versions: rows,
  });
}
