import { cleanScriptText, structureScriptText } from "@/lib/script-structure";

export type ShotGeneratorAssetType = "character" | "scene" | "prop";
export type ShotRole = "establishing" | "dialogue_action" | "reaction_detail";
export type ValidationSeverity = "error" | "warning";

export interface ShotGeneratorAsset {
  id: string;
  type: ShotGeneratorAssetType;
  name: string;
  aliases?: string[];
  description?: string;
  variantId?: string | null;
  variantName?: string | null;
}

export interface ShotGeneratorInput {
  script: string;
  assets?: ShotGeneratorAsset[];
  productionBible?: unknown;
}

export interface GeneratedEpisode {
  id: string;
  episode_index: number;
  title: string;
  source_range: SourceRange;
  scene_ids: string[];
}

export interface GeneratedScene {
  id: string;
  episode_id: string;
  episode_index: number;
  scene_index: number;
  title: string;
  location_name: string;
  scene_asset_id: string | null;
  time_of_day: string;
  source_range: SourceRange;
  character_asset_ids: string[];
  prop_asset_ids: string[];
  shot_ids: string[];
}

export interface GeneratedShotSpec {
  id: string;
  episode_id: string;
  scene_id: string;
  episode_index: number;
  scene_index: number;
  shot_index: number;
  sequence: number;
  shot_role: ShotRole;
  shot_type: string;
  camera: {
    shot_size: string;
    angle: string;
    movement: string;
    composition: string;
  };
  action: string;
  dialogue: string;
  character_asset_ids: string[];
  scene_asset_id: string | null;
  prop_asset_ids: string[];
  duration_seconds: number;
  source_text: string;
  source_range: SourceRange;
  generation_ready: boolean;
  single_frame_constraints: string[];
}

export interface ShotGeneratorValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  target_id?: string;
}

export interface ShotGeneratorValidationReport {
  passed: boolean;
  issues: ShotGeneratorValidationIssue[];
}

export interface ShotGeneratorResult {
  pipeline: "shot_generator_v1";
  episodes: GeneratedEpisode[];
  scenes: GeneratedScene[];
  shots: GeneratedShotSpec[];
  shot_spec: GeneratedShotSpec[];
  validation: ShotGeneratorValidationReport;
  stats: {
    episode_count: number;
    scene_count: number;
    shot_count: number;
    target_scenes_per_episode: string;
    target_shots_per_scene: string;
    llm_used_for_shots: false;
  };
}

interface SourceRange {
  start: number;
  end: number;
}

interface TextSegment {
  text: string;
  start: number;
  end: number;
}

interface DialogueBeat extends TextSegment {
  character?: string;
  dialogue?: string;
}

const MIN_SCENES_PER_EPISODE = 6;
const MAX_SCENES_PER_EPISODE = 10;
const MIN_SHOTS_PER_SCENE = 3;
const MAX_SHOTS_PER_SCENE = 8;

const COMMON_LOCATIONS = [
  "客厅",
  "卧室",
  "厨房",
  "院子",
  "门口",
  "医院",
  "病房",
  "走廊",
  "办公室",
  "会议室",
  "学校",
  "教室",
  "工厂",
  "车间",
  "公路",
  "街道",
  "车内",
  "民政局",
  "餐厅",
  "码头",
  "火车站",
  "派出所",
];

