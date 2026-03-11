import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

interface SubtitleEntry {
  text: string;
  shotSequence: number;
}

interface AssembleParams {
  videoPaths: string[];
  subtitles: SubtitleEntry[];
  projectId: string;
  shotDurations: number[];
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

    const startTime = shotStartTimes[shotIdx];
    const endTime = startTime + shotDurations[shotIdx];

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

export async function assembleVideo(params: AssembleParams): Promise<string> {
  const { videoPaths, subtitles, projectId, shotDurations } = params;
  const outputDir = path.resolve(uploadDir, "videos");
  fs.mkdirSync(outputDir, { recursive: true });
  const concatOutputPath = path.resolve(outputDir, `${projectId}-concat-${ulid()}.mp4`);
  const outputPath = path.resolve(outputDir, `${projectId}-final-${ulid()}.mp4`);

  // Step 1: Concatenate video clips
  if (videoPaths.length === 1) {
    fs.copyFileSync(path.resolve(videoPaths[0]), concatOutputPath);
  } else {
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
        .output(concatOutputPath)
        .on("end", () => {
          fs.unlinkSync(concatListPath);
          resolve();
        })
        .on("error", (err) => {
          reject(new Error(`FFmpeg concat failed: ${err.message}`));
        })
        .run();
    });
  }

  // Step 2: Burn in subtitles if any
  if (subtitles.length > 0) {
    const srtPath = generateSrtFile(subtitles, shotDurations, outputPath);
    const escapedSrtPath = escapeSubtitlePath(path.resolve(srtPath));

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(concatOutputPath)
          .outputOptions([
            "-y",
            "-vf", `subtitles='${escapedSrtPath}'`,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
          ])
          .output(outputPath)
          .on("end", () => {
            fs.unlinkSync(concatOutputPath);
            fs.unlinkSync(srtPath);
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
      try { fs.unlinkSync(srtPath); } catch {}
      fs.renameSync(concatOutputPath, outputPath);
    }
  } else {
    // No subtitles, just rename
    fs.renameSync(concatOutputPath, outputPath);
  }

  // Return relative path for uploadUrl compatibility
  return path.relative(process.cwd(), outputPath);
}
