import type { StoryboardAssetInput, StoryboardValidationIssue } from "./types";
import type { StoryboardAgentFramePlan, StoryboardFramePlanAgentOutput } from "./storyboard-frame-plan-schema";
import {
  DIALOGUE_PATTERNS,
  DURATION_PATTERNS,
  SOUND_PATTERNS,
  VIDEO_STAGE_PATTERNS,
  hasPattern,
  sanitizePromptText,
} from "./prompt-sanitizer";
import { hasMultipleActionNodes, splitSuggestionsFor } from "./static-frame-normalizer";
import { EXPLICIT_GORE_PATTERNS } from "./safety-rewriter";

export interface StoryboardFramePlanValidation {
  valid: boolean;
  errors: StoryboardValidationIssue[];
  warnings: StoryboardValidationIssue[];
  split_suggestions: string[];
}

function issue(
  severity: "error" | "warning",
  code: string,
  message: string,
  field?: string,
  suggestion?: string,
): StoryboardValidationIssue {
  return { severity, code, message, field, suggestion };
}

export function validateStoryboardFramePlanOutput(input: {
  output: StoryboardFramePlanAgentOutput;
  assets: StoryboardAssetInput[];
}) {
  const assetIds = new Set(input.assets.map((asset) => asset.id));
  const errors: StoryboardValidationIssue[] = [];
  const warnings: StoryboardValidationIssue[] = [];
  const splitSuggestions: string[] = [];

  if (!Array.isArray(input.output.frames)) {
    errors.push(issue("error", "missing_frames", "Agent output must contain frames[].", "frames"));
    return { valid: false, errors, warnings, split_suggestions: splitSuggestions };
  }

  if (input.output.frames.length === 0) {
    errors.push(issue("error", "empty_frames", "Agent output must contain at least one storyboard frame plan.", "frames"));
  }

  input.output.frames.forEach((frame, index) => {
    const result = validateStoryboardFramePlan(frame, assetIds, index);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    splitSuggestions.push(...result.split_suggestions);
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    split_suggestions: Array.from(new Set(splitSuggestions)).slice(0, 12),
  };
}

export function validateStoryboardFramePlan(
  frame: StoryboardAgentFramePlan,
  assetIds: Set<string>,
  index = 0,
): StoryboardFramePlanValidation {
  const errors: StoryboardValidationIssue[] = [];
  const warnings: StoryboardValidationIssue[] = [];
  const splitSuggestions: string[] = [];
  const prefix = `frames[${index}]`;
  const description = sanitizePromptText(frame.static_frame_description || "");
  const rawFrame = frame as unknown as Record<string, unknown>;

  if (!frame.shot_id) errors.push(issue("error", "missing_shot_id", "Frame plan is missing shot_id.", `${prefix}.shot_id`));
  if (!frame.scene_id) errors.push(issue("error", "missing_scene_id", "Frame plan is missing scene_id.", `${prefix}.scene_id`));
  if (!description) errors.push(issue("error", "missing_static_frame_description", "Frame plan is missing static_frame_description.", `${prefix}.static_frame_description`));
  if (!frame.subject?.description && !frame.subject?.asset_id) {
    errors.push(issue("error", "missing_subject", "Frame plan subject is missing.", `${prefix}.subject`));
  }
  if (rawFrame.positive_prompt || rawFrame.negative_prompt || rawFrame.prompt) {
    errors.push(issue("error", "prompt_in_frame_plan", "Frame plan must not contain final prompt fields; prompts are compiled by the program.", prefix));
  }

  if (hasPattern(description, SOUND_PATTERNS)) {
    errors.push(issue("error", "sound_in_frame_plan", "Frame plan contains sound effect text.", `${prefix}.static_frame_description`));
  }
  if (hasPattern(description, DURATION_PATTERNS)) {
    errors.push(issue("error", "duration_in_frame_plan", "Frame plan contains duration text.", `${prefix}.static_frame_description`));
  }
  if (hasPattern(description, DIALOGUE_PATTERNS)) {
    errors.push(issue("error", "dialogue_in_frame_plan", "Frame plan contains dialogue or subtitle wording.", `${prefix}.static_frame_description`));
  }
  if (hasPattern(description, VIDEO_STAGE_PATTERNS)) {
    errors.push(issue("error", "video_stage_in_frame_plan", "Frame plan contains video-stage wording.", `${prefix}.static_frame_description`));
  }
  if (hasPattern(description, EXPLICIT_GORE_PATTERNS)) {
    errors.push(issue("error", "gore_in_frame_plan", "Frame plan contains explicit gore.", `${prefix}.static_frame_description`));
  }
  if (hasMultipleActionNodes(description)) {
    errors.push(issue("error", "multiple_action_nodes", "Frame plan contains multiple visual action nodes.", `${prefix}.static_frame_description`, "Split this into separate storyboard frame plans."));
    splitSuggestions.push(...splitSuggestionsFor(description));
  }

  for (const assetId of collectFrameAssetIds(frame)) {
    if (!assetIds.has(assetId)) {
      errors.push(issue("error", "unknown_asset_id", `Frame plan references unknown asset_id ${assetId}.`, `${prefix}.active_assets`));
    }
  }

  const assetCount = collectFrameAssetIds(frame).length;
  if (assetCount > 4) {
    warnings.push(issue("warning", "too_many_active_assets", "Frame plan references more than 4 active assets.", `${prefix}.active_assets`));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    split_suggestions: Array.from(new Set(splitSuggestions)),
  };
}

function collectFrameAssetIds(frame: StoryboardAgentFramePlan) {
  return Array.from(new Set([
    frame.subject?.asset_id || "",
    ...(frame.active_assets?.characters ?? []).map((asset) => asset.asset_id),
    frame.active_assets?.scene?.asset_id || "",
    ...(frame.active_assets?.props ?? []).map((asset) => asset.asset_id),
  ].filter(Boolean)));
}
