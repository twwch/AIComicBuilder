import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";

if (process.env.FFMPEG_BINARY_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_BINARY_PATH);
}

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

/** Use GPU video encoder (h264_nvenc) when available, fall back to software libx264 */
function getVideoEncoder(): string {
  if (process.env.FFMPEG_VIDEO_ENCODER) return process.env.FFMPEG_VIDEO_ENCODER;
  return "libx264";
}

type TransitionType = "cut" | "dissolve" | "fade_in" | "fade_out" | "wipeleft" | "slideright" | "circleopen";

const DEFAULT_XFADE_DURATION = 0.5;

interface SubtitleEntry {
  text: string;
  shotSequence: number;
  dialogueSequence: number;  // 0-based index within the shot
  dialogueCount: number;     // total dialogues in this shot
  startRatio?: number;       // 0-1, when dialogue starts relative to shot duration
  endRatio?: number;         // 0-1, when dialogue ends relative to shot duration
}

interface AssembleParams {
  videoPaths: string[];
  subtitles: SubtitleEntry[];
  projectId: string;
  shotDurations: number[];
  transitions?: TransitionType[];
  titleCard?: { text: string; duration: number };
  creditsCard?: { text: string; duration: number };
  bgmPath?: string;
  bgmVolume?: number;
  dialogueAudio?: DialogueAudioEntry[];
}

interface DialogueAudioEntry {
  path: string;       // path to TTS-generated audio file
  startTime: number;  // start time in seconds in the combined timeline
  endTime: number;    // end time in seconds in the combined timeline
}

interface AssembleResult {
  videoPath: string;
  srtPath?: string;
}

/**
 * Get audio file duration in seconds using ffprobe.
 */
export function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path.resolve(filePath), (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration ?? 0);
    });
  });
}

export function extractLastVideoFrame(
  videoPath: string,
  outputDir: string,
  options?: { prefix?: string }
): Promise<string> {
  const frameDir = path.resolve(outputDir, "frames");
  fs.mkdirSync(frameDir, { recursive: true });
  const safePrefix = (options?.prefix || "video-tail")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const framePath = path.join(frameDir, `${safePrefix || "video-tail"}-${genId()}.png`);

  return new Promise((resolve, reject) => {
    ffmpeg(path.resolve(videoPath))
      .inputOptions(["-sseof", "-0.05"])
      .outputOptions(["-frames:v", "1", "-q:v", "2"])
      .output(framePath)
      .on("end", () => resolve(framePath))
      .on("error", (err) => reject(new Error(`Last frame extraction failed: ${err.message}`)))
      .run();
  });
}

export async function generateTitleCard(
  text: string,
  duration: number,
  outputDir: string,
  options?: { fontSize?: number; bgColor?: string; textColor?: string }
): Promise<string> {
  const { fontSize = 48, bgColor = "black", textColor = "white" } = options || {};
  const cardPath = path.resolve(outputDir, `title-${genId()}.mp4`);

  // Write text to temp file to avoid drawtext filter injection via textfile
  const tmpDir = path.resolve(outputDir, ".tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const textFile = path.join(tmpDir, `title-text-${genId()}.txt`);
  fs.writeFileSync(textFile, text, "utf-8");

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(`color=c=${bgColor}:s=1920x1080:d=${duration}`)
      .inputOptions(["-f", "lavfi"])
      .outputOptions([
        "-vf",
        `drawtext=textfile='${textFile.replace(/'/g, "'\\''")}':fontsize=${fontSize}:fontcolor=${textColor}:x=(w-text_w)/2:y=(h-text_h)/2`,
        "-c:v", getVideoEncoder(),
        "-preset", "fast",
        "-crf", "23",
        "-t", String(duration),
        "-pix_fmt", "yuv420p",
      ])
      .output(cardPath)
      .on("end", () => {
        try { fs.unlinkSync(textFile); } catch {}
        resolve();
      })
      .on("error", (err) => {
        try { fs.unlinkSync(textFile); } catch {}
        reject(new Error(`Title card generation failed: ${err.message}`));
      })
      .run();
  });

  return cardPath;
}

