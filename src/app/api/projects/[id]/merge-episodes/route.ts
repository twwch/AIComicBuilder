import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { episodes, projects } from "@/lib/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { assembleVideo } from "@/lib/video/ffmpeg";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { MergeEpisodesSchema, parseOrThrow } from "@/lib/validation";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(req);

  // Verify project ownership
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const raw = await req.json();
  const body = parseOrThrow(MergeEpisodesSchema, raw);
  const { episodeIds } = body;

  // Fetch episodes, verify ownership and finalVideoUrl
  const selectedEpisodes = await db
    .select()
    .from(episodes)
    .where(
      and(
        eq(episodes.projectId, projectId),
        inArray(episodes.id, episodeIds)
      )
    )
    .orderBy(asc(episodes.sequence));

  if (selectedEpisodes.length !== episodeIds.length) {
    return NextResponse.json(
      { error: "Some episodes not found" },
      { status: 400 }
    );
  }

  const missingVideo = selectedEpisodes.find((e) => !e.finalVideoUrl);
  if (missingVideo) {
    return NextResponse.json(
      { error: `Episode "${missingVideo.title}" has no video` },
      { status: 400 }
    );
  }

  try {
    const videoPaths = selectedEpisodes.map((e) => e.finalVideoUrl!);
    const result = await assembleVideo({
      videoPaths,
      subtitles: [],
      projectId,
      shotDurations: [],
    });

    return NextResponse.json({ videoUrl: result.videoPath, status: "ok" });
  } catch (err) {
    console.error("[MergeEpisodes] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Merge failed" },
      { status: 500 }
    );
  }
}
