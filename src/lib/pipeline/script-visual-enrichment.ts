import type { Task } from "@/lib/task-queue";
import { runScriptEnrichmentJob } from "@/lib/script-enrichment/enrichment-job-runner";

export async function handleScriptVisualEnrichment(task: Task) {
  const payload = task.payload && typeof task.payload === "object"
    ? task.payload as { jobId?: string }
    : {};
  if (!payload.jobId) {
    throw new Error("script_visual_enrichment task missing jobId");
  }
  return runScriptEnrichmentJob(payload.jobId);
}
