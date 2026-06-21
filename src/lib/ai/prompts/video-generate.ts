import { getPromptDefinition } from "./registry";

type CharacterRef = { name: string; visualHint?: string | null };

function detectLanguage(text: string): "zh" | "en" {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g);
  return chineseChars && chineseChars.length > text.length * 0.1 ? "zh" : "en";
}

function getLabels(lang: "zh" | "en") {
  return lang === "zh"
    ? {
        characterAppearance: "角色形象",
        dialogueLipSync: "对白口型",
        offscreenVoice: "画外音",
        camera: "镜头运动",
        duration: "时长",
        interpolation: "关键帧插值",
        openingFrame: "起始帧",
        closingFrame: "结束帧",
        videoScript: "视频脚本",
        frameAnchors: "帧锚点",
        separator: "，",
        period: "。",
        colon: "：",
        paren: { open: "（", close: "）" },
      }
    : {
        characterAppearance: "Character Appearance",
        dialogueLipSync: "Dialogue Lip Sync",
        offscreenVoice: "Off-screen Voice",
        camera: "Camera Movement",
        duration: "Duration",
        interpolation: "Keyframe Interpolation",
        openingFrame: "Opening Frame",
        closingFrame: "Closing Frame",
        videoScript: "Video Script",
        frameAnchors: "Frame Anchors",
        separator: ", ",
        period: ".",
        colon: ": ",
        paren: { open: "(", close: ")" },
      };
}

function buildCharacterLine(characters?: CharacterRef[], lang: "zh" | "en" = "zh"): string | null {
  const withHints = (characters ?? []).filter((c) => c.visualHint);
  if (!withHints.length) return null;
  const L = getLabels(lang);
  return withHints.map((c) => `${c.name}${L.paren.open}${c.visualHint}${L.paren.close}`).join(L.separator);
}

/**
 * Resolve a single slot value: use slotContents override, then registry default, then hardcoded fallback.
 */
function resolveSlot(
  slotContents: Record<string, string> | undefined,
  promptKey: string,
  slotKey: string,
  hardcodedFallback: string
): string {
  if (slotContents && slotKey in slotContents) return slotContents[slotKey];
  const def = getPromptDefinition(promptKey);
  if (def) {
    const s = def.slots.find((sl) => sl.key === slotKey);
    if (s) return s.defaultContent;
  }
  return hardcodedFallback;
}

export function buildReferenceVideoPrompt(params: {
  videoScript: string;
  cameraDirection: string;
  duration?: number;
  characters?: CharacterRef[];
  dialogues?: Array<{ characterName: string; text: string; offscreen?: boolean; visualHint?: string }>;
  visualStyle?: string;
  family?: "ltx" | "wan" | "seedance" | "generic";
  slotContents?: Record<string, string>;
  previousShotSummary?: string;
}): string {
  const lang = detectLanguage(params.videoScript);
  const L = getLabels(lang);
  const lines: string[] = [];

  if (params.duration) {
    const capped = Math.min(params.duration, 15);
    lines.push(`${L.duration}${L.colon}${capped}s${L.period}`);
    lines.push(``);
  }

  if (params.previousShotSummary) {
    const hook = resolveSlot(params.slotContents, "ref_video_generate", "continuity_hook", "");
    if (hook.includes("[描述]")) {
      lines.push(hook.replace("[描述]", params.previousShotSummary));
    } else {
      lines.push(`${lang === "zh" ? "前情" : "Previous shot"}${L.colon}${params.previousShotSummary}${L.period}`);
    }
    lines.push(``);
  }

  const charLine = buildCharacterLine(params.characters, lang);
  if (charLine) {
    lines.push(`${L.characterAppearance}${L.colon}${charLine}${L.period}`);
    lines.push(``);
  }

  if (params.visualStyle) {
    lines.push(`${lang === "zh" ? "视觉风格" : "Visual Style"}${L.colon}${params.visualStyle}${L.period}`);
    lines.push(``);
  }

  if (params.family === "wan") {
    lines.push(lang === "zh"
      ? "写作策略：保持主体稳定，动作单线推进，避免复杂跳切和多重视角突变。"
      : "Writing strategy: keep the subject stable, use one continuous action line, avoid complex jump cuts and abrupt perspective changes.");
    lines.push(``);
  }

  if (params.family === "seedance") {
    lines.push(lang === "zh"
      ? "写作策略：更像电影分镜散文，镜头运动、情绪外化和环境反应要具体，但整体保持自然流动。"
      : "Writing strategy: cinematic storyboard prose, with concrete camera motion, emotional externalization, and environmental reactions while staying naturally flowing.");
    lines.push(``);
  }

  lines.push(params.videoScript);

  lines.push(``);
  lines.push(`${L.camera}${L.colon}${params.cameraDirection}${L.period}`);

  if (params.dialogues?.length) {
    // Resolve dialogue format slot to extract labels
    const dialogueFormatText = resolveSlot(
      params.slotContents,
      "ref_video_generate",
      "dialogue_format",
      ""
    );

    // Extract labels from the slot content, or use lang-aware defaults
    const defaultOnScreen = lang === "zh" ? "【对白口型】" : "[Dialogue Lip Sync]";
    const defaultOffScreen = lang === "zh" ? "【画外音】" : "[Off-screen Voice]";
    const onScreenLabel = extractLabel(dialogueFormatText, "画内对白", defaultOnScreen);
    const offScreenLabel = extractLabel(dialogueFormatText, "画外旁白", defaultOffScreen);

    lines.push(``);
    for (const d of params.dialogues) {
      if (d.offscreen) {
        lines.push(`${offScreenLabel}${d.characterName}: "${d.text}"`);
      } else {
        const label = d.visualHint ? `${d.characterName}${L.paren.open}${d.visualHint}${L.paren.close}` : d.characterName;
        lines.push(`${onScreenLabel}${label}: "${d.text}"`);
      }
    }
  }

  return lines.join("\n");
}

