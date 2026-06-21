import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, shots, characters, episodeCharacters } from "@/lib/db/schema";
import { eq, asc, and, max, isNotNull, inArray } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { EpisodeCreateSchema, parseOrThrow } from "@/lib/validation";

async function resolveProject(id: string, userId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return project ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allEpisodes = await db
    .select()
    .from(episodes)
    .where(eq(episodes.projectId, id))
    .orderBy(asc(episodes.sequence));

  // Enrich each episode with preview images for cards
  const enriched = await Promise.all(
    allEpisodes.map(async (ep) => {
      if (ep.finalVideoUrl) return { ...ep, previewImages: [] };

      // 1) Collect frame images from shot_assets, deduplicated
      const epShots = await db
        .select({ id: shots.id })
        .from(shots)
        .where(eq(shots.episodeId, ep.id));
      const { loadShotLegacyViewsBatch } = await import("@/lib/shot-asset-utils");
      const legacy = await loadShotLegacyViewsBatch(epShots.map((s) => s.id));

      const frameSet = new Set<string>();
      const isReference = ep.generationMode === "reference";
      for (const s of epShots) {
        const view = legacy.get(s.id);
        if (!view) continue;
        if (isReference) {
          if (view.sceneRefFrame) frameSet.add(view.sceneRefFrame);
        } else {
          if (view.firstFrame) frameSet.add(view.firstFrame);
          if (view.lastFrame) frameSet.add(view.lastFrame);
        }
      }

      if (frameSet.size > 0) {
        return { ...ep, previewImages: [...frameSet] };
      }

      // 2) Fall back to character reference images linked to this episode
      const linkedCharIds = await db
        .select({ characterId: episodeCharacters.characterId })
        .from(episodeCharacters)
        .where(eq(episodeCharacters.episodeId, ep.id));

      let charUrls: string[] = [];
      if (linkedCharIds.length > 0) {
        const charImages = await db
          .select({ referenceImage: characters.referenceImage })
          .from(characters)
          .where(
            and(
              inArray(characters.id, linkedCharIds.map((r) => r.characterId)),
              isNotNull(characters.referenceImage)
            )
          );
        charUrls = charImages.map((c) => c.referenceImage!).filter(Boolean);
      }

      return { ...ep, previewImages: charUrls };
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await request.json();
  const body = parseOrThrow(EpisodeCreateSchema, raw);

  // Get the max sequence number for this project
  const [result] = await db
    .select({ maxSeq: max(episodes.sequence) })
    .from(episodes)
    .where(eq(episodes.projectId, id));

  const nextSequence = (result?.maxSeq ?? 0) + 1;

  const [episode] = await db
    .insert(episodes)
    .values({
      id: genId(),
      projectId: id,
      title: body.title,
      description: body.description || "",
      keywords: body.keywords || "",
      sequence: nextSequence,
    })
    .returning();

  return NextResponse.json(episode, { status: 201 });
}
