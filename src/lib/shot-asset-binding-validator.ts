export type BindingAssetType = "character" | "scene" | "prop";
export type BindingIssueSeverity = "error" | "warning";

export interface BindingAsset {
  id: string;
  name: string;
  aliases?: string[];
  description?: string;
}

export interface FlatBindingAsset extends BindingAsset {
  type: BindingAssetType;
}

export interface AssetBindingSystem {
  characters: BindingAsset[];
  scenes: BindingAsset[];
  props: BindingAsset[];
}

export interface AssetBindingValidationInput {
  shot_spec: unknown[];
  asset_system: AssetBindingSystem;
}

export interface AssetMatchSuggestion {
  asset_type: BindingAssetType;
  asset_id: string;
  asset_name: string;
  confidence: number;
  reason: string;
}

export interface ShotBindingIssue {
  severity: BindingIssueSeverity;
  code: string;
  message: string;
  asset_type?: BindingAssetType;
  asset_id?: string;
}

export interface ShotAssetBindingReport {
  shot_id: string;
  can_render_storyboard: boolean;
  valid_bindings: {
    scene_id: boolean;
    scene_asset_id: boolean;
    characters: boolean;
    props: boolean;
    action: boolean;
    single_frame: boolean;
  };
  bound_assets: {
    characters: Array<{ asset_id: string; name: string }>;
    scene: { asset_id: string; name: string } | null;
    props: Array<{ asset_id: string; name: string }>;
  };
  missing_assets: {
    characters: string[];
    scene: string | null;
    props: string[];
  };
  suggested_asset_matches: AssetMatchSuggestion[];
  issues: ShotBindingIssue[];
}

export interface AssetBindingValidationResult {
  validation_type: "asset_binding_validation_v1";
  passed: boolean;
  shots: ShotAssetBindingReport[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    warnings: number;
    missing_scene_assets: number;
    missing_character_assets: number;
    unresolved_props: number;
  };
}

interface NormalizedShotSpec {
  id: string;
  sceneId: string;
  sceneAssetId: string | null;
  characterAssetIds: string[];
  propAssetIds: string[];
  action: string;
  dialogue: string;
  sourceText: string;
  shotRole: string;
}

interface AssetIndex {
  characters: Map<string, BindingAsset>;
  scenes: Map<string, BindingAsset>;
  props: Map<string, BindingAsset>;
}

const ABSTRACT_ACTION_PATTERNS = [
  /^continue\b/i,
  /continue the source scene beat/i,
  /scene continues/i,
  /unspecified/i,
  /unknown/i,
  /TBD/i,
  /待定/,
  /无明确动作/,
];

