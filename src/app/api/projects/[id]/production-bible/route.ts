import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { productionBibles } from "@/lib/db/schema";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import {
  createAndActivateProductionBible,
  generateProductionBible,
  getActiveProductionBible,
  listProductionBibles,
  type ProductionBibleDraft,
} from "@/lib/production-bible";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";

function normalizeEpisodeId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDraft(value: unknown): ProductionBibleDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<ProductionBibleDraft>;
  return {
    title: String(draft.title || "生产设定库").trim(),
    worldSetting: String(draft.worldSetting || "").trim(),
    visualStyle: String(draft.visualStyle || "").trim(),
    eraConstraints: String(draft.eraConstraints || "").trim(),
    locationRules: String(draft.locationRules || "").trim(),
    characterRules: String(draft.characterRules || "").trim(),
    sceneRules: String(draft.sceneRules || "").trim(),
    propRules: String(draft.propRules || "").trim(),
    positivePromptTemplate: String(draft.positivePromptTemplate || "").trim(),
    negativePromptTemplate: String(draft.negativePromptTemplate || "").trim(),
    complianceRules: String(draft.complianceRules || "").trim(),
    metadata: draft.metadata && typeof draft.metadata === "object" ? draft.metadata : {},
  };
}

async function activateProductionBible(projectId: string, bibleId: string) {
  const [target] = await db
    .select()
    .from(productionBibles)
    .where(and(eq(productionBibles.id, bibleId), eq(productionBibles.projectId, projectId)));

  if (!target) return null;

  const now = new Date();
  await db
    .update(productionBibles)
    .set({ isActive: 0, status: "archived", updatedAt: now })
    .where(
      target.episodeId
        ? and(eq(productionBibles.projectId, projectId), eq(productionBibles.episodeId, target.episodeId))
        : and(eq(productionBibles.projectId, projectId), isNull(productionBibles.episodeId)),
    );

  await db
    .update(productionBibles)
    .set({ isActive: 1, status: "active", updatedAt: now })
    .where(eq(productionBibles.id, bibleId));

  const [activated] = await db.select().from(productionBibles).where(eq(productionBibles.id, bibleId));
  return activated ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const episodeId = normalizeEpisodeId(url.searchParams.get("episodeId"));
  const active = await getActiveProductionBible(projectId, episodeId);
  const bibles = await listProductionBibles(projectId, episodeId);

  return NextResponse.json({ active, bibles });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    episodeId?: unknown;
    sourceScriptId?: unknown;
    draft?: unknown;
    modelConfig?: ModelConfigPayload;
  };
  const episodeId = normalizeEpisodeId(body.episodeId);
  const draft = normalizeDraft(body.draft);

  const bible = draft
    ? await createAndActivateProductionBible({
        projectId,
        episodeId,
        sourceScriptId: typeof body.sourceScriptId === "string" ? body.sourceScriptId : null,
        draft,
        status: "active",
      })
    : await generateProductionBible({
        projectId,
        episodeId,
        modelConfig: body.modelConfig,
      });

  return NextResponse.json({ bible }, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    activateId?: unknown;
    episodeId?: unknown;
    sourceScriptId?: unknown;
    draft?: unknown;
  };

  const activateId = typeof body.activateId === "string" ? body.activateId : typeof body.id === "string" ? body.id : "";
  if (activateId) {
    const activated = await activateProductionBible(projectId, activateId);
    if (!activated) return NextResponse.json({ error: "Production Bible not found" }, { status: 404 });
    return NextResponse.json({ bible: activated });
  }

  const draft = normalizeDraft(body.draft);
  if (!draft) {
    return NextResponse.json({ error: "Missing draft or activateId" }, { status: 400 });
  }

  const bible = await createAndActivateProductionBible({
    projectId,
    episodeId: normalizeEpisodeId(body.episodeId),
    sourceScriptId: typeof body.sourceScriptId === "string" ? body.sourceScriptId : null,
    draft,
    status: "active",
  });

  return NextResponse.json({ bible });
}
