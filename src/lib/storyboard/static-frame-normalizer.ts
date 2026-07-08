import {
  CAMERA_MOVEMENT_PATTERNS,
  CONTINUOUS_ACTION_PATTERNS,
  compactText,
  hasPattern,
  sanitizePromptText,
  stripStageAndDialogueLines,
  unique,
} from "./prompt-sanitizer";

export interface ActionNode {
  key: string;
  label: string;
}

export interface StaticFrameCandidate {
  text: string;
  actionNodes: ActionNode[];
  splitReason: "sentence" | "clause" | "compound_action" | "single";
}

const ACTION_NODE_DEFINITIONS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: "approach_light", label: "approaching light or threat", pattern: /远光灯|车灯|灯光|逼近|照向|迫近|headlights?|approach(?:es|ing)?|loom(?:s|ing)?/i },
  { key: "vehicle_motion", label: "vehicle motion", pattern: /车辆|汽车|卡车|车轮|轮胎|驶|冲|碾过|水坑|vehicle|car|truck|wheel|tire|puddle|splash/i },
  { key: "impact_or_fall", label: "impact or fall aftermath", pattern: /撞向|撞飞|摔|倒地|跌倒|倒在|泥泞|hit by|crash|fall(?:en)?|collapse/i },
  { key: "window_reaction", label: "window or reaction close-up", pattern: /车窗|窗边|探出|脸|表情|眼神|失控|闪电|window|face|expression|reaction|lightning/i },
  { key: "hand_detail", label: "hand or body detail", pattern: /手指|手部|手掌|垂下|抽搐|无力|detail|hand|finger|limp/i },
  { key: "door_or_threshold", label: "door or threshold action", pattern: /门口|门把|开门|推门|关门|走出|进入|door|handle|threshold/i },
  { key: "held_object", label: "held object detail", pattern: /拿起|放下|握住|抓住|攥住|递给|掏出|hold|grab|grip|hand over/i },
  { key: "reaction_face", label: "reaction face", pattern: /回头|抬头|看向|凝视|震惊|恐惧|愤怒|reaction|look(?:s)?|stare|fear|anger/i },
  { key: "environment_establishing", label: "environment establishing view", pattern: /远景|全景|环境|街道|房间|客厅|医院|公路|夜|雨|雪|establishing|wide shot|street|room|road|rain|night/i },
];

const CLAUSE_SPLIT_PATTERN =
  /(?:然后|随后|接着|之后|最终|同时|再|并且|又|转而|紧接着|下一刻|与此同时|then|afterward|finally|and then|next|meanwhile)/i;

const CAMERA_MOVEMENT_REWRITE =
  /镜头\s*(缓慢)?(推进|推近|拉远|摇移|跟拍|甩镜|环绕)[^，。.!?；;]*/g;

export function detectActionNodes(text: string): ActionNode[] {
  const clean = sanitizePromptText(text);
  return ACTION_NODE_DEFINITIONS
    .filter((definition) => definition.pattern.test(clean))
    .map(({ key, label }) => ({ key, label }));
}

export function hasMultipleActionNodes(text: string) {
  const visualNodes = detectActionNodes(text).filter((node) => node.key !== "environment_establishing");
  return visualNodes.length > 1 || hasPattern(text, CONTINUOUS_ACTION_PATTERNS);
}

export function splitIntoStaticFrameCandidates(text: string): StaticFrameCandidate[] {
  const raw = stripStageAndDialogueLines(String(text || ""))
    .replace(/\r?\n+/g, "。")
    .replace(/【\s*场景\s*\d+\s*[：:]\s*([^】\n]+?)\s*】/gi, "$1。")
    .replace(/\[[^\]]*(音效|SFX|sound|music|audio)[^\]]*\]/gi, "。");
  const sentencePieces = raw
    .split(/[。！？!?；;\n]+/)
    .map((item) => sanitizePromptText(item))
    .filter((item) => item.length >= 2);

  const pieces = sentencePieces.flatMap((piece) => splitCompoundClause(piece));
  const candidates = pieces
    .map((piece) => normalizeSingleStaticMoment(piece))
    .filter((piece) => piece.length >= 2)
    .map((piece): StaticFrameCandidate => ({
      text: piece,
      actionNodes: detectActionNodes(piece),
      splitReason: "sentence",
    }));

  return mergeAndDedupeCandidates(candidates);
}

