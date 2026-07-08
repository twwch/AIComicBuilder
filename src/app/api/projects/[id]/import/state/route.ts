import { NextResponse } from "next/server";
import { db, ensureImportStatesTable } from "@/lib/db";
import { importStates, projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

type ImportDraftState = {
  currentStep?: number;
  stepStatus?: unknown;
  fullText?: string;
  reviewIssues?: unknown;
  storyAnalysis?: unknown;
  characters?: unknown;
  items?: unknown;
  environments?: unknown;
  voices?: unknown;
  relationships?: unknown;
  episodes?: unknown;
  confirmedEpisodeIndexes?: unknown;
  shotReview?: unknown;
  enrichmentJobId?: unknown;
  intakeJobId?: unknown;
  confirmedScriptVersionId?: unknown;
  assetLibraryVersionId?: unknown;
};

async function assertProject(request: Request, projectId: string) {
  const userId = getUserIdFromRequest(request);
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return project ?? null;
}

function ensureDraftStateStorage() {
  ensureImportStatesTable();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  if (!(await assertProject(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureDraftStateStorage();

  const [state] = await db
    .select()
    .from(importStates)
    .where(eq(importStates.projectId, projectId));

  return NextResponse.json(state ?? null);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  if (!(await assertProject(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureDraftStateStorage();

  const body = (await request.json()) as ImportDraftState;
  const patch = {
    ...(typeof body.currentStep === "number" && { currentStep: body.currentStep }),
    ...(body.stepStatus !== undefined && { stepStatus: body.stepStatus }),
    ...(typeof body.fullText === "string" && { fullText: body.fullText }),
    ...(body.reviewIssues !== undefined && { reviewIssues: body.reviewIssues }),
    ...(body.storyAnalysis !== undefined && { storyAnalysis: body.storyAnalysis }),
    ...(body.characters !== undefined && { characters: body.characters }),
    ...(body.items !== undefined && { items: body.items }),
    ...(body.environments !== undefined && { environments: body.environments }),
    ...(body.voices !== undefined && { voices: body.voices }),
    ...(body.relationships !== undefined && { relationships: body.relationships }),
    ...(body.episodes !== undefined && { episodes: body.episodes }),
    ...(body.confirmedEpisodeIndexes !== undefined && {
      confirmedEpisodeIndexes: body.confirmedEpisodeIndexes,
    }),
    ...(body.shotReview !== undefined && { shotReview: body.shotReview }),
    ...((typeof body.enrichmentJobId === "string" || body.enrichmentJobId === null) && {
      enrichmentJobId: body.enrichmentJobId,
    }),
    ...((typeof body.intakeJobId === "string" || body.intakeJobId === null) && {
      intakeJobId: body.intakeJobId,
    }),
    ...((typeof body.confirmedScriptVersionId === "string" || body.confirmedScriptVersionId === null) && {
      confirmedScriptVersionId: body.confirmedScriptVersionId,
    }),
    ...((typeof body.assetLibraryVersionId === "string" || body.assetLibraryVersionId === null) && {
      assetLibraryVersionId: body.assetLibraryVersionId,
    }),
    updatedAt: new Date(),
  };

  await db
    .insert(importStates)
    .values({ projectId, ...patch })
    .onConflictDoUpdate({
      target: importStates.projectId,
      set: patch,
    });

  const [state] = await db
    .select()
    .from(importStates)
    .where(eq(importStates.projectId, projectId));

  return NextResponse.json(state);
}
