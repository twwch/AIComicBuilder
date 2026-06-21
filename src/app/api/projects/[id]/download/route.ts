import { db } from "@/lib/db";
import { projects, shots, characters } from "@/lib/db/schema";
import { and, eq, asc } from "drizzle-orm";
import archiver from "archiver";
import path from "node:path";
import fs from "node:fs";
import { loadShotLegacyViewsBatch } from "@/lib/shot-asset-utils";
import { getUserIdFromRequest } from "@/lib/get-user-id";

const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [project] = userId
    ? await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    : [];

  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  const allShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0) {
    return new Response("No shots to download", { status: 400 });
  }

  const projectChars = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));

  const archive = archiver("zip", { zlib: { level: 5 } });
  const chunks: Uint8Array[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));

  // Helper: add file to archive if it exists and is within allowed directory
  function addFile(srcPath: string, archiveName: string) {
    const abs = path.resolve(srcPath);
    if (!abs.startsWith(uploadDir)) return false;
    if (fs.existsSync(abs)) {
      archive.file(abs, { name: archiveName });
      return true;
    }
    return false;
  }

  // 1. Character reference images
  for (const char of projectChars) {
    if (char.referenceImage) {
      const ext = path.extname(char.referenceImage) || ".png";
      const safeName = char.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_");
      addFile(char.referenceImage, `characters/${safeName}${ext}`);
    }
  }

  // 2. Shot assets (all types) — read from unified shot_assets table
  const legacyMap = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));
  for (const shot of allShots) {
    const prefix = `shot-${String(shot.sequence).padStart(2, "0")}`;
    const view = legacyMap.get(shot.id);
    if (!view) continue;

    if (view.firstFrame) {
      const ext = path.extname(view.firstFrame) || ".png";
      addFile(view.firstFrame, `${prefix}/first-frame${ext}`);
    }
    if (view.lastFrame) {
      const ext = path.extname(view.lastFrame) || ".png";
      addFile(view.lastFrame, `${prefix}/last-frame${ext}`);
    }
    if (view.videoUrl) {
      const ext = path.extname(view.videoUrl) || ".mp4";
      addFile(view.videoUrl, `${prefix}/video${ext}`);
    }
    if (view.sceneRefFrame) {
      const ext = path.extname(view.sceneRefFrame) || ".png";
      addFile(view.sceneRefFrame, `${prefix}/scene-frame${ext}`);
    }
    if (view.referenceVideoUrl) {
      const ext = path.extname(view.referenceVideoUrl) || ".mp4";
      addFile(view.referenceVideoUrl, `${prefix}/ref-video${ext}`);
    }
    let refIdx = 1;
    for (const ref of view.referenceImages) {
      if (ref.fileUrl) {
        const ext = path.extname(ref.fileUrl) || ".png";
        addFile(ref.fileUrl, `${prefix}/ref-${String(refIdx).padStart(2, "0")}${ext}`);
        refIdx++;
      }
    }
  }

  // 3. Final assembled video
  if (project.finalVideoUrl) {
    const ext = path.extname(project.finalVideoUrl) || ".mp4";
    addFile(project.finalVideoUrl, `final-video${ext}`);
  }

  await archive.finalize();

  const buffer = Buffer.concat(chunks);
  const safeName = (project.title || "project").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_");

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}-storyboard.zip"`,
    },
  });
}
