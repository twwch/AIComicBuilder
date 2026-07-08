import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildScriptParsePrompt } from "@/lib/ai/prompts/script-parse";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

export async function handleScriptParse(task: Task) {
  const payload = task.payload as { projectId: string; modelConfig?: ModelConfigPayload; userId?: string };
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, payload.projectId));

  if (!project || !project.script) {
    throw new Error("Project or script not found");
  }

  const systemPrompt = await resolvePrompt("script_parse", {
    userId: payload.userId ?? "",
    projectId: payload.projectId,
  });

  const ai = resolveAIProvider(payload.modelConfig);
  const result = await ai.generateText(buildScriptParsePrompt(project.script), {
    systemPrompt,
    temperature: 0.7,
  });

  const screenplay = JSON.parse(result);

  await db
    .update(projects)
    .set({ updatedAt: new Date() })
    .where(eq(projects.id, payload.projectId));

  return screenplay;
}
