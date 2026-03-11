import { NextResponse } from "next/server";
import { streamText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects, characters, shots, dialogues } from "@/lib/db/schema";
import { eq, asc, and, lt, desc } from "drizzle-orm";
import { ulid } from "ulid";
import { enqueueTask } from "@/lib/task-queue";
import type { TaskType } from "@/lib/task-queue";
import {
  SCRIPT_PARSE_SYSTEM,
  buildScriptParsePrompt,
} from "@/lib/ai/prompts/script-parse";
import {
  SCRIPT_GENERATE_SYSTEM,
  buildScriptGeneratePrompt,
} from "@/lib/ai/prompts/script-generate";
import {
  CHARACTER_EXTRACT_SYSTEM,
  buildCharacterExtractPrompt,
} from "@/lib/ai/prompts/character-extract";
import {
  SHOT_SPLIT_SYSTEM,
  buildShotSplitPrompt,
} from "@/lib/ai/prompts/shot-split";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import { resolveImageProvider, resolveVideoProvider } from "@/lib/ai/provider-factory";
import { buildCharacterTurnaroundPrompt } from "@/lib/ai/prompts/character-image";
import { assembleVideo } from "@/lib/video/ffmpeg";

export const maxDuration = 300;

interface ModelConfig {
  text?: ProviderConfig | null;
  image?: ProviderConfig | null;
  video?: ProviderConfig | null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const body = (await request.json()) as {
    action: string;
    payload?: Record<string, unknown>;
    modelConfig?: ModelConfig;
  };

  const { action, payload, modelConfig } = body;

  if (action === "script_generate") {
    return handleScriptGenerate(projectId, payload, modelConfig);
  }

  if (action === "script_parse") {
    return handleScriptParseStream(projectId, modelConfig);
  }

  if (action === "character_extract") {
    return handleCharacterExtract(projectId, modelConfig);
  }

  if (action === "single_character_image") {
    return handleSingleCharacterImage(payload, modelConfig);
  }

  if (action === "batch_character_image") {
    return handleBatchCharacterImage(projectId, modelConfig);
  }

  if (action === "shot_split") {
    return handleShotSplitStream(projectId, modelConfig);
  }

  if (action === "batch_frame_generate") {
    return handleBatchFrameGenerate(projectId, modelConfig);
  }

  if (action === "single_frame_generate") {
    return handleSingleFrameGenerate(projectId, payload, modelConfig);
  }

  if (action === "single_video_generate") {
    return handleSingleVideoGenerate(payload, modelConfig);
  }

  if (action === "batch_video_generate") {
    return handleBatchVideoGenerate(projectId, payload, modelConfig);
  }

  if (action === "video_assemble") {
    return handleVideoAssembleSync(projectId);
  }

  // Image/video generation - keep in task queue
  const task = await enqueueTask({
    type: action as NonNullable<TaskType>,
    projectId,
    payload: { projectId, ...payload, modelConfig },
  });

  return NextResponse.json(task, { status: 201 });
}

// --- script_generate: stream plain text screenplay from an idea ---

