import { db } from "@/lib/db";
import { characters, shots } from "@/lib/db/schema";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildCharacterTurnaroundPrompt } from "@/lib/ai/prompts/character-image";
import { loadShotLegacyViewsBatch, patchAsset } from "@/lib/shot-asset-utils";
import { and, eq, inArray } from "drizzle-orm";
import type { Task } from "@/lib/task-queue";

async function generateCharacterImage(
  character: typeof characters.$inferSelect,
  modelConfig?: ModelConfigPayload,
) {
  const ai = resolveImageProvider(modelConfig);
  const prompt = buildCharacterTurnaroundPrompt(character.description || character.name, character.name);

  const imagePath = await ai.generateImage(prompt, {
    size: "2560x1440",
    aspectRatio: "16:9",
    quality: "hd",
  });

  let history: string[] = [];
  try {
    history = JSON.parse(character.referenceImageHistory || "[]") as string[];
  } catch {}
  if (character.referenceImage && !history.includes(character.referenceImage)) {
    history.push(character.referenceImage);
  }
  if (!history.includes(imagePath)) {
    history.push(imagePath);
  }

  await db
    .update(characters)
    .set({
      referenceImage: imagePath,
      referenceImageHistory: JSON.stringify(history),
    })
    .where(eq(characters.id, character.id));

  const allShots = await db.select().from(shots).where(eq(shots.projectId, character.projectId));
  const legacyMap = await loadShotLegacyViewsBatch(allShots.map((shot) => shot.id));
  let staleShots = 0;
  for (const shot of allShots) {
    const view = legacyMap.get(shot.id);
    if (!view) continue;
    let modified = false;
    for (const item of view.referenceImages) {
      if (item.characters?.includes(character.name) && item.status === "completed") {
        await patchAsset(item.id, { status: "pending", fileUrl: null });
        modified = true;
      }
    }
    if (modified) staleShots++;
  }

  return {
    characterId: character.id,
    name: character.name,
    imagePath,
    status: "ok",
    staleShots,
  };
}

export async function handleCharacterImage(task: Task) {
  const payload = task.payload as {
    characterId?: string;
    characterIds?: string[];
    modelConfig?: ModelConfigPayload;
  };
  const characterIds = payload.characterIds?.length
    ? payload.characterIds
    : payload.characterId
      ? [payload.characterId]
      : [];

  if (characterIds.length === 0) {
    throw new Error("No characterId provided");
  }
  if (!task.projectId) {
    throw new Error("No projectId provided");
  }

  const selectedCharacters = await db
    .select()
    .from(characters)
    .where(and(
      inArray(characters.id, characterIds),
      eq(characters.projectId, task.projectId),
    ));

  if (selectedCharacters.length !== characterIds.length) {
    throw new Error("Character not found");
  }

  const results = await Promise.all(
    selectedCharacters.map((character) =>
      generateCharacterImage(character, payload.modelConfig)
    )
  );

  return payload.characterId ? results[0] : { results };
}
