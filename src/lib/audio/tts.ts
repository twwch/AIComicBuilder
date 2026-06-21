import fs from "node:fs";
import path from "node:path";
import { EdgeTTS } from "node-edge-tts";
import { id as genId } from "@/lib/id";
import { getAudioDuration } from "@/lib/video/ffmpeg";
import { TTS_VOICE_MAP, DEFAULT_TTS_VOICE } from "@/lib/config/tts-voices";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

function resolveVoice(characterName?: string): string {
  if (!characterName) return process.env.TTS_VOICE || DEFAULT_TTS_VOICE;
  const map: Record<string, string> = (() => {
    try {
      return process.env.TTS_VOICE_MAP ? JSON.parse(process.env.TTS_VOICE_MAP) : TTS_VOICE_MAP;
    } catch {
      return TTS_VOICE_MAP;
    }
  })();
  if (map[characterName]) return map[characterName];
  for (const [key, voice] of Object.entries(map)) {
    if (characterName.includes(key)) return voice;
  }
  return process.env.TTS_VOICE || DEFAULT_TTS_VOICE;
}

export async function generateDialogueAudio(
  text: string,
  characterName?: string,
): Promise<{ path: string; duration: number } | null> {
  const voice = resolveVoice(characterName);

  const dir = path.join(uploadDir, "audio", "dialogue");
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, `${genId()}.mp3`);

  try {
    const tts = new EdgeTTS({
      voice,
      lang: "zh-CN",
      outputFormat: "audio-24khz-48kbitrate-mono-mp3",
    });

    await tts.ttsPromise(text, filepath);
    const duration = await getAudioDuration(filepath);
    return { path: filepath, duration };
  } catch (err) {
    console.warn(`[TTS] Failed for voice "${voice}": ${err}`);
    return null;
  }
}