function generateSrtFile(
  subtitles: SubtitleEntry[],
  shotDurations: number[],
  outputPath: string
): string {
  const srtPath = outputPath.replace(/\.mp4$/, ".srt");

  const shotStartTimes: number[] = [];
  let cumulative = 0;
  for (const duration of shotDurations) {
    shotStartTimes.push(cumulative);
    cumulative += duration;
  }

  const srtEntries: string[] = [];
  let index = 1;

  for (const sub of subtitles) {
    const shotIdx = sub.shotSequence - 1;
    if (shotIdx < 0 || shotIdx >= shotDurations.length) continue;

    const shotStart = shotStartTimes[shotIdx];
    const shotDur = shotDurations[shotIdx];

    let startTime: number;
    let endTime: number;

    if (sub.startRatio !== undefined && sub.endRatio !== undefined) {
      // Use explicit timing ratios from DB
      startTime = shotStart + shotDur * sub.startRatio;
      endTime = shotStart + shotDur * sub.endRatio;
    } else {
      // Auto-distribute: divide shot duration equally among dialogues
      const segmentDur = shotDur / sub.dialogueCount;
      startTime = shotStart + segmentDur * sub.dialogueSequence;
      endTime = startTime + segmentDur;
    }

    srtEntries.push(
      `${index}\n${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n${sub.text}\n`
    );
    index++;
  }

  fs.writeFileSync(srtPath, srtEntries.join("\n"));
  return srtPath;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// Escape path for ffmpeg subtitles filter (colon, backslash, single quote)
function escapeSubtitlePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''");
}

/** Map our transition type to ffmpeg xfade transition name */
function mapTransitionName(t: TransitionType): string {
  if (t === "fade_in" || t === "fade_out") return "fade";
  return t;
}

/**
 * Concatenate videos with optional xfade transitions.
 * Returns the path to the concatenated output file.
 */
async function concatWithTransitions(
  videoPaths: string[],
  transitions: TransitionType[],
  shotDurations: number[],
  outputPath: string,
  projectId: string,
  outputDir: string,
): Promise<void> {
  // Single video: just copy
  if (videoPaths.length === 1) {
    fs.copyFileSync(path.resolve(videoPaths[0]), outputPath);
    return;
  }

  // All cuts: use fast concat demuxer
  const allCuts = transitions.every((t) => t === "cut");
  if (allCuts) {
    const concatListPath = path.resolve(outputDir, `${projectId}-concat.txt`);
    const concatContent = videoPaths
      .map((p) => `file '${path.resolve(p)}'`)
      .join("\n");
    fs.writeFileSync(concatListPath, concatContent);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c", "copy"])
        .output(outputPath)
        .on("end", () => {
          fs.unlinkSync(concatListPath);
          resolve();
        })
        .on("error", (err) => {
          reject(new Error(`FFmpeg concat failed: ${err.message}`));
        })
        .run();
    });
    return;
  }

  // Mixed transitions: use xfade filter chain
  // Wrap in try-catch: if xfade fails (e.g. inconsistent video properties),
  // fall back to concat demuxer with hard cuts
  try {
    const cmd = ffmpeg();
    for (const vp of videoPaths) {
      cmd.input(path.resolve(vp));
    }

    // Build xfade filter chain
    const filterParts: string[] = [];
    let prevLabel = "0:v";
    let cumulativeOffset = 0;

    for (let i = 0; i < transitions.length; i++) {
      const t = transitions[i];
      const duration = shotDurations[i];
      const outLabel = i < transitions.length - 1 ? `v${i}` : "vout";

      if (t === "cut") {
        // For cut: use xfade with 1-frame duration to simulate hard cut (duration must be > 0)
        const offset = cumulativeOffset + duration;
        filterParts.push(
          `[${prevLabel}][${i + 1}:v]xfade=transition=fade:duration=0.04:offset=${offset.toFixed(3)}[${outLabel}]`
        );
        cumulativeOffset = offset;
      } else {
        const xfadeDur = DEFAULT_XFADE_DURATION;
        const offset = cumulativeOffset + duration - xfadeDur;
        const xfadeName = mapTransitionName(t);
        filterParts.push(
          `[${prevLabel}][${i + 1}:v]xfade=transition=${xfadeName}:duration=${xfadeDur}:offset=${offset.toFixed(3)}[${outLabel}]`
        );
        cumulativeOffset = offset;
      }

      prevLabel = outLabel;
    }

    const complexFilter = filterParts.join(";");

    await new Promise<void>((resolve, reject) => {
      cmd
        .complexFilter(complexFilter, "vout")
        .outputOptions([
          "-c:v", getVideoEncoder(),
          "-preset", "fast",
          "-crf", "23",
          "-an",
        ])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => {
          // Throw so we catch it below and fall back
          reject(new Error(`FFmpeg xfade failed: ${err.message}`));
        })
        .run();
    });
  } catch (xfadeErr) {
    console.warn(`[FFmpeg] xfade failed, falling back to hard-cut concat: ${xfadeErr}`);
    // Fall back to concat demuxer (hard cuts) by building a concat list
    const concatListPath = path.resolve(outputDir, `${projectId}-concat.txt`);
    const concatContent = videoPaths
      .map((p) => `file '${path.resolve(p)}'`)
      .join("\n");
    fs.writeFileSync(concatListPath, concatContent);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c", "copy"])
        .output(outputPath)
        .on("end", () => {
          fs.unlinkSync(concatListPath);
          resolve();
        })
        .on("error", (err) => {
          reject(new Error(`FFmpeg concat (fallback) failed: ${err.message}`));
        })
        .run();
    });
  }
}