async function handleScriptGenerate(
  projectId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const idea = (payload?.idea as string) || "";
  if (!idea.trim()) {
    return NextResponse.json({ error: "No idea provided" }, { status: 400 });
  }

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  const model = createLanguageModel(modelConfig.text);

  const result = streamText({
    model,
    system: SCRIPT_GENERATE_SYSTEM,
    prompt: buildScriptGeneratePrompt(idea),
    temperature: 0.8,
    onFinish: async ({ text }) => {
      try {
        await db
          .update(projects)
          .set({ script: text, updatedAt: new Date() })
          .where(eq(projects.id, projectId));
        console.log(`[ScriptGenerate] Saved generated script for ${projectId}`);
      } catch (err) {
        console.error("[ScriptGenerate] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}

// --- script_parse: parse user script into structured screenplay ---

async function handleScriptParseStream(
  projectId: string,
  modelConfig?: ModelConfig
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project?.script) {
    return NextResponse.json(
      { error: "Project or script not found" },
      { status: 404 }
    );
  }

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  const model = createLanguageModel(modelConfig.text);

  const result = streamText({
    model,
    system: SCRIPT_PARSE_SYSTEM,
    prompt: buildScriptParsePrompt(project.script),
    temperature: 0.7,
    onFinish: async ({ text }) => {
      try {
        const screenplay = extractJSON(text);
        JSON.parse(screenplay); // validate JSON
        await db
          .update(projects)
          .set({ updatedAt: new Date() })
          .where(eq(projects.id, projectId));
        console.log(`[ScriptParse] Parsed screenplay for ${projectId}`);
      } catch (err) {
        console.error("[ScriptParse] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}

// --- character_extract: stream character extraction from script ---

async function handleCharacterExtract(
  projectId: string,
  modelConfig?: ModelConfig
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project?.script) {
    return NextResponse.json(
      { error: "Project or script not found" },
      { status: 404 }
    );
  }

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  // Delete existing characters for re-extraction
  await db.delete(characters).where(eq(characters.projectId, projectId));

  const model = createLanguageModel(modelConfig.text);

  const result = streamText({
    model,
    system: CHARACTER_EXTRACT_SYSTEM,
    prompt: buildCharacterExtractPrompt(project.script),
    temperature: 0.5,
    onFinish: async ({ text }) => {
      try {
        const extracted = JSON.parse(extractJSON(text)) as Array<{
          name: string;
          description: string;
        }>;

        for (const char of extracted) {
          await db.insert(characters).values({
            id: ulid(),
            projectId,
            name: char.name,
            description: char.description,
          });
        }

        console.log(
          `[CharacterExtract] Extracted ${extracted.length} characters`
        );
      } catch (err) {
        console.error("[CharacterExtract] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}

// --- single_character_image: generate turnaround image for one character ---

async function handleSingleCharacterImage(
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const characterId = payload?.characterId as string;
  if (!characterId) {
    return NextResponse.json({ error: "No characterId provided" }, { status: 400 });
  }

  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId));

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const ai = resolveImageProvider(modelConfig);
  const prompt = buildCharacterTurnaroundPrompt(character.description || character.name);

  try {
    const imagePath = await ai.generateImage(prompt, {
      size: "1792x1024",
      quality: "hd",
    });
    await db
      .update(characters)
      .set({ referenceImage: imagePath })
      .where(eq(characters.id, characterId));
    return NextResponse.json({ characterId, imagePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleCharacterImage] Error for ${character.name}:`, err);
    return NextResponse.json({ characterId, status: "error", error: String(err) }, { status: 500 });
  }
}

// --- batch_character_image: generate turnaround images for all characters ---

async function handleBatchCharacterImage(
  projectId: string,
  modelConfig?: ModelConfig
) {
  if (!modelConfig?.image) {
    return NextResponse.json(
      { error: "No image model configured" },
      { status: 400 }
    );
  }

  const allCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));

  const needImages = allCharacters.filter((c) => !c.referenceImage);
  if (needImages.length === 0) {
    return NextResponse.json({ results: [], message: "All characters already have images" });
  }

  const ai = resolveImageProvider(modelConfig);

  const results = await Promise.all(
    needImages.map(async (character) => {
      try {
        const prompt = buildCharacterTurnaroundPrompt(character.description || character.name);
        const imagePath = await ai.generateImage(prompt, {
          size: "1792x1024",
          quality: "hd",
        });
        await db
          .update(characters)
          .set({ referenceImage: imagePath })
          .where(eq(characters.id, character.id));
        return { characterId: character.id, name: character.name, imagePath, status: "ok" };
      } catch (err) {
        console.error(`[BatchCharacterImage] Error for ${character.name}:`, err);
        return { characterId: character.id, name: character.name, status: "error", error: String(err) };
      }
    })
  );

  return NextResponse.json({ results });
}

// --- shot_split: stream shot splitting ---

async function handleShotSplitStream(
  projectId: string,
  modelConfig?: ModelConfig
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project) {
    return NextResponse.json(
      { error: "Project not found" },
      { status: 404 }
    );
  }

  if (!modelConfig?.text) {
    return NextResponse.json(
      { error: "No text model configured" },
      { status: 400 }
    );
  }

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const model = createLanguageModel(modelConfig.text);

  const result = streamText({
    model,
    system: SHOT_SPLIT_SYSTEM,
    prompt: buildShotSplitPrompt(project.script || "", characterDescriptions),
    temperature: 0.5,
    onFinish: async ({ text }) => {
      try {
        const parsedShots = JSON.parse(extractJSON(text)) as Array<{
          sequence: number;
          prompt: string;
          duration: number;
          dialogues: Array<{ character: string; text: string }>;
        }>;

        for (const shot of parsedShots) {
          const shotId = ulid();
          await db.insert(shots).values({
            id: shotId,
            projectId,
            sequence: shot.sequence,
            prompt: shot.prompt,
            duration: shot.duration,
          });

          for (let i = 0; i < (shot.dialogues || []).length; i++) {
            const dialogue = shot.dialogues[i];
            const matchedChar = projectCharacters.find(
              (c) => c.name === dialogue.character
            );
            if (matchedChar) {
              await db.insert(dialogues).values({
                id: ulid(),
                shotId,
                characterId: matchedChar.id,
                text: dialogue.text,
                sequence: i,
              });
            }
          }
        }

        console.log(
          `[ShotSplit] Created ${parsedShots.length} shots`
        );
      } catch (err) {
        console.error("[ShotSplit] onFinish error:", err);
      }
    },
  });

  return result.toTextStreamResponse();
}

// --- batch_frame_generate: sequential frame generation with continuity chain ---

async function handleBatchFrameGenerate(
  projectId: string,
  modelConfig?: ModelConfig
) {
  if (!modelConfig?.image) {
    return NextResponse.json(
      { error: "No image model configured" },
      { status: 400 }
    );
  }

  const allShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0) {
    return NextResponse.json({ results: [], message: "No shots found" });
  }

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));

  const characterDescriptions = projectCharacters
    .map((c) => {
      let desc = `${c.name}: ${c.description}`;
      if (c.referenceImage) desc += ` [ref: ${c.referenceImage}]`;
      return desc;
    })
    .join("\n");

  const ai = resolveImageProvider(modelConfig);
  const results: Array<{ shotId: string; sequence: number; status: string; firstFrame?: string; lastFrame?: string; error?: string }> = [];

  let previousLastFrame: string | undefined;

  for (let i = 0; i < allShots.length; i++) {
    const shot = allShots[i];

    try {
      await db
        .update(shots)
        .set({ status: "generating" })
        .where(eq(shots.id, shot.id));

      let firstFramePath: string;

      if (i === 0) {
        // First shot: generate first frame
        const firstPrompt = buildFirstFramePrompt({
          shotPrompt: shot.prompt || "",
          characterDescriptions,
        });
        firstFramePath = await ai.generateImage(firstPrompt, {
          size: "1792x1024",
          quality: "hd",
        });
      } else {
        // Continuity chain: reuse previous shot's last frame
        firstFramePath = previousLastFrame!;
      }

      // Generate last frame for this shot
      const lastPrompt = buildLastFramePrompt({
        shotPrompt: shot.prompt || "",
        characterDescriptions,
        firstFramePath,
      });
      const lastFramePath = await ai.generateImage(lastPrompt, {
        size: "1792x1024",
        quality: "hd",
      });

      await db
        .update(shots)
        .set({
          firstFrame: firstFramePath,
          lastFrame: lastFramePath,
          status: "completed",
        })
        .where(eq(shots.id, shot.id));

      previousLastFrame = lastFramePath;

      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "ok",
        firstFrame: firstFramePath,
        lastFrame: lastFramePath,
      });

      console.log(`[BatchFrameGenerate] Shot ${shot.sequence} completed`);
    } catch (err) {
      console.error(`[BatchFrameGenerate] Error for shot ${shot.sequence}:`, err);
      await db
        .update(shots)
        .set({ status: "failed" })
        .where(eq(shots.id, shot.id));
      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "error",
        error: String(err),
      });
    }
  }

  return NextResponse.json({ results });
}

// --- single_frame_generate: synchronous frame generation for one shot ---

async function handleSingleFrameGenerate(
  projectId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));

  const characterDescriptions = projectCharacters
    .map((c) => {
      let d = `${c.name}: ${c.description}`;
      if (c.referenceImage) d += ` [ref: ${c.referenceImage}]`;
      return d;
    })
    .join("\n");

  // Find previous shot's last frame for continuity
  const [previousShot] = await db
    .select()
    .from(shots)
    .where(and(eq(shots.projectId, projectId), lt(shots.sequence, shot.sequence)))
    .orderBy(desc(shots.sequence))
    .limit(1);

  const ai = resolveImageProvider(modelConfig);

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const firstPrompt = buildFirstFramePrompt({
      shotPrompt: shot.prompt || "",
      characterDescriptions,
      previousLastFrame: previousShot?.lastFrame || undefined,
    });
    const firstFramePath = await ai.generateImage(firstPrompt, {
      quality: "hd",
      referenceImages: projectCharacters.map((c) => c.referenceImage).filter(Boolean) as string[],
    });

    const lastPrompt = buildLastFramePrompt({
      shotPrompt: shot.prompt || "",
      characterDescriptions,
      firstFramePath,
    });
    const lastFramePath = await ai.generateImage(lastPrompt, {
      quality: "hd",
      referenceImages: projectCharacters.map((c) => c.referenceImage).filter(Boolean) as string[],
    });

    await db
      .update(shots)
      .set({ firstFrame: firstFramePath, lastFrame: lastFramePath, status: "completed" })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, firstFrame: firstFramePath, lastFrame: lastFramePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleFrameGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json({ shotId, status: "error", error: String(err) }, { status: 500 });
  }
}

// --- single_video_generate: synchronous video generation for one shot ---

async function handleSingleVideoGenerate(
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  if (!shot.firstFrame || !shot.lastFrame) {
    return NextResponse.json({ error: "Shot frames not generated yet" }, { status: 400 });
  }

  const videoProvider = resolveVideoProvider(modelConfig);

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const ratio = (payload?.ratio as string) || "16:9";

    const videoPath = await videoProvider.generateVideo({
      firstFrame: shot.firstFrame,
      lastFrame: shot.lastFrame,
      prompt: shot.prompt || "",
      duration: shot.duration ?? 10,
      ratio,
    });

    await db
      .update(shots)
      .set({ videoUrl: videoPath, status: "completed" })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, videoUrl: videoPath, status: "ok" });
  } catch (err) {
    console.error(`[SingleVideoGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json({ shotId, status: "error", error: String(err) }, { status: 500 });
  }
}

// --- batch_video_generate: sequential video generation for all eligible shots ---

async function handleBatchVideoGenerate(
  projectId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig
) {
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  const allShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  const eligible = allShots.filter((s) => s.firstFrame && s.lastFrame && !s.videoUrl);
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots" });
  }

  const videoProvider = resolveVideoProvider(modelConfig);
  const ratio = (payload?.ratio as string) || "16:9";

  // Mark all as generating
  await Promise.all(
    eligible.map((shot) =>
      db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id))
    )
  );

  // Concurrent generation — each task catches its own errors
  const results = await Promise.all(
    eligible.map(async (shot) => {
      try {
        const videoPath = await videoProvider.generateVideo({
          firstFrame: shot.firstFrame!,
          lastFrame: shot.lastFrame!,
          prompt: shot.prompt || "",
          duration: shot.duration ?? 10,
          ratio,
        });

        await db
          .update(shots)
          .set({ videoUrl: videoPath, status: "completed" })
          .where(eq(shots.id, shot.id));

        console.log(`[BatchVideoGenerate] Shot ${shot.sequence} completed`);
        return { shotId: shot.id, sequence: shot.sequence, status: "ok" as const, videoUrl: videoPath };
      } catch (err) {
        console.error(`[BatchVideoGenerate] Error for shot ${shot.sequence}:`, err);
        await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
        return { shotId: shot.id, sequence: shot.sequence, status: "error" as const, error: String(err) };
      }
    })
  );

  return NextResponse.json({ results });
}

// --- video_assemble: synchronous ffmpeg concat + subtitle burn ---

async function handleVideoAssembleSync(projectId: string) {
  const projectShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(asc(shots.sequence));

  const videoPaths = projectShots
    .map((s) => s.videoUrl)
    .filter(Boolean) as string[];

  if (videoPaths.length === 0) {
    return NextResponse.json({ error: "No video clips to assemble" }, { status: 400 });
  }

  // Get dialogues for subtitles
  const allDialogues = [];
  for (const shot of projectShots) {
    const shotDialogues = await db
      .select({
        text: dialogues.text,
        characterName: characters.name,
        sequence: dialogues.sequence,
        shotSequence: shots.sequence,
      })
      .from(dialogues)
      .innerJoin(characters, eq(dialogues.characterId, characters.id))
      .innerJoin(shots, eq(dialogues.shotId, shots.id))
      .where(eq(dialogues.shotId, shot.id))
      .orderBy(asc(dialogues.sequence));
    allDialogues.push(...shotDialogues);
  }

  try {
    const outputPath = await assembleVideo({
      videoPaths,
      subtitles: allDialogues.map((d) => ({
        text: `${d.characterName}: ${d.text}`,
        shotSequence: d.shotSequence,
      })),
      projectId,
      shotDurations: projectShots.map((s) => s.duration ?? 10),
    });

    await db
      .update(projects)
      .set({ status: "completed", finalVideoUrl: outputPath, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    console.log(`[VideoAssemble] Completed: ${outputPath}`);
    return NextResponse.json({ outputPath, status: "ok" });
  } catch (err) {
    console.error("[VideoAssemble] Error:", err);
    return NextResponse.json({ status: "error", error: String(err) }, { status: 500 });
  }
}