export type SegmentContext = {
  index: number;
  total: number;
};

export function buildVideoPrompt(params: {
  videoScript: string;
  cameraDirection: string;
  startFrameDesc?: string;
  endFrameDesc?: string;
  sceneDescription?: string;
  duration?: number;
  characters?: CharacterRef[];
  dialogues?: Array<{ characterName: string; text: string; offscreen?: boolean; visualHint?: string }>;
  visualStyle?: string;
  family?: "ltx" | "wan" | "seedance" | "generic";
  slotContents?: Record<string, string>;
  segmentContext?: SegmentContext;
  previousShotSummary?: string;
}): string {
  const lang = detectLanguage(params.videoScript);
  const L = getLabels(lang);
  const lines: string[] = [];

  if (params.duration) {
    const capped = Math.min(params.duration, 15);
    lines.push(`${L.duration}${L.colon}${capped}s${L.period}`);
    lines.push(``);
  }

  if (params.previousShotSummary) {
    const hook = resolveSlot(params.slotContents, "video_generate", "continuity_hook", "");
    if (hook.includes("[描述]")) {
      lines.push(hook.replace("[描述]", params.previousShotSummary));
    } else {
      lines.push(`${lang === "zh" ? "前情" : "Previous shot"}${L.colon}${params.previousShotSummary}${L.period}`);
    }
    lines.push(``);
  }

  const charLine = buildCharacterLine(params.characters, lang);
  if (charLine) {
    lines.push(`${L.characterAppearance}${L.colon}${charLine}${L.period}`);
    lines.push(``);
  }

  if (params.visualStyle) {
    lines.push(`${lang === "zh" ? "视觉风格" : "Visual Style"}${L.colon}${params.visualStyle}${L.period}`);
    lines.push(``);
  }

  if (params.family === "wan") {
    lines.push(lang === "zh"
      ? "写作策略：主体稳定，动作单线推进，避免复杂跳切和大幅视角切换。"
      : "Writing strategy: keep the subject stable, use a single continuous action line, avoid complex jump cuts and large perspective changes.");
    lines.push(``);
  }

  if (params.family === "seedance") {
    lines.push(lang === "zh"
      ? "写作策略：使用更自然的分镜散文表达，镜头运动、环境反应与情绪节拍要清晰具体。"
      : "Writing strategy: use more natural storyboard prose, with clear camera motion, environmental reactions, and emotional beats.");
    lines.push(``);
  }

  // Interpolation header — short and clean for video model input
  if (params.segmentContext && params.segmentContext.total > 1) {
    const seg = params.segmentContext;
    const header = lang === "zh"
      ? `【第${seg.index + 1}段/共${seg.total}段】`
      : `[Segment ${seg.index + 1}/${seg.total}]`;
    lines.push(header);
    lines.push(``);
  }

  lines.push(params.videoScript);

  lines.push(``);
  lines.push(`${L.camera}${L.colon}${params.cameraDirection}${L.period}`);

  // For non-first segments, omit startFrameDesc (mid-point has no meaningful start description)
  const showStartFrame = params.segmentContext
    ? params.segmentContext.index === 0 && !!params.startFrameDesc
    : !!params.startFrameDesc;
  const hasEnd = !!params.endFrameDesc;
  if (showStartFrame || hasEnd) {
    // Resolve frame_anchors slot for label text
    const frameAnchorsText = resolveSlot(
      params.slotContents,
      "video_generate",
      "frame_anchors",
      ""
    );

    // Extract anchor header and labels from slot content, or use lang-aware defaults
    const defaultAnchorHeader = lang === "zh" ? "[帧锚点]" : "[FRAME ANCHORS]";
    const defaultOpeningLabel = lang === "zh" ? "起始帧：" : "Opening frame:";
    const defaultClosingLabel = lang === "zh" ? "结束帧：" : "Closing frame:";
    const anchorHeader = extractAnchorHeader(frameAnchorsText, defaultAnchorHeader);
    const openingLabel = extractFrameLabel(frameAnchorsText, "首帧", defaultOpeningLabel);
    const closingLabel = extractFrameLabel(frameAnchorsText, "尾帧", defaultClosingLabel);

    lines.push(``);
    lines.push(anchorHeader);
    if (showStartFrame) lines.push(`${openingLabel} ${params.startFrameDesc}`);
    if (hasEnd) lines.push(`${closingLabel} ${params.endFrameDesc}`);
  }

  if (params.dialogues?.length) {
    // Resolve dialogue format slot to extract labels
    const dialogueFormatText = resolveSlot(
      params.slotContents,
      "video_generate",
      "dialogue_format",
      ""
    );

    const defaultOnScreen = lang === "zh" ? "【对白口型】" : "[Dialogue Lip Sync]";
    const defaultOffScreen = lang === "zh" ? "【画外音】" : "[Off-screen Voice]";
    const onScreenLabel = extractLabel(dialogueFormatText, "画内对白", defaultOnScreen);
    const offScreenLabel = extractLabel(dialogueFormatText, "画外旁白", defaultOffScreen);

    lines.push(``);
    for (const d of params.dialogues) {
      if (d.offscreen) {
        lines.push(`${offScreenLabel}${d.characterName}: "${d.text}"`);
      } else {
        const label = d.visualHint ? `${d.characterName}${L.paren.open}${d.visualHint}${L.paren.close}` : d.characterName;
        lines.push(`${onScreenLabel}${label}: "${d.text}"`);
      }
    }
  }

  return lines.join("\n");
}

