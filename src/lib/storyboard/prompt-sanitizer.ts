export const SOUND_PATTERNS = [
  /音效|声音|雨声|风声|脚步声|枪声|配乐|音乐|SFX|sound effect|audio cue/i,
];

export const DURATION_PATTERNS = [
  /约?\s*\d+\s*(秒|分钟)/,
  /\b\d+\s*(s|sec|secs|second|seconds|min|mins|minute|minutes)\b/i,
  /\bDuration\s*:\s*\d+\s*s\b/i,
];

export const DIALOGUE_PATTERNS = [
  /台词|对白|字幕|字幕条|说道|说：|喊道|喊：|尖叫|低声|怒吼/,
  /\bsubtitle\b|\bcaption\b|\bdialogue\b|\bsays\b|\bshouts\b|\bscreams\b/i,
];

export const VIDEO_STAGE_PATTERNS = [
  /等待生成视频|生成视频|视频提示词|视频模型|视频脚本|时长策略|Seedance|Kling|Veo/i,
];

export const DIRTY_MARK_PATTERNS = [
  /【|】|\[|\]|\*\*|```|#{1,6}\s/,
];

export const CONTINUOUS_ACTION_PATTERNS = [
  /然后|随后|接着|之后|最终|同时|再|并且|又|转而/,
  /\bthen\b|\bafterward\b|\bfinally\b|\band then\b|\bnext\b|\bmeanwhile\b/i,
];

export const CAMERA_MOVEMENT_PATTERNS = [
  /运镜|推进|推近|拉远|摇移|跟拍|甩镜|环绕|升格|移动镜头/,
  /\bdolly\b|\btracking\b|\bpan\b|\btilt\b|\bzoom\b|\bcrane\b|\bcamera movement\b/i,
];

export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

export function compactText(value: unknown, maxLength = 420) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
    .replace(/([,.;:!?，。；：！？]){2,}/g, "$1")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

export function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return trimmed.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
}

export function stripStageAndDialogueLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\s*[【\[]?\s*(音效|SFX|sound|音乐|配乐|旁白|时长|注意|备注)[：:\]】]/i.test(line))
    .filter((line) => !/^\s*（?\s*(注意|备注)/.test(line))
    .filter((line) => !/^[\u4e00-\u9fa5A-Za-z0-9_·]{1,18}(?:（[^）]+）|\([^)]*\))?[：:]/.test(line))
    .join(" ");
}

export function sanitizePromptText(value: unknown) {
  return compactText(
    stripStageAndDialogueLines(String(value ?? ""))
      .replace(/【\s*场景\s*\d+\s*[：:]\s*([^】\n]+?)\s*】/gi, "$1")
      .replace(/【([^】]+)】/g, "$1")
      .replace(/\[[^\]]*(音效|SFX|sound|music|audio)[^\]]*\]/gi, " ")
      .replace(/【[^】]*(音效|SFX|sound|music|audio)[^】]*】/gi, " ")
      .replace(/（约?\s*\d+\s*(秒|分钟)）|\(约?\s*\d+\s*(秒|分钟)\)/g, " ")
      .replace(/\bDuration\s*:\s*\d+\s*s\.?/gi, " ")
      .replace(/[“"][^”"]{2,100}[”"]/g, " ")
      .replace(/等待生成视频|生成视频提示词|视频提示词|视频模型|视频脚本/g, " ")
      .replace(/[#*_`>]/g, " ")
      .replace(/[【】\[\]]/g, " "),
    700,
  );
}

export function hasPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function containsDirtyPromptMarks(text: string) {
  return hasPattern(text, DIRTY_MARK_PATTERNS) || hasPattern(text, VIDEO_STAGE_PATTERNS);
}

export function looksLikeRawStoryboardText(value: string | null | undefined) {
  const text = String(value || "");
  return hasPattern(text, [
    ...SOUND_PATTERNS,
    ...DURATION_PATTERNS,
    ...DIALOGUE_PATTERNS,
    ...VIDEO_STAGE_PATTERNS,
    /^\s*【?\s*场景\s*\d+/im,
  ]);
}
