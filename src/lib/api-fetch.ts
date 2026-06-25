export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const GENERATION_TASK_TIMEOUT_MS = 180_000;

export interface ApiTask {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
  error?: string | null;
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.clone().json();
      if (body.error) message = body.error;
    } catch {}
    throw new ApiError(response.status, message);
  }
  return response;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForTask(
  taskId: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ApiTask> {
  const timeoutMs = options.timeoutMs ?? GENERATION_TASK_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? 2_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await apiFetch(`/api/tasks/${taskId}`);
    const task = (await response.json()) as ApiTask;

    if (task.status === "completed") {
      return task;
    }

    if (task.status === "failed") {
      throw new ApiError(500, task.error || "Task failed");
    }

    await sleep(intervalMs);
  }

  throw new ApiError(408, "Generation timed out after 3 minutes");
}

export async function waitForTasks(
  taskIds: string[],
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ApiTask[]> {
  return Promise.all(taskIds.map((taskId) => waitForTask(taskId, options)));
}
