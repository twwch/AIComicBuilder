import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { resolveVideoProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { eq } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

export async function handleVideoGenerate(task: Task) {
  const payload = task.payload as { shotId: string; ratio?: string; modelConfig?: ModelConfigPayload };

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, payload.shotId));

  if (!shot) throw new Error("Shot not found");
  if (!shot.firstFrame || !shot.lastFrame) {
    throw new Error("Shot frames not generated yet");
  }

  const videoProvider = resolveVideoProvider(payload.modelConfig);

  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, payload.shotId));

  const prompt = shot.motionScript
    ? buildVideoPrompt({
        sceneDescription: shot.prompt || "",
        motionScript: shot.motionScript,
        cameraDirection: shot.cameraDirection || "static",
        duration: shot.duration ?? 10,
      })
    : shot.prompt || "";

  const videoPath = await videoProvider.generateVideo({
    firstFrame: shot.firstFrame,
    lastFrame: shot.lastFrame,
    prompt,
    duration: shot.duration ?? 10,
    ratio: payload.ratio,
  });

  await db
    .update(shots)
    .set({ videoUrl: videoPath, status: "completed" })
    .where(eq(shots.id, payload.shotId));

  return { videoPath };
}