/**
 * Mix dialogue audio clips (with delay positioning) and optional BGM into a video.
 * Uses ffmpeg adelay + amix to place each dialogue at the correct timestamp,
 * then mixes with BGM at reduced volume.
 */
async function mixAudioTracks(
  videoPath: string,
  dialogueEntries: DialogueAudioEntry[],
  bgmPath: string | undefined,
  bgmVolume: number,
  outputPath: string,
): Promise<void> {
  const cmd = ffmpeg();
  cmd.input(path.resolve(videoPath));

  const validEntries = dialogueEntries.filter((d) => d.path && fs.existsSync(path.resolve(d.path)));
  for (const entry of validEntries) {
    cmd.input(path.resolve(entry.path));
  }

  let bgmInputIndex = -1;
  if (bgmPath && fs.existsSync(path.resolve(bgmPath))) {
    bgmInputIndex = 1 + validEntries.length;
    cmd.input(path.resolve(bgmPath));
  }

  const filterParts: string[] = [];
  const delayedLabels: string[] = [];

  // Apply atrim (clip to window) + adelay (position at start) to each dialogue
  for (let i = 0; i < validEntries.length; i++) {
    const entry = validEntries[i];
    const delayMs = Math.round(entry.startTime * 1000);
    const windowDur = entry.endTime - entry.startTime;
    const label = `d${i}`;
    delayedLabels.push(`[${label}]`);

    if (windowDur > 0.05) {
      filterParts.push(
        `[${i + 1}:a]atrim=end=${windowDur.toFixed(3)}[t${i}];[t${i}]adelay=${delayMs}|${delayMs}[${label}]`
      );
    } else {
      filterParts.push(
        `[${i + 1}:a]adelay=${delayMs}|${delayMs}[${label}]`
      );
    }
  }

  // Mix all dialogue audio tracks together
  let dialogueMixLabel = "da";
  if (delayedLabels.length > 0) {
    const joined = delayedLabels.join("");
    filterParts.push(`${joined}amix=inputs=${delayedLabels.length}:dropout_transition=0[dialogue]`);

    if (bgmInputIndex >= 0) {
      // Mix dialogue + BGM
      // amix(inputs=N) divides each input by N, so boost proportionally
      const diaVol = delayedLabels.length * 4;
      const bgmLvl = bgmVolume.toFixed(1);
      filterParts.push(
        `[dialogue]volume=${diaVol}.0[da];` +
        `[${bgmInputIndex}:a]volume=${bgmLvl}[ba];` +
        `[da][ba]amix=inputs=2:duration=longest:dropout_transition=0[a]`
      );
      dialogueMixLabel = "a";
    } else {
      const diaVol = delayedLabels.length * 2;
      filterParts.push(`[dialogue]volume=${diaVol}.0[da]`);
      dialogueMixLabel = "da";
    }
  } else if (bgmInputIndex >= 0) {
    // Only BGM, no dialogue
    filterParts.push(`[${bgmInputIndex}:a]volume=${bgmVolume.toFixed(1)}[ba]`);
    dialogueMixLabel = "ba";
  }

  const complexFilter = filterParts.join(";");

  await new Promise<void>((resolve, reject) => {
    if (complexFilter) {
      cmd
        .complexFilter(complexFilter, dialogueMixLabel.startsWith("[") ? dialogueMixLabel.slice(1, -1) : dialogueMixLabel)
        .outputOptions(["-map", "0:v", "-c:v", "copy", "-c:a", "aac"])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(new Error(`FFmpeg audio mix failed: ${err.message}`)))
        .run();
    } else {
      // No audio to mix, just copy video
      fs.copyFileSync(path.resolve(videoPath), outputPath);
      resolve();
    }
  });
}

