import type { NormalizedStoryboardShot } from "./types";
import {
  detectActionNodes,
  splitIntoStaticFrameCandidates,
  splitSuggestionsFor,
  type ActionNode,
} from "./static-frame-normalizer";
import { compactText, sanitizePromptText, unique } from "./prompt-sanitizer";

export interface StoryboardFramePlan {
  frameIndex: number;
  frameCount: number;
  frameDescription: string;
  sourceText: string;
  actionNodes: ActionNode[];
  splitFromShot: boolean;
  splitSuggestions: string[];
}

export function planStoryboardFramesForShot(shot: NormalizedStoryboardShot): StoryboardFramePlan[] {
  if (shot.preplanned_frame) {
    const text = sanitizePromptText(shot.frame_description || shot.action || shot.source_text || "");
    return [{
      frameIndex: 0,
      frameCount: 1,
      frameDescription: compactText(text || "single static storyboard key frame", 260),
      sourceText: shot.source_text || text,
      actionNodes: detectActionNodes(text),
      splitFromShot: false,
      splitSuggestions: [],
    }];
  }

  const rawText = collectShotVisualText(shot);
  const candidates = splitIntoStaticFrameCandidates(rawText);
  const useful = candidates
    .filter((candidate) => isUsefulCandidate(candidate.text))
    .slice(0, 8);
  const meaningful = useful.length > 1
    ? useful.filter((candidate) => !isSceneHeadingOnly(candidate.text))
    : useful;

  const fallbackText = sanitizePromptText(shot.frame_description || shot.action || shot.source_text || "");
  const sourceItems = meaningful.length > 0
    ? meaningful.map((candidate) => ({
        text: candidate.text,
        sourceText: rawText,
        actionNodes: candidate.actionNodes,
      }))
    : [{
        text: compactText(fallbackText || "single static storyboard key frame", 260),
        sourceText: rawText || fallbackText,
        actionNodes: detectActionNodes(fallbackText),
      }];

  const splitSuggestions = splitSuggestionsFor(rawText);
  const frameCount = sourceItems.length;
  return sourceItems.map((item, index) => ({
    frameIndex: index,
    frameCount,
    frameDescription: item.text,
    sourceText: item.sourceText,
    actionNodes: item.actionNodes,
    splitFromShot: frameCount > 1,
    splitSuggestions,
  }));
}

function collectShotVisualText(shot: NormalizedStoryboardShot) {
  const text = [
    shot.frame_description,
    shot.action,
    shot.source_text,
  ].filter(Boolean).join("\n");
  return compactText(text, 1600);
}

function isUsefulCandidate(text: string) {
  const clean = sanitizePromptText(text);
  if (clean.length < 3) return false;
  if (/^(音效|声音|配乐|旁白|台词|对白|注意|备注|时长)/.test(clean)) return false;
  if (/剧情|人物关系|故事背景|story background|plot/i.test(clean) && detectActionNodes(clean).length === 0) return false;
  return true;
}

function isSceneHeadingOnly(text: string) {
  const clean = sanitizePromptText(text);
  if (detectActionNodes(clean).some((node) => node.key !== "environment_establishing")) return false;
  return /^[^。！？!?；;]{1,40}(?:\s*\/\s*[^。！？!?；;]{1,20}){1,4}$/.test(clean) ||
    /^场景\s*\d*\s*[:：]\s*[^。！？!?；;]{1,40}$/.test(clean);
}

export function mergeSplitSuggestions(existing: string[], text: string) {
  return unique([...existing, ...splitSuggestionsFor(text)]).slice(0, 8);
}
