import { and, desc, eq } from "drizzle-orm";
import { db, ensureScriptIntakeTables } from "@/lib/db";
import { confirmedScriptVersions } from "@/lib/db/schema";

export async function loadConfirmedScriptVersion(
  projectId: string,
  versionId?: string | null,
) {
  ensureScriptIntakeTables();

  const where = versionId
    ? and(
        eq(confirmedScriptVersions.projectId, projectId),
        eq(confirmedScriptVersions.id, versionId),
      )
    : and(
        eq(confirmedScriptVersions.projectId, projectId),
        eq(confirmedScriptVersions.status, "active"),
      );

  const [version] = await db
    .select()
    .from(confirmedScriptVersions)
    .where(where)
    .orderBy(desc(confirmedScriptVersions.versionNum), desc(confirmedScriptVersions.createdAt))
    .limit(1);

  return version ?? null;
}

export async function requireConfirmedScriptVersion(
  projectId: string,
  versionId?: string | null,
) {
  const version = await loadConfirmedScriptVersion(projectId, versionId);
  if (!version) {
    const error = new Error("Asset extraction requires a confirmed_script_version");
    error.name = "ConfirmedScriptVersionRequiredError";
    throw error;
  }
  return version;
}