export async function assembleVideo(params: AssembleParams): Promise<AssembleResult> {
  const { subtitles, projectId } = params;
  const allPaths = [...params.videoPaths];
  const allDurations = [...params.shotDurations];

  const outputDir = path.resolve(uploadDir, "videos");
  fs.mkdirSync(outputDir, { recursive: true });

  // Prepend title card if specified
  if (params.titleCard) {
    const titlePath = await generateTitleCard(
      params.titleCard.text,
      params.titleCard.duration,
      outputDir
    );
    allPaths.unshift(titlePath);
    allDurations.unshift(params.titleCard.duration);
  }

  // Append credits card if specified
  if (params.creditsCard) {
    const creditsPath = await generateTitleCard(
      params.creditsCard.text,
      params.creditsCard.duration,
      outputDir
    );
    allPaths.push(creditsPath);
    allDurations.push(params.creditsCard.duration);
  }

  const transitions: TransitionType[] = params.transitions
    ?? new Array(Math.max(allPaths.length - 1, 0)).fill("cut");

  const concatOutputPath = path.resolve(outputDir, `${projectId}-concat-${genId()}.mp4`);
  const outputPath = path.resolve(outputDir, `${projectId}-final-${genId()}.mp4`);

  // Step 1: Concatenate video clips (with transitions)
  await concatWithTransitions(allPaths, transitions, allDurations, concatOutputPath, projectId, outputDir);

  // Step 2: Burn in subtitles if any
  let srtPath: string | undefined;
  if (subtitles.length > 0) {
    srtPath = generateSrtFile(subtitles, allDurations, outputPath);
    const escapedSrtPath = escapeSubtitlePath(path.resolve(srtPath));

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(concatOutputPath)
          .outputOptions([
            "-y",
            "-vf", `subtitles='${escapedSrtPath}'`,
            "-c:v", getVideoEncoder(),
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
          ])
          .output(outputPath)
          .on("end", () => {
            fs.unlinkSync(concatOutputPath);
            // Keep SRT file for external subtitle export
            resolve();
          })
          .on("error", (err) => {
            reject(err);
          })
          .run();
      });
    } catch (err) {
      // Fallback: skip subtitle burn, use concat output directly
      console.warn(`[FFmpeg] Subtitle burn failed, using concat output: ${err}`);
      fs.renameSync(concatOutputPath, outputPath);
    }
  } else {
    // No subtitles, just rename
    fs.renameSync(concatOutputPath, outputPath);
  }

  // Step 3: Mix dialogue audio and/or background music
  const hasDialogue = params.dialogueAudio && params.dialogueAudio.length > 0;
  const hasBgm = params.bgmPath && fs.existsSync(path.resolve(params.bgmPath));

  if (hasDialogue || hasBgm) {
    const audioOutputPath = outputPath.replace(/\.mp4$/, `-audio.mp4`);
    const audioEntries = params.dialogueAudio ?? [];

    try {
      await mixAudioTracks(outputPath, audioEntries, params.bgmPath, params.bgmVolume ?? 0.3, audioOutputPath);

      fs.unlinkSync(outputPath);
      fs.renameSync(audioOutputPath, outputPath);
    } catch (err) {
      console.warn(`[FFmpeg] Audio mix failed, skipping: ${err}`);
    }
  }

  // Return relative paths for uploadUrl compatibility
  return {
    videoPath: path.relative(process.cwd(), outputPath),
    srtPath: srtPath ? path.relative(process.cwd(), srtPath) : undefined,
  };
}

