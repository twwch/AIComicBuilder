import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, tasks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { GenerateRequestSchema, parseOrThrow } from "@/lib/validation";
import { rateLimitMiddleware } from "@/lib/rate-limit";
import type { ModelConfig } from "@/lib/generate-utils";
import { summarizeProviderConfig } from "@/lib/generate-utils";
import { dispatchAction } from "@/lib/pipeline/handlers";
import { createTask, failTask } from "@/lib/task-utils";

export const maxDuration = 1800;

const _rateLimit = rateLimitMiddleware({ windowMs: 60_000, maxRequests: 20 });

const BATCH_ACTIONS = new Set(["batch_frame_generate", "batch_video_generate", "batch_reference_video", "generate_keyframe_prompts", "batch_video_prompt", "video_assemble", "shot_split", "batch_character_image", "batch_ref_image_generate", "generate_ref_prompts", "batch_scene_frame"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = _rateLimit(request);
  if (blocked) return blocked;

  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [ownerCheck] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!ownerCheck) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await request.json();
  const parsed = parseOrThrow(GenerateRequestSchema, raw);
  const { action, payload, episodeId } = parsed;
  const modelConfig = parsed.modelConfig as ModelConfig | undefined;
  console.log(`[Generate] action=${action}, projectId=${projectId}, episodeId=${episodeId || "none"}`);
  console.log("[Generate] modelConfig", {
    text: summarizeProviderConfig(modelConfig?.text),
    image: summarizeProviderConfig(modelConfig?.image),
    video: summarizeProviderConfig(modelConfig?.video),
  });

  if (BATCH_ACTIONS.has(action)) {
    const [existing] = await db
      .select({ id: tasks.id, type: tasks.type, status: tasks.status, createdAt: tasks.createdAt })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.status, "running")));
    if (existing) {
      return NextResponse.json(
        { error: `已有进行中的任务 (${existing.type})，请等待完成后再试`, existingTaskId: existing.id },
        { status: 409 }
      );
    }

    const task = await createTask(projectId, action, payload ?? {}, episodeId);
    const bg = dispatchAction(action, projectId, userId, payload, modelConfig, episodeId, task.id);
    if (bg) bg.catch((err) => {
      console.error(`[Generate] Background task ${task.id} failed:`, err);
      failTask(task.id, (err as Error)?.message || "Unknown error");
    });
    return NextResponse.json({ taskId: task.id });
  }

  const handler = dispatchAction(action, projectId, userId, payload, modelConfig, episodeId);
  if (!handler) {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
  return handler;
}

