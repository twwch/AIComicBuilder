import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import type { Task } from "@/lib/task-queue";
import { getActiveAsset, insertAssetVersion, patchAsset } from "@/lib/shot-asset-utils";
import {
  buildStoryboardPromptForShotSpec,
  upsertShotSpecFromShot,
} from "@/lib/story-pipeline-utils";

export async function handleFrameGenerate(task: Task) {
  const payload = task.payload as {
    shotId: string;
    projectId: string;
    userId?: string;
    modelConfig?: ModelConfigPayload;
  };

  const [shot] = await db
    .select()
    .from(shots)
    .where(eq(shots.id, payload.shotId));

  if (!shot) throw new Error("Shot not found");

  const ai = resolveImageProvider(payload.modelConfig);
  const spec = await upsertShotSpecFromShot({
    projectId: payload.projectId,
    episodeId: shot.episodeId,
    shotId: shot.id,
  });
  const firstBuilt = await buildStoryboardPromptForShotSpec(spec.id, { frameRole: "first_frame" });
  const lastBuilt = await buildStoryboardPromptForShotSpec(spec.id, { frameRole: "last_frame" });

  await db
    .update(shots)
    .set({ status: "generating" })
    .where(eq(shots.id, payload.shotId));

  const firstFrameAsset = await getActiveAsset(payload.shotId, "first_frame", 0);
  const lastFrameAsset = await getActiveAsset(payload.shotId, "last_frame", 0);

  if (firstFrameAsset) await patchAsset(firstFrameAsset.id, { status: "generating" });
  if (lastFrameAsset) await patchAsset(lastFrameAsset.id, { status: "generating" });

  const firstFramePath = await ai.generateImage(
    mergePromptWithNegative(firstBuilt.prompt, firstBuilt.negativePrompt),
    {
      quality: "hd",
      referenceImages: firstBuilt.referenceImages,
      referenceLabels: firstBuilt.referenceLabels,
    },
  );

  const lastFramePath = await ai.generateImage(
    mergePromptWithNegative(lastBuilt.prompt, lastBuilt.negativePrompt),
    {
      quality: "hd",
      referenceImages: [firstFramePath, ...lastBuilt.referenceImages],
      referenceLabels: ["First Frame", ...lastBuilt.referenceLabels],
    },
  );

  if (firstFrameAsset) {
    await patchAsset(firstFrameAsset.id, {
      prompt: firstBuilt.prompt,
      fileUrl: firstFramePath,
      status: "completed",
      meta: buildPromptMeta(firstBuilt),
    });
  } else {
    await insertAssetVersion({
      shotId: payload.shotId,
      type: "first_frame",
      sequenceInType: 0,
      prompt: firstBuilt.prompt,
      fileUrl: firstFramePath,
      status: "completed",
      characters: firstBuilt.characterNames,
      meta: buildPromptMeta(firstBuilt),
    });
  }

  if (lastFrameAsset) {
    await patchAsset(lastFrameAsset.id, {
      prompt: lastBuilt.prompt,
      fileUrl: lastFramePath,
      status: "completed",
      meta: buildPromptMeta(lastBuilt),
    });
  } else {
    await insertAssetVersion({
      shotId: payload.shotId,
      type: "last_frame",
      sequenceInType: 0,
      prompt: lastBuilt.prompt,
      fileUrl: lastFramePath,
      status: "completed",
      characters: lastBuilt.characterNames,
      meta: buildPromptMeta(lastBuilt),
    });
  }

  await db
    .update(shots)
    .set({ status: "completed" })
    .where(eq(shots.id, payload.shotId));

  return { firstFrame: firstFramePath, lastFrame: lastFramePath };
}

function mergePromptWithNegative(prompt: string, negativePrompt: string) {
  const negative = negativePrompt.trim();
  return negative ? `${prompt}\n\n[NEGATIVE_PROMPT]\n${negative}` : prompt;
}

function buildPromptMeta(built: Awaited<ReturnType<typeof buildStoryboardPromptForShotSpec>>) {
  return {
    negative_prompt: built.negativePrompt,
    structured_prompt: built.structuredPrompt,
    referenceImages: built.referenceImages,
    referenceLabels: built.referenceLabels,
    prompt_builder: "deterministic_v1",
  };
}
