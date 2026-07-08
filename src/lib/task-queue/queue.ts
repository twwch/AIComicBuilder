import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { and, eq, asc, lt, sql } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import type { TaskType } from "./types";

const RUNNING_TASK_RECOVERY_STALE_MS = Math.max(
  60_000,
  Number.parseInt(process.env.TASK_RUNNING_RECOVERY_STALE_MS ?? "", 10) || 30 * 60_000,
);

export async function enqueueTask(params: {
  type: NonNullable<TaskType>;
  projectId?: string;
  payload?: unknown;
  maxRetries?: number;
  scheduledAt?: Date;
  episodeId?: string;
}) {
  const id = genId();
  const [task] = await db
    .insert(tasks)
    .values({
      id,
      type: params.type,
      projectId: params.projectId,
      payload: params.payload,
      maxRetries: params.maxRetries ?? 3,
      scheduledAt: params.scheduledAt,
      episodeId: params.episodeId ?? null,
    })
    .returning();
  return task;
}

export async function dequeueTask(): Promise<
  typeof tasks.$inferSelect | null
> {
  const now = new Date();

  // Atomic claim: UPDATE ... WHERE in a single statement to avoid race conditions.
  // Finds the first pending task that is either unscheduled or due, and atomically sets it to "running".
  const [task] = await db
    .update(tasks)
    .set({ status: "running", error: null })
    .where(
      eq(
        tasks.id,
        sql`(SELECT id FROM ${tasks} WHERE ${tasks.status} = 'pending' AND (${tasks.scheduledAt} IS NULL OR ${tasks.scheduledAt} <= ${now.getTime()}) ORDER BY ${tasks.createdAt} ASC LIMIT 1)`
      )
    )
    .returning();

  return task || null;
}

export async function recoverRunningTasks(staleMs = RUNNING_TASK_RECOVERY_STALE_MS) {
  const cutoff = new Date(Date.now() - staleMs);
  await db
    .update(tasks)
    .set({
      status: "pending",
      error: "Recovered from worker restart",
    })
    .where(and(eq(tasks.status, "running"), lt(tasks.createdAt, cutoff)));
}

export async function completeTask(id: string, result: unknown) {
  await db
    .update(tasks)
    .set({
      status: "completed",
      result: result as Record<string, unknown>,
    })
    .where(eq(tasks.id, id));
}

export async function failTask(id: string, error: string) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, id));

  if (!task) return;

  const newRetries = (task.retries ?? 0) + 1;
  const maxRetries = task.maxRetries ?? 3;

  if (newRetries < maxRetries) {
    await db
      .update(tasks)
      .set({
        status: "pending",
        retries: newRetries,
        error,
      })
      .where(eq(tasks.id, id));
  } else {
    await db
      .update(tasks)
      .set({
        status: "failed",
        retries: newRetries,
        error,
      })
      .where(eq(tasks.id, id));
  }
}

export async function getTasksByProject(projectId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.createdAt));
}
