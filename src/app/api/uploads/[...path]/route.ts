import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  characters,
  episodes,
  projects,
  shotAssets,
  shots,
} from "@/lib/db/schema";
import { getUserIdFromRequest } from "@/lib/get-user-id";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function normalizeForDb(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function escapeLike(input: string) {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function canAccessUpload(userId: string, normalizedPath: string) {
  const historyPattern = `%\"${escapeLike(normalizedPath)}\"%`;

  const [ownedCharacter] = await db
    .select({ id: characters.id })
    .from(characters)
    .innerJoin(projects, eq(characters.projectId, projects.id))
    .where(
      and(
        eq(projects.userId, userId),
        or(
          eq(characters.referenceImage, normalizedPath),
          sql`${characters.referenceImageHistory} LIKE ${historyPattern} ESCAPE '\\'`,
        ),
      ),
    )
    .limit(1);
  if (ownedCharacter) return true;

  const [ownedShotAsset] = await db
    .select({ id: shotAssets.id })
    .from(shotAssets)
    .innerJoin(shots, eq(shotAssets.shotId, shots.id))
    .innerJoin(projects, eq(shots.projectId, projects.id))
    .where(
      and(
        eq(projects.userId, userId),
        eq(shotAssets.fileUrl, normalizedPath),
      ),
    )
    .limit(1);
  if (ownedShotAsset) return true;

  const [ownedProjectVideo] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.userId, userId),
        eq(projects.finalVideoUrl, normalizedPath),
      ),
    )
    .limit(1);
  if (ownedProjectVideo) return true;

  const [ownedEpisodeVideo] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(projects, eq(episodes.projectId, projects.id))
    .where(
      and(
        eq(projects.userId, userId),
        eq(episodes.finalVideoUrl, normalizedPath),
      ),
    )
    .limit(1);

  return Boolean(ownedEpisodeVideo);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const filePath = path.join(uploadDir, ...segments);

  // Prevent directory traversal
  const resolved = path.resolve(filePath);
  const resolvedUploadDir = path.resolve(uploadDir);
  if (!resolved.startsWith(resolvedUploadDir)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const normalizedPath = normalizeForDb(path.relative(process.cwd(), resolved));
  const allowed = await canAccessUpload(userId, normalizedPath);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const buffer = fs.readFileSync(resolved);

  return new NextResponse(buffer, {
    headers: { "Content-Type": contentType },
  });
}
