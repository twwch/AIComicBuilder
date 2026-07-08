import { db } from "@/lib/db";
import { shots, dialogues, characters, characterRelations, scenes, projects, episodes } from "@/lib/db/schema";
import { resolveAIProvider } from "@/lib/ai/provider-factory";
import type { ModelConfigPayload } from "@/lib/ai/provider-factory";
import { buildShotSplitPrompt } from "@/lib/ai/prompts/shot-split";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { eq, and, or, isNull } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import type { Task } from "@/lib/task-queue";
import { getProductionBiblePromptBlock } from "@/lib/production-bible";

export async function handleShotSplit(task: Task) {
  const payload = task.payload as {
    projectId: string;
    screenplay: string;
    modelConfig?: ModelConfigPayload;
    episodeId?: string;
    userId?: string;
  };

  // Get characters for this project (include main + episode-scoped)
  const projectCharacters = await db
    .select()
    .from(characters)
    .where(
      payload.episodeId
        ? and(eq(characters.projectId, payload.projectId), or(isNull(characters.episodeId), eq(characters.episodeId, payload.episodeId)))
        : eq(characters.projectId, payload.projectId)
    );

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  // Load character relations
  const relations = await db
    .select()
    .from(characterRelations)
    .where(eq(characterRelations.projectId, payload.projectId));

  let relationsText = "";
  if (relations.length > 0) {
    relationsText = "\n\n## CHARACTER RELATIONSHIPS\n";
    for (const rel of relations) {
      const charA = projectCharacters.find(c => c.id === rel.characterAId);
      const charB = projectCharacters.find(c => c.id === rel.characterBId);
      if (charA && charB) {
        relationsText += `- ${charA.name} \u2194 ${charB.name}: ${rel.relationType}${rel.description ? ` (${rel.description})` : ""}\n`;
      }
    }
    relationsText += "\nUse these relationships to inform framing, character proximity, and eye direction in compositions.\n";
  }

  // Fetch project data
  const [project] = await db.select().from(projects).where(eq(projects.id, payload.projectId));

  // Fetch color palette from project or episode
  let colorPalette = "";
  let targetDuration = project?.targetDuration || 0;
  if (payload.episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, payload.episodeId));
    if (episode?.colorPalette) colorPalette = episode.colorPalette;
    if (episode?.targetDuration && episode.targetDuration > 0) targetDuration = episode.targetDuration;
  }
  if (!colorPalette) {
    if (project?.colorPalette) colorPalette = project.colorPalette;
  }
  const productionBibleContext = await getProductionBiblePromptBlock(payload.projectId, payload.episodeId);

  const systemPrompt = await resolvePrompt("shot_split", {
    userId: payload.userId ?? "",
    projectId: payload.projectId,
  });

  const ai = resolveAIProvider(payload.modelConfig);
  const performanceStyles = projectCharacters
    .filter(c => c.performanceStyle)
    .map(c => ({ name: c.name, performanceStyle: c.performanceStyle! }));

  let userPrompt = buildShotSplitPrompt(payload.screenplay, characterDescriptions, undefined, colorPalette || undefined, performanceStyles.length > 0 ? performanceStyles : undefined) + relationsText;

  // Inject production bible / world setting
  if (productionBibleContext) {
    userPrompt = `${productionBibleContext}\n\n${userPrompt}`;
  } else if (project?.worldSetting) {
    userPrompt = `【World Setting】\n${project.worldSetting}\n\nAll shots must be consistent with this world setting.\n\n` + userPrompt;
  }

  // Inject target duration
  if (targetDuration && targetDuration > 0) {
    userPrompt += `\n\nTarget total duration: ${targetDuration} seconds (${Math.floor(targetDuration / 60)}m${targetDuration % 60}s). Ensure all shot durations sum to approximately this target.\n`;
  }
  const result = await ai.generateText(
    userPrompt,
    { systemPrompt, temperature: 0.5 }
  );

  const parsed = JSON.parse(result) as Array<Record<string, unknown>>;

  // Handle both formats: scene-grouped array or flat shot array (backwards compat)
  const isSceneGrouped = parsed.length > 0 && Array.isArray((parsed[0] as Record<string, unknown>).shots);

  const created = [];

  const insertShot = async (
    shotData: Record<string, unknown>,
    sceneId?: string
  ) => {
    const shotId = genId();
    // Metadata-only insert. Image/video assets live in the shot_assets table
    // and are produced by independent downstream pipelines (keyframe / reference).
    const [record] = await db
      .insert(shots)
      .values({
        id: shotId,
        projectId: payload.projectId,
        sequence: (shotData.sequence as number) || 0,
        prompt: (shotData.prompt as string) || "",
        motionScript: (shotData.motionScript as string) || "",
        videoScript: (shotData.videoScript as string) || "",
        cameraDirection: (shotData.cameraDirection as string) || "static",
        duration: (shotData.duration as number) || 10,
        transitionIn: (shotData.transitionIn as string) || "cut",
        transitionOut: (shotData.transitionOut as string) || "cut",
        compositionGuide: (shotData.compositionGuide as string) || "",
        focalPoint: (shotData.focalPoint as string) || "",
        depthOfField: (shotData.depthOfField as string) || "medium",
        soundDesign: (shotData.soundDesign as string) || "",
        musicCue: (shotData.musicCue as string) || "",
        episodeId: payload.episodeId ?? null,
        sceneId: sceneId ?? null,
      })
      .returning();

    // Create dialogues for this shot
    const shotDialogues = (shotData.dialogues as Array<{ character: string; text: string }>) || [];
    for (let i = 0; i < shotDialogues.length; i++) {
      const dialogue = shotDialogues[i];
      const matchedChar = projectCharacters.find(
        (c) => c.name === dialogue.character
      );
      if (matchedChar) {
        await db.insert(dialogues).values({
          id: genId(),
          shotId,
          characterId: matchedChar.id,
          text: dialogue.text,
          sequence: i,
        });
      }
    }

    return record;
  };

  if (isSceneGrouped) {
    let globalSequence = 1;
    for (let sceneIdx = 0; sceneIdx < parsed.length; sceneIdx++) {
      const scene = parsed[sceneIdx] as Record<string, unknown>;
      const sceneId = genId();
      await db.insert(scenes).values({
        id: sceneId,
        episodeId: payload.episodeId || "",
        projectId: payload.projectId,
        title: (scene.sceneTitle as string) || "",
        description: (scene.sceneDescription as string) || "",
        lighting: (scene.lighting as string) || "",
        colorPalette: (scene.colorPalette as string) || "",
        sequence: sceneIdx + 1,
      });

      const sceneShots = (scene.shots as Array<Record<string, unknown>>) || [];
      for (const shotData of sceneShots) {
        shotData.sequence = globalSequence++;
        const record = await insertShot(shotData, sceneId);
        created.push(record);
      }
    }
  } else {
    // Flat shot array (backwards compat)
    for (const shotData of parsed) {
      const record = await insertShot(shotData);
      created.push(record);
    }
  }

  return { shots: created };
}
