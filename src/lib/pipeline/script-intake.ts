import type { Task } from "@/lib/task-queue";
import { runScriptIntakeJob } from "@/lib/script-intake/intake-job-runner";

export async function handleScriptIntake(task: Task) {
  const payload = task.payload && typeof task.payload === "object"
    ? task.payload as { jobId?: string }
    : {};
  if (!payload.jobId) {
    throw new Error("script_intake task missing jobId");
  }
  return runScriptIntakeJob(payload.jobId);
}