function splitCompoundClause(piece: string) {
  const clean = sanitizePromptText(piece);
  if (!clean) return [];
  const actionNodes = detectActionNodes(clean);
  if (actionNodes.length <= 1 && !CLAUSE_SPLIT_PATTERN.test(clean)) return [clean];

  const coarse = clean
    .split(CLAUSE_SPLIT_PATTERN)
    .flatMap((item) => item.split(/[，,]/))
    .map((item) => sanitizePromptText(item))
    .filter((item) => item.length >= 2);

  if (coarse.length <= 1) return [clean];
  return coarse;
}

function mergeAndDedupeCandidates(candidates: StaticFrameCandidate[]) {
  const deduped: StaticFrameCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...candidate,
      splitReason: candidate.actionNodes.length > 1 ? "compound_action" : candidate.splitReason,
    });
  }

  if (deduped.length <= 8) return deduped;
  const scored = deduped
    .map((candidate, index) => ({ candidate, index, score: scoreVisualCandidate(candidate.text) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.candidate);
  return scored;
}

function scoreVisualCandidate(text: string) {
  let score = 0;
  if (detectActionNodes(text).length > 0) score += 4;
  if (/特写|近景|远景|全景|表情|手|车|灯|门|窗|雨|夜|房间|街|close-up|wide|detail/i.test(text)) score += 3;
  if (/剧情|关系|命运|意识|感觉|明白|plot|relationship|realizes?/i.test(text)) score -= 4;
  return score + Math.min(text.length / 80, 2);
}

function removeCameraMovement(text: string) {
  return text
    .replace(CAMERA_MOVEMENT_REWRITE, "静态构图")
    .replace(/\b(camera\s*)?(dolly|tracking|pan|tilt|zoom|crane)\b[^,.;!?]*/gi, "static composition");
}

function removeActionProcessWords(text: string) {
  return text
    .replace(/开始|正在|不断|持续|一路|逐渐|慢慢|立刻|马上|过程|连续/g, "")
    .replace(/\b(starting to|keeps?|continues?|gradually|slowly|process|sequence)\b/gi, "");
}

function normalizeDoorMoment(text: string) {
  if (!/门/.test(text) || !/冲|跑|逃|离开|出去|进入|推开/.test(text)) return "";
  const subject = text.replace(/(冲过去|跑过去|冲出|跑出|推开门跑出去|推开门离开|离开|出去|进入).*/g, "").trim();
  return compactText(`${subject || "人物"}停在门口，手贴近门把，身体前倾，画面定格在即将行动的一瞬`, 260);
}

function normalizeSingleStaticMoment(text: string) {
  const clean = sanitizePromptText(text);
  const doorMoment = normalizeDoorMoment(clean);
  if (doorMoment) return doorMoment;

  return compactText(
    removeActionProcessWords(removeCameraMovement(clean))
      .replace(/冲过去抓住|跑过去抓住/g, "身体前倾，手刚刚抓住")
      .replace(/\b(run to grab|rushes to grab)\b/gi, "leans forward with a hand already gripping"),
    300,
  );
}

export function normalizeStaticFrameDescription(input: {
  text: string;
  fallback?: string;
}) {
  const candidates = splitIntoStaticFrameCandidates(input.text || input.fallback || "");
  const chosen = candidates[0]?.text || sanitizePromptText(input.text || input.fallback || "");
  return compactText(chosen || input.fallback || "single static storyboard key frame", 300);
}

export function splitSuggestionsFor(text: string) {
  const candidates = splitIntoStaticFrameCandidates(text);
  if (candidates.length > 1) return unique(candidates.map((candidate) => candidate.text)).slice(0, 8);
  const nodes = detectActionNodes(text);
  if (nodes.length > 1) return nodes.map((node) => `Create a separate static frame for ${node.label}.`);
  return [];
}

export function isStaticFrameDescription(text: string) {
  return !hasPattern(text, CONTINUOUS_ACTION_PATTERNS) &&
    !hasPattern(text, CAMERA_MOVEMENT_PATTERNS) &&
    !hasMultipleActionNodes(text);
}
