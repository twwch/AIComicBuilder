import type {
  StoryboardActiveAssets,
  StoryboardCompilerInput,
  StoryboardCompilerResult,
  StoryboardFrameSpec,
  StoryboardLookup,
  StoryboardProductionBibleInput,
} from "./types";
import { activeAssetCount, buildStoryboardLookup, normalizeStoryboardShot } from "./active-asset-selector";
import { buildStoryboardFrame } from "./storyboard-frame-builder";
import { compactText, sanitizePromptText, unique } from "./prompt-sanitizer";
import { normalizeStaticFrameDescription, splitIntoStaticFrameCandidates } from "./static-frame-normalizer";
import { rewriteUnsafeVisuals } from "./safety-rewriter";
import { resolveLightingStyle } from "./lighting-style-resolver";
import { validateStoryboardPrompt } from "./storyboard-prompt-validator";
import { planStoryboardFramesForShot } from "./storyboard-frame-planner";

const NEGATIVE_TERMS = [
  "subtitles",
  "captions",
  "dialogue text",
  "sound effect text",
  "duration labels",
  "UI",
  "watermark",
  "logo",
  "extra people",
  "unbound character",
  "inconsistent identity",
  "explicit gore",
  "graphic injury",
  "visible blood",
  "multiple sequential actions",
  "video timeline",
  "motion blur from camera movement",
];

function assetName(lookup: StoryboardLookup, assetId: string) {
  return lookup.assetsById.get(assetId)?.name || assetId;
}

function activeReferenceLines(activeAssets: StoryboardActiveAssets, lookup: StoryboardLookup) {
  const characters = activeAssets.characters.map((asset) =>
    `${assetName(lookup, asset.asset_id)} (${asset.asset_id}, ${asset.role_in_frame})`,
  );
  const scene = activeAssets.scene
    ? `${assetName(lookup, activeAssets.scene.asset_id)} (${activeAssets.scene.asset_id})`
    : "";
  const props = activeAssets.props.map((asset) =>
    `${assetName(lookup, asset.asset_id)} (${asset.asset_id}, ${asset.role_in_frame})`,
  );
  return [
    `Characters: ${characters.length ? characters.join("; ") : "none"}`,
    `Scene: ${scene || "missing scene reference"}`,
    `Props: ${props.length ? props.join("; ") : "none"}`,
  ];
}

function compilePositivePrompt(frame: StoryboardFrameSpec, lookup: StoryboardLookup) {
  const subjectName = frame.subject.asset_id ? assetName(lookup, frame.subject.asset_id) : "unclear subject";
  return [
    "Storyboard key frame image, one static still frame, not a video prompt.",
    "",
    "Static frame:",
    frame.frame_description,
    "",
    "Subject:",
    `${frame.subject.type}: ${subjectName}. ${frame.subject.description}`,
    "",
    "Composition:",
    `${frame.camera.shot_type}, ${frame.camera.angle}, ${frame.camera.framing}. ${frame.composition}`,
    "",
    "Active reference assets:",
    ...activeReferenceLines(frame.active_assets, lookup),
    "",
    "Style:",
    `${frame.style.visual_style}. ${frame.style.lighting}. ${frame.style.atmosphere}. Era: ${frame.style.era}.`,
    "",
    "Safety constraints:",
    "No subtitles, no captions, no dialogue text, no sound effect text, no duration label, no UI, no watermark, no explicit gore, one frozen visual moment only.",
  ].join("\n");
}

function compileNegativePrompt(frame: StoryboardFrameSpec, bible?: StoryboardProductionBibleInput | null) {
  const bibleNegative = compactText(bible?.negativePromptTemplate || "", 260);
  const eraText = `${frame.style.era} ${bible?.eraConstraints ?? ""}`;
  const periodNegatives = /1980|1983|八十|80年代|1980s/i.test(eraText)
    ? ["ancient costume", "hanfu", "fantasy clothing", "contemporary fashion", "modern LED screen", "smartphone"]
    : [];
  return unique([...NEGATIVE_TERMS, ...periodNegatives, bibleNegative]).join(", ");
}

function statusRank(status: string) {
  if (status === "invalid") return 3;
  if (status === "needs_review") return 2;
  return 1;
}

function aggregateValidation(frames: StoryboardFrameSpec[]): StoryboardCompilerResult["validation"] {
  const errors = frames.flatMap((frame) => frame.validation.errors.map((item) => ({ ...item, field: `${frame.frame_id}.${item.field ?? ""}` })));
  const warnings = frames.flatMap((frame) => frame.validation.warnings.map((item) => ({ ...item, field: `${frame.frame_id}.${item.field ?? ""}` })));
  const status = frames.reduce<"valid" | "needs_review" | "invalid">((current, frame) =>
    statusRank(frame.validation.status) > statusRank(current) ? frame.validation.status : current,
  "valid");
  return { status, errors, warnings };
}

