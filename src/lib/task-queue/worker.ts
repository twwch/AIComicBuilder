import { dequeueTask, completeTask, failTask, recoverRunningTasks } from "./queue";
import type { TaskHandlerMap, Task } from "./types";

const POLL_INTERVAL_MS = 2000;

let isRunning = false;
let activeCount = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let handlers: TaskHandlerMap = {};

function getWorkerConcurrency() {
  const parsed = Number.parseInt(process.env.TASK_WORKER_CONCURRENCY ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
}

export function registerHandlers(newHandlers: TaskHandlerMap) {
  handlers = { ...handlers, ...newHandlers };
}

async function processTask(task: Task) {
  const handler = task.type ? handlers[task.type] : undefined;
  if (!handler) {
    await failTask(task.id, `No handler registered for task type: ${task.type}`);
    return;
  }

  try {
    const result = await handler(task);
    await completeTask(task.id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failTask(task.id, message);
  }
}

async function poll() {
  if (!isRunning) return;

  try {
    const concurrency = getWorkerConcurrency();

    while (isRunning && activeCount < concurrency) {
      const task = await dequeueTask();
      if (!task) break;

      activeCount += 1;
      void processTask(task)
        .catch((err) => {
          console.error("[TaskWorker] Process error:", err);
        })
        .finally(() => {
          activeCount = Math.max(0, activeCount - 1);
          if (isRunning) schedulePoll(0);
        });
    }
  } catch (err) {
    console.error("[TaskWorker] Poll error:", err);
  }

  if (isRunning) schedulePoll(POLL_INTERVAL_MS);
}

function schedulePoll(delayMs: number) {
  if (pollTimer) return;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    poll();
  }, delayMs);
}

export function startWorker() {
  if (isRunning) return;
  isRunning = true;
  console.log(
    "[TaskWorker] Started polling every",
    POLL_INTERVAL_MS,
    "ms with concurrency",
    getWorkerConcurrency(),
  );
  void recoverRunningTasks()
    .catch((err) => {
      console.error("[TaskWorker] Recover running tasks error:", err);
    })
    .finally(() => {
      poll();
    });
}

export function stopWorker() {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log("[TaskWorker] Stopped");
}