const TEMPORAL_MARKERS = [
  "然后",
  "随后",
  "接着",
  "之后",
  "最终",
  "最后",
  "同时",
  "转而",
  "meanwhile",
  "then",
  "next",
  "afterward",
  "finally",
];

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

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

  return trimmed
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readStringArray(record: Record<string, unknown>, keys: string[]) {
  return unique(keys.flatMap((key) => parseStringArray(record[key])));
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function getAssetTerms(asset: BindingAsset) {
  return unique([asset.name, ...(asset.aliases ?? [])]);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function textMentionsTerm(text: string, term: string) {
  if (!term) return false;
  return text.toLowerCase().includes(term.toLowerCase());
}

function buildAssetIndex(system: AssetBindingSystem): AssetIndex {
  return {
    characters: new Map(system.characters.map((asset) => [asset.id, asset])),
    scenes: new Map(system.scenes.map((asset) => [asset.id, asset])),
    props: new Map(system.props.map((asset) => [asset.id, asset])),
  };
}

function normalizeShotSpec(value: unknown, index: number): NormalizedShotSpec {
  const record = toRecord(value);
  return {
    id: readString(record, ["id", "shot_id", "shotId"]) || `shot_${String(index + 1).padStart(3, "0")}`,
    sceneId: readString(record, ["scene_id", "sceneId"]),
    sceneAssetId: readString(record, ["scene_asset_id", "sceneAssetId"]) || null,
    characterAssetIds: readStringArray(record, ["character_asset_ids", "characterAssetIds", "character_ids", "characterIds"]),
    propAssetIds: readStringArray(record, ["prop_asset_ids", "propAssetIds", "prop_ids", "propIds"]),
    action: readString(record, ["action", "motion_script", "motionScript"]),
    dialogue: readString(record, ["dialogue", "dialogues"]),
    sourceText: readString(record, ["source_text", "sourceText", "prompt", "videoScript"]),
    shotRole: readString(record, ["shot_role", "shotRole", "shot_type", "shotType"]),
  };
}

function findMentionedAssets(
  text: string,
  assets: BindingAsset[],
  assetType: BindingAssetType,
  boundIds: string[],
): AssetMatchSuggestion[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const suggestions: AssetMatchSuggestion[] = [];
  for (const asset of assets) {
    if (boundIds.includes(asset.id)) continue;

    for (const term of getAssetTerms(asset)) {
      if (!textMentionsTerm(normalized, term)) continue;
      suggestions.push({
        asset_type: assetType,
        asset_id: asset.id,
        asset_name: asset.name,
        confidence: term === asset.name ? 90 : 75,
        reason: `source text mentions "${term}"`,
      });
      break;
    }
  }

  return suggestions;
}

function parseDialogueSpeakers(dialogue: string) {
  const speakers: string[] = [];
  const lines = dialogue.split(/\n+/);
  for (const line of lines) {
    const match = line.trim().match(/^([^:：\s]{1,24})\s*[:：]/);
    if (match?.[1]) speakers.push(match[1].trim());
  }
  return unique(speakers);
}

function isActionVisualizable(shot: NormalizedShotSpec) {
  const action = normalizeText(shot.action);
  if (!action) return false;
  if (shot.shotRole === "establishing" && /^establish location/i.test(action)) return true;
  if (shot.dialogue && /^source dialogue beat/i.test(action)) return true;
  if (action.length < 4) return false;
  return !ABSTRACT_ACTION_PATTERNS.some((pattern) => pattern.test(action));
}

function isSingleFrameRenderable(shot: NormalizedShotSpec) {
  const text = normalizeText(`${shot.action} ${shot.sourceText}`);
  if (!text) return false;
  if (/先.+再|从.+到|begins?.+then|turns?.+and then/i.test(text)) return false;

  const markerCount = TEMPORAL_MARKERS.reduce((count, marker) => {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return count + (text.match(new RegExp(escaped, "gi"))?.length ?? 0);
  }, 0);

  return markerCount < 2;
}

function assetLabel(asset: BindingAsset) {
  return {
    asset_id: asset.id,
    name: asset.name,
  };
}

function pushIssue(issues: ShotBindingIssue[], issue: ShotBindingIssue) {
  issues.push(issue);
}

function validateShot(
  rawShot: unknown,
  index: number,
  system: AssetBindingSystem,
  assetIndex: AssetIndex,
): ShotAssetBindingReport {
  const shot = normalizeShotSpec(rawShot, index);
  const issues: ShotBindingIssue[] = [];
  const evidenceText = normalizeText([shot.action, shot.dialogue, shot.sourceText].filter(Boolean).join("\n"));

  if (!shot.sceneId) {
    pushIssue(issues, {
      severity: "error",
      code: "missing_scene_id",
      message: "Shot is missing structural scene_id.",
    });
  }

  let sceneAsset: BindingAsset | null = null;
  if (!shot.sceneAssetId) {
    pushIssue(issues, {
      severity: "error",
      code: "missing_scene_asset",
      message: "Shot is missing scene_asset_id.",
      asset_type: "scene",
    });
  } else {
    sceneAsset = assetIndex.scenes.get(shot.sceneAssetId) ?? null;
    if (!sceneAsset) {
      pushIssue(issues, {
        severity: "error",
        code: "invalid_scene_asset_id",
        message: `scene_asset_id "${shot.sceneAssetId}" does not exist in asset_system.scenes.`,
        asset_type: "scene",
        asset_id: shot.sceneAssetId,
      });
    }
  }

  const boundCharacters: BindingAsset[] = [];
  for (const assetId of shot.characterAssetIds) {
    const asset = assetIndex.characters.get(assetId);
    if (asset) {
      boundCharacters.push(asset);
      continue;
    }
    pushIssue(issues, {
      severity: "error",
      code: "invalid_character_asset_id",
      message: `character asset_id "${assetId}" does not exist in asset_system.characters.`,
      asset_type: "character",
      asset_id: assetId,
    });
  }

  const boundProps: BindingAsset[] = [];
  for (const assetId of shot.propAssetIds) {
    const asset = assetIndex.props.get(assetId);
    if (asset) {
      boundProps.push(asset);
      continue;
    }
    pushIssue(issues, {
      severity: "error",
      code: "invalid_prop_asset_id",
      message: `prop asset_id "${assetId}" does not exist in asset_system.props.`,
      asset_type: "prop",
      asset_id: assetId,
    });
  }

  const mentionedCharacters = findMentionedAssets(evidenceText, system.characters, "character", boundCharacters.map((asset) => asset.id));
  const mentionedScenes = findMentionedAssets(evidenceText, system.scenes, "scene", sceneAsset ? [sceneAsset.id] : []);
  const mentionedProps = findMentionedAssets(evidenceText, system.props, "prop", boundProps.map((asset) => asset.id));
  const dialogueSpeakers = parseDialogueSpeakers(shot.dialogue);
  const missingDialogueSpeakers = dialogueSpeakers.filter((speaker) => {
    return !boundCharacters.some((asset) => getAssetTerms(asset).some((term) => term === speaker));
  });

  if (mentionedCharacters.length > 0) {
    pushIssue(issues, {
      severity: "error",
      code: "missing_required_character",
      message: "Shot text mentions character assets that are not bound to character_asset_ids.",
      asset_type: "character",
    });
  }

  if (missingDialogueSpeakers.length > 0) {
    pushIssue(issues, {
      severity: "error",
      code: "dialogue_speaker_not_bound",
      message: `Dialogue speaker(s) not bound to character assets: ${missingDialogueSpeakers.join(", ")}.`,
      asset_type: "character",
    });
  }

  if (mentionedProps.length > 0) {
    pushIssue(issues, {
      severity: "error",
      code: "unresolved_prop",
      message: "Shot text mentions prop assets that are not bound to prop_asset_ids.",
      asset_type: "prop",
    });
  }

  const actionVisualizable = isActionVisualizable(shot);
  if (!actionVisualizable) {
    pushIssue(issues, {
      severity: "error",
      code: "missing_action",
      message: "Shot action is empty or too abstract to visualize.",
    });
  }

  const singleFrame = isSingleFrameRenderable(shot);
  if (!singleFrame) {
    pushIssue(issues, {
      severity: "error",
      code: "not_single_frame_renderable",
      message: "Shot action/source text appears to contain multiple temporal stages.",
    });
  }

  const suggestedMatches = [
    ...(!sceneAsset ? mentionedScenes : []),
    ...mentionedCharacters,
    ...mentionedProps,
  ];
  const hasErrors = issues.some((issue) => issue.severity === "error");

  return {
    shot_id: shot.id,
    can_render_storyboard: !hasErrors,
    valid_bindings: {
      scene_id: Boolean(shot.sceneId),
      scene_asset_id: Boolean(sceneAsset),
      characters: shot.characterAssetIds.length === boundCharacters.length && mentionedCharacters.length === 0 && missingDialogueSpeakers.length === 0,
      props: shot.propAssetIds.length === boundProps.length && mentionedProps.length === 0,
      action: actionVisualizable,
      single_frame: singleFrame,
    },
    bound_assets: {
      characters: boundCharacters.map(assetLabel),
      scene: sceneAsset ? assetLabel(sceneAsset) : null,
      props: boundProps.map(assetLabel),
    },
    missing_assets: {
      characters: unique([
        ...mentionedCharacters.map((match) => match.asset_name),
        ...missingDialogueSpeakers,
      ]),
      scene: sceneAsset ? null : mentionedScenes[0]?.asset_name ?? null,
      props: unique(mentionedProps.map((match) => match.asset_name)),
    },
    suggested_asset_matches: suggestedMatches,
    issues,
  };
}

export function groupFlatAssets(assets: FlatBindingAsset[]): AssetBindingSystem {
  return {
    characters: assets.filter((asset) => asset.type === "character"),
    scenes: assets.filter((asset) => asset.type === "scene"),
    props: assets.filter((asset) => asset.type === "prop"),
  };
}

export function validateShotAssetBindings(input: AssetBindingValidationInput): AssetBindingValidationResult {
  const assetIndex = buildAssetIndex(input.asset_system);
  const shots = input.shot_spec.map((shot, index) => validateShot(shot, index, input.asset_system, assetIndex));
  const errors = shots.reduce((sum, shot) => sum + shot.issues.filter((issue) => issue.severity === "error").length, 0);
  const warnings = shots.reduce((sum, shot) => sum + shot.issues.filter((issue) => issue.severity === "warning").length, 0);
  const passedShots = shots.filter((shot) => shot.can_render_storyboard).length;

  return {
    validation_type: "asset_binding_validation_v1",
    passed: errors === 0,
    shots,
    summary: {
      total: shots.length,
      passed: passedShots,
      failed: shots.length - passedShots,
      errors,
      warnings,
      missing_scene_assets: shots.filter((shot) => !shot.valid_bindings.scene_asset_id).length,
      missing_character_assets: shots.filter((shot) => !shot.valid_bindings.characters).length,
      unresolved_props: shots.filter((shot) => !shot.valid_bindings.props).length,
    },
  };
}
