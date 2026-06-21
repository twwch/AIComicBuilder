import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, episodes, projects, characters, dialogues, storyboardVersions } from "@/lib/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { type ModelConfig, extractErrorMessage, resolveGenerationMode } from "@/lib/generate-utils";
import { DEFAULT_SHOT_DURATION } from "@/lib/config/defaults";
import { assembleVideo } from "@/lib/video/ffmpeg";
import { loadShotLegacyViewsBatch } from "@/lib/shot-asset-utils";
import { generateDialogueAudio } from "@/lib/audio/tts";
import { registerTask } from "@/lib/task-registry";
import { updateTaskProgress, completeTask } from "@/lib/task-utils";

export async function handleVideoAssembleSync(projectId: string, _userId: string, payload?: Record<string, unknown>, _modelConfig?: ModelConfig, episodeId?: string, taskId?: string) {
  const taskSignal = taskId ? registerTask(taskId).signal : undefined;
  if (taskId) updateTaskProgress(taskId, { total: 5, completed: 0, failed: [] });
  const generationModeValue = await resolveGenerationMode(projectId, episodeId);
  if (taskSignal?.aborted) { if (taskId) completeTask(taskId, { total: 0, completed: 0, failed: [] }); return NextResponse.json({ error: "Cancelled" }, { status: 499 }); }
  if (taskId) updateTaskProgress(taskId, { total: 5, completed: 1, failed: [] });

  let versionId = payload?.versionId as string | undefined;

  if (!versionId) {
    const versionWhere = episodeId
      ? and(eq(storyboardVersions.projectId, projectId), eq(storyboardVersions.episodeId, episodeId))
      : eq(storyboardVersions.projectId, projectId);
    const [latestVersion] = await db
      .select({ id: storyboardVersions.id })
      .from(storyboardVersions)
      .where(versionWhere)
      .orderBy(desc(storyboardVersions.versionNum))
      .limit(1);
    versionId = latestVersion?.id;
  }

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (versionId) shotWhereConditions.push(eq(shots.versionId, versionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const projectShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  const isReference = generationModeValue === "reference";
  const projectShotsLegacy = await loadShotLegacyViewsBatch(projectShots.map((s) => s.id));
  const videoPaths = projectShots
    .map((s) => {
      const v = projectShotsLegacy.get(s.id);
      return isReference ? v?.referenceVideoUrl : v?.videoUrl;
    })
    .filter(Boolean) as string[];

  if (taskId) updateTaskProgress(taskId, { total: 5, completed: 2, failed: [] });

  if (videoPaths.length === 0) {
    return NextResponse.json({ error: "No video clips to assemble" }, { status: 400 });
  }

  type TransitionType = "cut" | "dissolve" | "fade_in" | "fade_out" | "wipeleft" | "slideright" | "circleopen";
  const completedShots = projectShots.filter((s) => {
    const v = projectShotsLegacy.get(s.id);
    return isReference ? v?.referenceVideoUrl : v?.videoUrl;
  });
  const transitions: TransitionType[] = completedShots.slice(0, -1).map((shot, i) => {
    const nextShot = completedShots[i + 1];
    return ((shot.transitionOut && shot.transitionOut !== "cut")
      ? shot.transitionOut
      : (nextShot?.transitionIn || "cut")) as TransitionType;
  });

  if (taskId) updateTaskProgress(taskId, { total: 5, completed: 3, failed: [] });

  const allSubtitles: {
    text: string;
    dialogueText: string;
    characterName: string;
    shotSequence: number;
    dialogueSequence: number;
    dialogueCount: number;
    startRatio?: number;
    endRatio?: number;
  }[] = [];
  for (const shot of completedShots) {
    const shotDialogues = await db
      .select({
        text: dialogues.text,
        characterName: characters.name,
        sequence: dialogues.sequence,
        shotSequence: shots.sequence,
        startRatio: dialogues.startRatio,
        endRatio: dialogues.endRatio,
      })
      .from(dialogues)
      .innerJoin(characters, eq(dialogues.characterId, characters.id))
      .innerJoin(shots, eq(dialogues.shotId, shots.id))
      .where(eq(dialogues.shotId, shot.id))
      .orderBy(asc(dialogues.sequence));

    const count = shotDialogues.length;
    shotDialogues.forEach((d, idx) => {
      const sr = d.startRatio ? parseFloat(String(d.startRatio)) : undefined;
      const er = d.endRatio ? parseFloat(String(d.endRatio)) : undefined;
      allSubtitles.push({
        text: `${d.characterName}: ${d.text}`,
        dialogueText: d.text,
        characterName: d.characterName,
        shotSequence: d.shotSequence,
        dialogueSequence: idx,
        dialogueCount: count,
        startRatio: sr,
        endRatio: er,
      });
    });
  }

  const shotDurations = completedShots.map((s) => s.duration ?? DEFAULT_SHOT_DURATION);
  const shotStartTimes: number[] = [];
  let cumTime = 0;
  for (const d of shotDurations) {
    shotStartTimes.push(cumTime);
    cumTime += d;
  }

  const dialogueAudio: { path: string; startTime: number; endTime: number }[] = [];
  for (let ai = 0; ai < allSubtitles.length; ai++) {
    if (taskSignal?.aborted) { break; }
    const sub = allSubtitles[ai];
    const shotIdx = sub.shotSequence - 1;
    if (shotIdx < 0 || shotIdx >= shotDurations.length) continue;
    const shotStart = shotStartTimes[shotIdx];
    const shotDur = shotDurations[shotIdx];
    let startTime: number, endTime: number;
    if (sub.startRatio !== undefined && sub.endRatio !== undefined) {
      startTime = shotStart + shotDur * sub.startRatio;
      endTime = shotStart + shotDur * sub.endRatio;
    } else {
      const segmentDur = shotDur / sub.dialogueCount;
      startTime = shotStart + segmentDur * sub.dialogueSequence;
      endTime = startTime + segmentDur;
    }
    const audio = await generateDialogueAudio(sub.dialogueText, sub.characterName);
    if (audio) {
      const clipEnd = Math.min(endTime, startTime + audio.duration);
      dialogueAudio.push({ path: audio.path, startTime, endTime: clipEnd });
    }
  }
  if (taskSignal?.aborted) { if (taskId) completeTask(taskId, { total: 0, completed: 0, failed: [] }); return NextResponse.json({ error: "Cancelled" }, { status: 499 }); }

  try {
    if (taskId) updateTaskProgress(taskId, { total: 5, completed: 4, failed: [] });
    const result = await assembleVideo({
      videoPaths,
      subtitles: [], // no subtitles per user request
      projectId,
      shotDurations,
      transitions,
      dialogueAudio: dialogueAudio.length > 0 ? dialogueAudio : undefined,
    });

    if (episodeId) {
      await db
        .update(episodes)
        .set({ status: "completed", finalVideoUrl: result.videoPath, updatedAt: new Date() })
        .where(eq(episodes.id, episodeId));
    } else {
      await db
        .update(projects)
        .set({ status: "completed", finalVideoUrl: result.videoPath, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    }

    if (taskId) completeTask(taskId, { total: 5, completed: 5, failed: [] });
    console.log(`[VideoAssemble] Completed: ${result.videoPath}`);
    return NextResponse.json({ outputPath: result.videoPath, srtPath: result.srtPath, status: "ok" });
  } catch (err) {
    const msg = extractErrorMessage(err);
    if (taskId) completeTask(taskId, { total: 5, completed: 4, failed: [msg] });
    console.error("[VideoAssemble] Error:", err);
    return NextResponse.json({ status: "error", error: msg }, { status: 500 });
  }
}
