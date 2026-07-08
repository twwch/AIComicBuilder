import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, ensureImportStatesTable, ensureStoryPipelineTables } from "@/lib/db";
import { importStates, projects, scriptChunks, scripts } from "@/lib/db/schema";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog, extractTextFromFile } from "@/lib/import-utils";
import { id as genId } from "@/lib/id";
import { structureScriptText } from "@/lib/script-structure";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  ensureImportStatesTable();
  ensureStoryPipelineTables();

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }

  await addImportLog(projectId, 1, "running", `开始解析文件：${file.name}`);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const rawText = await extractTextFromFile(buffer, file.name);
    const structured = structureScriptText(rawText);
    const text = structured.cleanedText;

    if (!text.trim()) {
      await addImportLog(projectId, 1, "error", "文件内容为空");
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }

    const scriptId = genId();
    const sourceType = file.name.split(".").pop()?.toLowerCase() || "";
    const contentHash = createHash("sha256").update(text).digest("hex");

    await db.insert(scripts).values({
      id: scriptId,
      projectId,
      title: file.name.replace(/\.[^.]+$/, ""),
      sourceFilename: file.name,
      sourceType,
      language: structured.summary.language,
      contentHash,
      rawText,
      cleanedText: text,
      status: "chunked",
      metadata: structured.summary,
    });

    if (structured.chunks.length > 0) {
      await db.insert(scriptChunks).values(
        structured.chunks.map((chunk) => ({
          id: genId(),
          scriptId,
          projectId,
          chunkIndex: chunk.chunkIndex,
          episodeIndex: chunk.episodeIndex,
          sceneIndex: chunk.sceneIndex,
          text: chunk.text,
          startIndex: chunk.startIndex,
          endIndex: chunk.endIndex,
          overlapBefore: chunk.overlapBefore,
          overlapAfter: chunk.overlapAfter,
          status: "pending" as const,
          metadata: {
            ...chunk.metadata,
            localChunkId: chunk.id,
          },
        }))
      );
    }

    await db
      .update(projects)
      .set({ script: text, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    const importStoryAnalysis = {
      scriptId,
      episodes: structured.episodes,
      scenes: structured.scenes,
      chunks: structured.chunks,
      summary: structured.summary,
    };

    await db
      .insert(importStates)
      .values({
        projectId,
        currentStep: 1,
        fullText: text,
        storyAnalysis: importStoryAnalysis,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: importStates.projectId,
        set: {
          currentStep: 1,
          fullText: text,
          storyAnalysis: importStoryAnalysis,
          updatedAt: new Date(),
        },
      });

    await addImportLog(projectId, 1, "done", `解析完成：${text.length} 字，${structured.chunks.length} 个分块`, {
      scriptId,
      charCount: text.length,
      chunkCount: structured.chunks.length,
      episodeCount: structured.episodes.length,
      sceneCount: structured.scenes.length,
      summary: structured.summary,
      episodes: structured.episodes,
      scenes: structured.scenes,
      text,
    });

    return NextResponse.json({
      text,
      rawText,
      scriptId,
      charCount: text.length,
      episodes: structured.episodes,
      scenes: structured.scenes,
      chunks: structured.chunks,
      summary: structured.summary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Parse failed";
    await addImportLog(projectId, 1, "error", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