function pad3(value: number) {
  return String(value).padStart(3, "0");
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number) {
  const compacted = compactWhitespace(value);
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength).trim()}...`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function getAssetTerms(asset: ShotGeneratorAsset) {
  return unique([asset.name, ...(asset.aliases ?? [])]);
}

function textMentionsTerm(text: string, term: string) {
  if (!term) return false;
  return text.toLowerCase().includes(term.toLowerCase());
}

function findAssetsInText(
  text: string,
  assets: ShotGeneratorAsset[] | undefined,
  type: ShotGeneratorAssetType,
) {
  return (assets ?? []).filter((asset) => asset.type === type && getAssetTerms(asset).some((term) => textMentionsTerm(text, term)));
}

function findSceneAsset(text: string, assets: ShotGeneratorAsset[] | undefined) {
  return findAssetsInText(text, assets, "scene")[0] ?? null;
}

function inferLocationName(text: string, title: string, assets: ShotGeneratorAsset[] | undefined) {
  const sceneAsset = findSceneAsset(text, assets);
  if (sceneAsset) return sceneAsset.name;

  const headingLocation = compactWhitespace(title)
    .replace(/^(scene|episode|full script)\s*\d*[:\s-]*/i, "")
    .replace(/^第\s*\S+\s*场[:：\s-]*/, "");
  if (headingLocation && headingLocation.length <= 24) return headingLocation;

  const matchedLocation = COMMON_LOCATIONS.find((location) => text.includes(location));
  return matchedLocation ?? "unspecified location";
}

function inferTimeOfDay(text: string) {
  if (/[夜晚间]|晚上|深夜|夜色/.test(text)) return "night";
  if (/清晨|早晨|黎明|一早|晨/.test(text)) return "morning";
  if (/傍晚|黄昏|夕阳/.test(text)) return "dusk";
  if (/中午|午后/.test(text)) return "noon";
  if (/白天|上午|下午|日光|阳光/.test(text)) return "day";
  return "unspecified";
}

function getNonEmptyLineSegments(text: string, absoluteStart: number) {
  const segments: TextSegment[] = [];
  const lineRegex = /[^\n]+/g;
  for (const match of text.matchAll(lineRegex)) {
    const raw = match[0] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const relativeStart = (match.index ?? 0) + raw.indexOf(trimmed);
    segments.push({
      text: trimmed,
      start: absoluteStart + relativeStart,
      end: absoluteStart + relativeStart + trimmed.length,
    });
  }
  return segments;
}

function getParagraphSegments(text: string, absoluteStart: number) {
  const segments: TextSegment[] = [];
  const paragraphRegex = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
  for (const match of text.matchAll(paragraphRegex)) {
    const raw = match[0] ?? "";
    const trimmed = raw.trim();
    if (trimmed.length < 8) continue;
    const relativeStart = (match.index ?? 0) + raw.indexOf(trimmed);
    segments.push({
      text: trimmed,
      start: absoluteStart + relativeStart,
      end: absoluteStart + relativeStart + trimmed.length,
    });
  }
  return segments;
}

function getSentenceSegments(text: string, absoluteStart: number) {
  const segments: TextSegment[] = [];
  const sentenceRegex = /[^。！？!?；;\n]+[。！？!?；;]?/g;
  for (const match of text.matchAll(sentenceRegex)) {
    const raw = match[0] ?? "";
    const trimmed = raw.trim();
    if (trimmed.length < 4) continue;
    const relativeStart = (match.index ?? 0) + raw.indexOf(trimmed);
    segments.push({
      text: trimmed,
      start: absoluteStart + relativeStart,
      end: absoluteStart + relativeStart + trimmed.length,
    });
  }
  return segments;
}

function groupSegments(segments: TextSegment[], targetCount: number) {
  if (segments.length <= targetCount) return segments;

  const groups: TextSegment[] = [];
  const totalLength = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  const targetLength = Math.max(1, Math.ceil(totalLength / targetCount));
  let current: TextSegment[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) return;
    groups.push({
      text: current.map((segment) => segment.text).join("\n"),
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
    currentLength = 0;
  };

  for (const segment of segments) {
    const remainingSegments = segments.length - segments.indexOf(segment);
    const remainingGroups = targetCount - groups.length;
    if (current.length > 0 && currentLength >= targetLength && remainingSegments >= remainingGroups) {
      flush();
    }
    current.push(segment);
    currentLength += segment.text.length;
  }
  flush();

  while (groups.length > targetCount) {
    const last = groups.pop();
    const previous = groups.at(-1);
    if (!last || !previous) break;
    previous.text = `${previous.text}\n${last.text}`;
    previous.end = last.end;
  }

  return groups;
}

function splitEpisodeIntoSceneSegments(text: string, absoluteStart: number, targetCount: number) {
  const paragraphSegments = getParagraphSegments(text, absoluteStart);
  const lineSegments = getNonEmptyLineSegments(text, absoluteStart);
  const sentenceSegments = getSentenceSegments(text, absoluteStart);
  const baseSegments =
    paragraphSegments.length >= targetCount
      ? paragraphSegments
      : lineSegments.length >= targetCount
        ? lineSegments
        : sentenceSegments.length > 0
          ? sentenceSegments
          : [{ text, start: absoluteStart, end: absoluteStart + text.length }];

  return groupSegments(baseSegments, targetCount);
}

function getTargetSceneCount(text: string) {
  if (text.length < 900) return Math.min(MIN_SCENES_PER_EPISODE, Math.max(1, getSentenceSegments(text, 0).length));
  return clamp(Math.round(text.length / 1400), MIN_SCENES_PER_EPISODE, MAX_SCENES_PER_EPISODE);
}

function buildSceneSegmentsForEpisode(params: {
  episodeText: string;
  episodeStart: number;
  explicitScenes: Array<{ title: string; text: string; startIndex: number; endIndex: number }>;
}) {
  const { episodeText, episodeStart, explicitScenes } = params;
  if (explicitScenes.length >= MIN_SCENES_PER_EPISODE && explicitScenes.length <= MAX_SCENES_PER_EPISODE) {
    return explicitScenes.map((scene) => ({
      title: scene.title,
      text: scene.text,
      start: scene.startIndex,
      end: scene.endIndex,
    }));
  }

  if (explicitScenes.length > MAX_SCENES_PER_EPISODE) {
    return groupSegments(
      explicitScenes.map((scene) => ({
        text: scene.text,
        start: scene.startIndex,
        end: scene.endIndex,
      })),
      MAX_SCENES_PER_EPISODE,
    ).map((segment, index) => ({
      ...segment,
      title: `Scene ${index + 1}`,
    }));
  }

  const targetSceneCount = getTargetSceneCount(episodeText);
  return splitEpisodeIntoSceneSegments(episodeText, episodeStart, targetSceneCount).map((segment, index) => ({
    ...segment,
    title: explicitScenes[index]?.title || `Scene ${index + 1}`,
  }));
}

function parseDialogueBeats(text: string, absoluteStart: number): DialogueBeat[] {
  const beats: DialogueBeat[] = [];
  const lines = getNonEmptyLineSegments(text, absoluteStart);

  for (const line of lines) {
    const match = line.text.match(/^([^:：\s]{1,16})\s*[:：]\s*(.+)$/);
    if (!match) continue;
    const character = match[1].trim();
    const dialogue = match[2].trim();
    if (!character || !dialogue) continue;
    if (/^(第.+场|场景|地点|内景|外景|INT|EXT)$/i.test(character)) continue;
    beats.push({
      text: `${character}: ${dialogue}`,
      character,
      dialogue,
      start: line.start,
      end: line.end,
    });
  }

  if (beats.length > 0) return beats;
  return getSentenceSegments(text, absoluteStart).map((segment) => ({ ...segment }));
}

function pickDistributed<T>(items: T[], count: number) {
  if (items.length <= count) return items;
  if (count <= 1) return [items[0]];
  const picked: T[] = [];
  const step = (items.length - 1) / (count - 1);
  for (let index = 0; index < count; index += 1) {
    picked.push(items[Math.round(index * step)]);
  }
  return picked;
}

function buildCamera(role: ShotRole, index: number, characterCount: number): GeneratedShotSpec["camera"] {
  if (role === "establishing") {
    return {
      shot_size: "wide shot",
      angle: "eye-level",
      movement: "static",
      composition: "space-first composition that clearly anchors the scene location",
    };
  }

  if (role === "reaction_detail") {
    return {
      shot_size: index % 2 === 0 ? "close-up" : "detail shot",
      angle: "eye-level",
      movement: "static",
      composition: "single readable reaction or object detail, no new plot information",
    };
  }

  return {
    shot_size: characterCount >= 2 && index % 2 === 0 ? "medium two-shot" : "medium shot",
    angle: "eye-level",
    movement: "static",
    composition: "dialogue/action beat framed around the source-text participant",
  };
}

function buildShotType(role: ShotRole, index: number, characterCount: number) {
  if (role === "establishing") return "establishing";
  if (role === "reaction_detail") return index % 2 === 0 ? "reaction" : "detail";
  return characterCount >= 2 && index % 2 === 0 ? "dialogue_two_shot" : "dialogue_action";
}

function buildDialogueText(beat: DialogueBeat | undefined) {
  if (!beat?.dialogue) return "";
  return beat.character ? `${beat.character}: ${beat.dialogue}` : beat.dialogue;
}

function buildActionFromBeat(beat: DialogueBeat | undefined) {
  if (!beat) return "Continue the source scene beat without adding new plot.";
  if (beat.dialogue) return `Source dialogue beat: ${buildDialogueText(beat)}`;
  return truncateText(beat.text, 180);
}

function buildShotSpecsForScene(params: {
  scene: GeneratedScene;
  sceneText: string;
  globalSequenceStart: number;
}) {
  const { scene, sceneText, globalSequenceStart } = params;
  const beats = parseDialogueBeats(sceneText, scene.source_range.start);
  const actionBeatCount = clamp(beats.length || 2, 2, 5);
  const selectedBeats = pickDistributed(beats.length > 0 ? beats : [{ text: sceneText, start: scene.source_range.start, end: scene.source_range.end }], actionBeatCount);
  const reactionCount = sceneText.length > 900 && selectedBeats.length >= 3 ? 2 : 1;
  const shots: GeneratedShotSpec[] = [];

  const pushShot = (input: Omit<GeneratedShotSpec, "sequence" | "generation_ready" | "single_frame_constraints">) => {
    const sequence = globalSequenceStart + shots.length;
    shots.push({
      ...input,
      sequence,
      generation_ready: true,
      single_frame_constraints: [
        "single storyboard still",
        "one clear visual beat",
        "no temporal montage inside one shot",
        "no extra plot beyond source_text",
      ],
    });
  };

  const establishingSource = selectedBeats[0] ?? { text: sceneText, start: scene.source_range.start, end: scene.source_range.end };
  pushShot({
    id: `${scene.id}_shot_${pad3(1)}`,
    episode_id: scene.episode_id,
    scene_id: scene.id,
    episode_index: scene.episode_index,
    scene_index: scene.scene_index,
    shot_index: 1,
    shot_role: "establishing",
    shot_type: buildShotType("establishing", 1, scene.character_asset_ids.length),
    camera: buildCamera("establishing", 1, scene.character_asset_ids.length),
    action: `Establish location: ${scene.location_name}.`,
    dialogue: "",
    character_asset_ids: scene.character_asset_ids,
    scene_asset_id: scene.scene_asset_id,
    prop_asset_ids: scene.prop_asset_ids,
    duration_seconds: 4,
    source_text: truncateText(establishingSource.text, 220),
    source_range: { start: establishingSource.start, end: establishingSource.end },
  });

  selectedBeats.forEach((beat) => {
    const shotIndex = shots.length + 1;
    pushShot({
      id: `${scene.id}_shot_${pad3(shotIndex)}`,
      episode_id: scene.episode_id,
      scene_id: scene.id,
      episode_index: scene.episode_index,
      scene_index: scene.scene_index,
      shot_index: shotIndex,
      shot_role: "dialogue_action",
      shot_type: buildShotType("dialogue_action", shotIndex, scene.character_asset_ids.length),
      camera: buildCamera("dialogue_action", shotIndex, scene.character_asset_ids.length),
      action: buildActionFromBeat(beat),
      dialogue: buildDialogueText(beat),
      character_asset_ids: scene.character_asset_ids,
      scene_asset_id: scene.scene_asset_id,
      prop_asset_ids: scene.prop_asset_ids,
      duration_seconds: beat.dialogue ? 5 : 4,
      source_text: truncateText(beat.text, 260),
      source_range: { start: beat.start, end: beat.end },
    });
  });

  const reactionBeats = pickDistributed(selectedBeats, reactionCount);
  reactionBeats.forEach((beat) => {
    const shotIndex = shots.length + 1;
    if (shotIndex > MAX_SHOTS_PER_SCENE) return;
    pushShot({
      id: `${scene.id}_shot_${pad3(shotIndex)}`,
      episode_id: scene.episode_id,
      scene_id: scene.id,
      episode_index: scene.episode_index,
      scene_index: scene.scene_index,
      shot_index: shotIndex,
      shot_role: "reaction_detail",
      shot_type: buildShotType("reaction_detail", shotIndex, scene.character_asset_ids.length),
      camera: buildCamera("reaction_detail", shotIndex, scene.character_asset_ids.length),
      action: `Reaction/detail beat anchored to source text: ${truncateText(beat.text, 140)}`,
      dialogue: "",
      character_asset_ids: scene.character_asset_ids,
      scene_asset_id: scene.scene_asset_id,
      prop_asset_ids: scene.prop_asset_ids,
      duration_seconds: 3,
      source_text: truncateText(beat.text, 220),
      source_range: { start: beat.start, end: beat.end },
    });
  });

  return shots;
}

function validateShotGeneratorResult(result: Omit<ShotGeneratorResult, "validation">): ShotGeneratorValidationReport {
  const issues: ShotGeneratorValidationIssue[] = [];

  for (const episode of result.episodes) {
    if (episode.scene_ids.length < MIN_SCENES_PER_EPISODE) {
      issues.push({
        severity: "warning",
        code: "episode_scene_count_below_target",
        message: `Episode ${episode.episode_index} has ${episode.scene_ids.length} scenes; target is 6-10 scenes.`,
        target_id: episode.id,
      });
    }
    if (episode.scene_ids.length > MAX_SCENES_PER_EPISODE) {
      issues.push({
        severity: "error",
        code: "episode_scene_count_above_limit",
        message: `Episode ${episode.episode_index} has ${episode.scene_ids.length} scenes; maximum is 10 scenes.`,
        target_id: episode.id,
      });
    }
  }

  for (const scene of result.scenes) {
    const sceneShots = result.shots.filter((shot) => shot.scene_id === scene.id);
    if (sceneShots.length < MIN_SHOTS_PER_SCENE || sceneShots.length > MAX_SHOTS_PER_SCENE) {
      issues.push({
        severity: "error",
        code: "scene_shot_count_out_of_range",
        message: `Scene ${scene.scene_index} has ${sceneShots.length} shots; required range is 3-8 shots.`,
        target_id: scene.id,
      });
    }
    if (!sceneShots.some((shot) => shot.shot_role === "establishing")) {
      issues.push({
        severity: "error",
        code: "missing_establishing_shot",
        message: `Scene ${scene.scene_index} is missing an establishing shot.`,
        target_id: scene.id,
      });
    }
    if (sceneShots.filter((shot) => shot.shot_role === "dialogue_action").length < 2) {
      issues.push({
        severity: "error",
        code: "missing_dialogue_action_shots",
        message: `Scene ${scene.scene_index} needs at least 2 dialogue/action shots.`,
        target_id: scene.id,
      });
    }
    if (!sceneShots.some((shot) => shot.shot_role === "reaction_detail")) {
      issues.push({
        severity: "error",
        code: "missing_reaction_detail_shot",
        message: `Scene ${scene.scene_index} is missing a reaction/detail shot.`,
        target_id: scene.id,
      });
    }
  }

  for (const shot of result.shots) {
    if (!shot.action.trim()) {
      issues.push({
        severity: "error",
        code: "empty_shot_action",
        message: `Shot ${shot.id} has empty action.`,
        target_id: shot.id,
      });
    }
    if (!shot.generation_ready) {
      issues.push({
        severity: "error",
        code: "shot_not_generation_ready",
        message: `Shot ${shot.id} is not generation-ready.`,
        target_id: shot.id,
      });
    }
  }

  return {
    passed: issues.every((issue) => issue.severity !== "error"),
    issues,
  };
}

export function generateShotSpecsV1(input: ShotGeneratorInput): ShotGeneratorResult {
  const script = cleanScriptText(input.script);
  if (!script) {
    throw new Error("script is required");
  }

  const structured = structureScriptText(script, {
    minSize: 1200,
    maxSize: 2200,
    overlap: 0,
  });

  const episodes: GeneratedEpisode[] = [];
  const scenes: GeneratedScene[] = [];
  const shots: GeneratedShotSpec[] = [];

  for (const episodeDraft of structured.episodes) {
    const episodeId = `episode_${pad3(episodeDraft.episodeIndex)}`;
    const episodeScenes = structured.scenes
      .filter((scene) => scene.episodeIndex === episodeDraft.episodeIndex)
      .map((scene) => ({
        title: scene.title,
        text: scene.text,
        startIndex: scene.startIndex,
        endIndex: scene.endIndex,
      }));
    const sceneSegments = buildSceneSegmentsForEpisode({
      episodeText: episodeDraft.text,
      episodeStart: episodeDraft.startIndex,
      explicitScenes: episodeScenes,
    });

    const episode: GeneratedEpisode = {
      id: episodeId,
      episode_index: episodeDraft.episodeIndex,
      title: episodeDraft.title || `Episode ${episodeDraft.episodeIndex}`,
      source_range: {
        start: episodeDraft.startIndex,
        end: episodeDraft.endIndex,
      },
      scene_ids: [],
    };

    sceneSegments.forEach((segment, localSceneIndex) => {
      const sceneIndex = scenes.length + 1;
      const sceneId = `${episodeId}_scene_${pad3(localSceneIndex + 1)}`;
      const sceneAsset = findSceneAsset(segment.text, input.assets);
      const characterAssetIds = findAssetsInText(segment.text, input.assets, "character").map((asset) => asset.id);
      const propAssetIds = findAssetsInText(segment.text, input.assets, "prop").map((asset) => asset.id);
      const scene: GeneratedScene = {
        id: sceneId,
        episode_id: episodeId,
        episode_index: episodeDraft.episodeIndex,
        scene_index: sceneIndex,
        title: segment.title || `Scene ${localSceneIndex + 1}`,
        location_name: inferLocationName(segment.text, segment.title, input.assets),
        scene_asset_id: sceneAsset?.id ?? null,
        time_of_day: inferTimeOfDay(segment.text),
        source_range: {
          start: segment.start,
          end: segment.end,
        },
        character_asset_ids: characterAssetIds,
        prop_asset_ids: propAssetIds,
        shot_ids: [],
      };

      const sceneShots = buildShotSpecsForScene({
        scene,
        sceneText: segment.text,
        globalSequenceStart: shots.length + 1,
      });

      scene.shot_ids = sceneShots.map((shot) => shot.id);
      scenes.push(scene);
      shots.push(...sceneShots);
      episode.scene_ids.push(scene.id);
    });

    episodes.push(episode);
  }

  const withoutValidation = {
    pipeline: "shot_generator_v1" as const,
    episodes,
    scenes,
    shots,
    shot_spec: shots,
    stats: {
      episode_count: episodes.length,
      scene_count: scenes.length,
      shot_count: shots.length,
      target_scenes_per_episode: "6-10",
      target_shots_per_scene: "3-8",
      llm_used_for_shots: false as const,
    },
  };

  return {
    ...withoutValidation,
    validation: validateShotGeneratorResult(withoutValidation),
  };
}