// ── Helpers for extracting labels from slot content ──────

/**
 * Extract dialogue label (e.g. 【对白口型】or 【画外音】) from the slot format text.
 */
function extractLabel(
  slotText: string,
  _lineHint: string,
  fallback: string
): string {
  if (!slotText) return fallback;
  // Match patterns like 【对白口型】 or 【画外音】 from the slot content
  const lines = slotText.split("\n");
  for (const line of lines) {
    if (line.includes(_lineHint)) {
      const match = line.match(/(【[^】]+】)/);
      if (match) return match[1];
    }
  }
  return fallback;
}

/**
 * Extract the anchor section header (e.g. [FRAME ANCHORS] or [帧锚点]) from slot text.
 */
function extractAnchorHeader(slotText: string, fallback: string): string {
  if (!slotText) return fallback;
  const match = slotText.match(/^\[([^\]]+)\]/m);
  if (match) return `[${match[1]}]`;
  return fallback;
}

/**
 * Extract frame label (e.g. "Opening frame:" or "首帧：") from slot text.
 */
function extractFrameLabel(slotText: string, lineHint: string, fallback: string): string {
  if (!slotText) return fallback;
  const lines = slotText.split("\n");
  for (const line of lines) {
    if (line.includes(lineHint)) {
      // Extract label before the placeholder (e.g. "首帧：" from "首帧：{{START_FRAME_DESC}}")
      const match = line.match(/^([^{]+)/);
      if (match) return match[1].trim();
    }
  }
  return fallback;
}