function buildStats(frames: StoryboardFrameSpec[]) {
  const totalAssets = frames.reduce((sum, frame) => sum + activeAssetCount(frame.active_assets), 0);
  return {
    total_frames: frames.length,
    valid_frames: frames.filter((frame) => frame.validation.status === "valid").length,
    needs_review_frames: frames.filter((frame) => frame.validation.status === "needs_review").length,
    invalid_frames: frames.filter((frame) => frame.validation.status === "invalid").length,
    average_active_assets_per_frame: frames.length ? Number((totalAssets / frames.length).toFixed(2)) : 0,
  };
}

export function compileStoryboardFrames(input: StoryboardCompilerInput): StoryboardCompilerResult {
  const lookup = buildStoryboardLookup(input);
  const allAssetIds = Array.from(lookup.assetsById.keys());
  const shots = input.locked_shots
    .map((shot, index) => normalizeStoryboardShot(shot, index, lookup))
    .filter((shot) => !shot.lock_status || shot.lock_status === "locked");

  const storyboardFrames = shots.flatMap((shot, shotIndex): StoryboardFrameSpec[] => {
    const framePlans = planStoryboardFramesForShot(shot);
    return framePlans.map((framePlan): StoryboardFrameSpec => {
      const frameBase = buildStoryboardFrame({
        shot,
        shotIndex,
        framePlan,
        lookup,
        productionBible: input.productionBible,
      });
      const withPrompts: StoryboardFrameSpec = {
        ...frameBase,
        positive_prompt: "",
        negative_prompt: "",
        validation: { status: "valid", errors: [], warnings: [] },
      };
      withPrompts.positive_prompt = compilePositivePrompt(withPrompts, lookup);
      withPrompts.negative_prompt = compileNegativePrompt(withPrompts, input.productionBible);
      withPrompts.validation = {
        ...validateStoryboardPrompt(withPrompts, { allAssetIds }),
        split_suggestions: framePlan.splitSuggestions,
      };
      return withPrompts;
    });
  });

  const stats = buildStats(storyboardFrames);
  const validation = aggregateValidation(storyboardFrames);
  return {
    compiler: "storyboard_prompt_compiler_v1",
    storyboard_frames: storyboardFrames,
    validation,
    stats,
    summary: {
      total: stats.total_frames,
      valid: stats.valid_frames,
      needs_review: stats.needs_review_frames,
      invalid: stats.invalid_frames,
      errors: validation.errors.length,
      warnings: validation.warnings.length,
    },
  };
}

function referenceLine(label: string, names: string[]) {
  const refs = unique(names);
  return `${label}: ${refs.length ? refs.join("; ") : "none"}`;
}

export function buildStoryboardPromptPreviewFromText(input: {
  title?: string;
  sourceText: string;
  characterNames?: string[];
  sceneNames?: string[];
  propNames?: string[];
  productionBible?: StoryboardProductionBibleInput | null;
}) {
  const staticText = normalizeStaticFrameDescription({
    text: splitIntoStaticFrameCandidates(input.sourceText)[0]?.text || input.sourceText,
    fallback: input.title,
  });
  const safety = rewriteUnsafeVisuals(staticText);
  const style = resolveLightingStyle({
    shot: {
      shot_id: "preview",
      episode_id: "",
      scene_id: "",
      shot_type: "",
      frame_description: safety.text,
      action: safety.text,
      emotion: "",
      composition: "",
      camera: { shot_type: "storyboard key frame", angle: "eye-level", framing: "16:9 horizontal frame", movement: "" },
      characters: [],
      scene_asset: null,
      props: [],
      dialogue_text: "",
      voiceover: "",
      sound_effect: "",
      duration: "",
      lock_status: "",
      source_text: input.sourceText,
    },
    frameDescription: safety.text,
    sceneText: input.sceneNames?.join(" "),
    productionBible: input.productionBible,
  });

  const subject =
    input.characterNames?.[0] ||
    input.propNames?.[0] ||
    input.sceneNames?.[0] ||
    sanitizePromptText(input.title || "visible storyboard subject");

  return [
    "Storyboard key frame image, one static still frame, not a video prompt.",
    "",
    "Static frame:",
    safety.text,
    "",
    "Subject:",
    subject,
    "",
    "Composition:",
    `16:9 horizontal frame, eye-level static composition, one frozen visual moment only${input.title ? `, scene context: ${sanitizePromptText(input.title)}` : ""}.`,
    "",
    "Active reference assets:",
    referenceLine("Characters", input.characterNames ?? []),
    referenceLine("Scene", input.sceneNames ?? []),
    referenceLine("Props", input.propNames ?? []),
    "",
    "Style:",
    `${style.visual_style}. ${style.lighting}. ${style.atmosphere}. Era: ${style.era}.`,
    "",
    "Exclude:",
    "subtitles, captions, dialogue text, sound effect text, duration labels, UI, watermark, explicit gore, graphic injury, multiple sequential actions.",
  ].join("\n");
}
