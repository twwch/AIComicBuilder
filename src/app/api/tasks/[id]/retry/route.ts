import { NextResponse } from "next/server";
import { retryTask } from "@/lib/task-utils";
import { dispatchAction } from "@/lib/pipeline/handlers";
import { db } from "@/lib/db";
import { tasks, projects } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [row] = await db
    .select({ task: tasks })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, id), eq(projects.userId, userId)));

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const originalTask = row.task;
  if (originalTask.status !== "failed" && originalTask.status !== "cancelled") {
    return NextResponse.json({ error: `任务状态 ${originalTask.status} 不允许重试` }, { status: 400 });
  }

  const updatedRow = await retryTask(id);
  dispatchAction(
    updatedRow.type,
    updatedRow.projectId!,
    userId,
    updatedRow.payload as Record<string, unknown> | undefined,
    undefined,
    updatedRow.episodeId ?? undefined,
    id,
  );

  return NextResponse.json({ retried: true, taskId: id, action: updatedRow.type });
}
