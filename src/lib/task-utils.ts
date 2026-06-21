import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { registerTask, unregisterTask } from "@/lib/task-registry";
import { emitTaskEvent, removeAllTaskListeners } from "@/lib/task-events";

export interface BatchProgress {
  total: number;
  completed: number;
  failed: string[];
}

export type TaskRow = typeof tasks.$inferSelect;

export async function createTask(projectId: string, type: string, payload?: Record<string, unknown>, episodeId?: string): Promise<{ id: string }> {
  const taskId = genId();
  await db.insert(tasks).values({
    id: taskId,
    projectId,
    type: type as any,
    status: "running",
    result: {},
    payload: payload ?? {},
    episodeId,
  });
  return { id: taskId };
}

export function updateTaskProgress(taskId: string, progress: BatchProgress) {
  emitTaskEvent(taskId, "progress", { progress: progress as any });
  db.update(tasks)
    .set({ result: progress as any })
    .where(eq(tasks.id, taskId))
    .then();
}

export function completeTask(taskId: string, result?: any) {
  removeAllTaskListeners(taskId);
  unregisterTask(taskId);
  emitTaskEvent(taskId, "complete", { result: result ?? {} });
  db.update(tasks)
    .set({ status: "completed", result: result ?? {} })
    .where(eq(tasks.id, taskId))
    .then();
}

export function failTask(taskId: string, error: string) {
  removeAllTaskListeners(taskId);
  unregisterTask(taskId);
  emitTaskEvent(taskId, "fail", { error });
  db.update(tasks)
    .set({ status: "failed", error })
    .where(eq(tasks.id, taskId))
    .then();
}

export function cancelTask(taskId: string, reason?: string) {
  removeAllTaskListeners(taskId);
  unregisterTask(taskId);
  emitTaskEvent(taskId, "fail", { error: reason ?? "任务已被用户取消" });
  db.update(tasks)
    .set({ status: "cancelled", error: reason ?? "任务已被用户取消" })
    .where(eq(tasks.id, taskId))
    .then();
}

export async function retryTask(taskId: string) {
  const [row] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!row) throw new Error("任务不存在");
  if (row.status !== "failed" && row.status !== "cancelled") {
    throw new Error(`任务状态 ${row.status} 不允许重试`);
  }
  await db
    .update(tasks)
    .set({ status: "running", error: null, retries: (row.retries ?? 0) + 1 })
    .where(eq(tasks.id, taskId));
  return row;
}

/** Wraps a handler with automatic retry when the task fails. */ 
export function wrapWithRetry(
  taskId: string,
  fn: (signal: AbortSignal) => Promise<void>,
  maxRetries = 3,
): { signal: AbortSignal } {
  const ac = registerTask(taskId);
  const attempt = async (retryCount: number) => {
    try {
      await fn(ac.signal);
      completeTask(taskId);
    } catch (err: any) {
      if (err?.name === "AbortError" || ac.signal.aborted) {
        cancelTask(taskId, "任务已被取消");
        return;
      }
      if (retryCount < maxRetries) {
        attempt(retryCount + 1);
      } else {
        failTask(taskId, err?.message ?? String(err));
      }
    }
  };
  attempt(0);
  return { signal: ac.signal };
}
