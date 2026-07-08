import type {
  NormalizedStoryboardShot,
  StoryboardFrameSpec,
  StoryboardLookup,
  StoryboardProductionBibleInput,
} from "./types";
import type { StoryboardFramePlan } from "./storyboard-frame-planner";
import { selectActiveAssets } from "./active-asset-selector";
import { compactText } from "./prompt-sanitizer";
import { rewriteUnsafeVisuals } from "./safety-rewriter";
import { normalizeStaticFrameDescription } from "./static-frame-normalizer";
import { resolveLightingStyle } from "./lighting-style-resolver";

function safeIdPart(value: string, fallback: string) {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || fallback;
}

function buildFrameId(shot: NormalizedStoryboardShot, shotIndex: number, frameIndex: number) {
  if (shot.planned_frame_id) return safeIdPart(shot.planned_frame_id, `frame_${String(frameIndex + 1).padStart(2, "0")}`);
  const episode = safeIdPart(shot.episode_id, "ep");
  const scene = safeIdPart(shot.scene_id, "scene");
  const shotId = safeIdPart(shot.shot_id, `shot_${String(shotIndex + 1).padStart(2, "0")}`);
  return `${episode}_${scene}_${shotId}_frame${String(frameIndex + 1).padStart(2, "0")}`;
}

function buildComposition(shot: NormalizedStoryboardShot, frameDescription: string) {
  return compactText(
    shot.composition ||
    shot.camera.framing ||
    `${shot.shot_type || shot.camera.shot_type || "storyboard"} composition focused on one frozen visual moment: ${frameDescription}`,
    260,
  );
}

function buildCamera(shot: NormalizedStoryboardShot) {
  return {
    shot_type: shot.camera.shot_type || shot.shot_type || "storyboard key frame",
    angle: shot.camera.angle || "eye-level",
    framing: shot.camera.framing || shot.composition || "clear single-frame composition",
    movement_removed: true as const,
  };
}

export function buildStoryboardFrame(input: {
  shot: NormalizedStoryboardShot;
  shotIndex: number;
  framePlan?: StoryboardFramePlan;
  lookup: StoryboardLookup;
  productionBible?: StoryboardProductionBibleInput | null;
}): Omit<StoryboardFrameSpec, "positive_prompt" | "negative_prompt" | "validation"> {
  const staticDescription = normalizeStaticFrameDescription({
    text: input.framePlan?.frameDescription || input.shot.frame_description || input.shot.action,
    fallback: input.shot.action || input.shot.source_text,
  });
  const safety = rewriteUnsafeVisuals(staticDescription);
  const frameDescription = safety.text;
  const active = selectActiveAssets({
    shot: input.shot,
    frameDescription,
    lookup: input.lookup,
  });
  const sceneText = active.bound.scene?.description || active.bound.scene?.name || "";
  const style = resolveLightingStyle({
    shot: input.shot,
    sceneText,
    frameDescription,
    productionBible: input.productionBible,
  });

  return {
    frame_id: buildFrameId(input.shot, input.shotIndex, input.framePlan?.frameIndex ?? 0),
    shot_id: input.shot.shot_id,
    episode_id: input.shot.episode_id,
    scene_id: input.shot.scene_id,
    subject: active.subject,
    active_assets: active.activeAssets,
    static_frame_description: frameDescription,
    frame_description: frameDescription,
    composition: buildComposition(input.shot, frameDescription),
    camera: buildCamera(input.shot),
    style,
    metadata: {
      dialogue_text: input.shot.dialogue_text,
      sound_effect: input.shot.sound_effect,
      duration: input.shot.duration,
      voiceover: input.shot.voiceover,
      source_text: input.framePlan?.sourceText || input.shot.source_text,
      split_from_shot: input.framePlan?.splitFromShot || false,
      frame_index: input.framePlan?.frameIndex ?? 0,
      frame_count: input.framePlan?.frameCount ?? 1,
      safety_rewrites: safety.rewrites,
    },
    status: "draft",
  };
}
