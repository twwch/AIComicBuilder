export type ShotValidationStatus = "valid" | "needs_review" | "invalid";
export type ShotReviewStatus = "pending" | "approved" | "rejected";
export type ShotLockStatus = "unlocked" | "locked";
export type ShotReviewSeverity = "error" | "warning";
export type ReviewAssetType = "character" | "scene" | "prop";

export interface ReviewAsset {
  id: string;
  type: ReviewAssetType;
  name: string;
  aliases?: string[];
}

export interface ReviewAssetVariant {
  id: string;
  assetId: string;
  name: string;
  variantType?: string;
  status?: string;
}

export interface ReviewAssetSystem {
  assets: ReviewAsset[];
  variants: ReviewAssetVariant[];
}

export interface ShotAssetRef {
  asset_id: string;
  variant_id: string;
  name?: string;
  variant_name?: string;
}

export interface StandardizedShotReview {
  shot_id: string;
  episode_id: string;
  scene_id: string;
  shot_type: string;
  camera: {
    shot_size: string;
    angle: string;
    movement: string;
    composition: string;
  };
  frame_description: string;
  action: string;
  emotion: string;
  characters: ShotAssetRef[];
  scene_asset: ShotAssetRef | null;
  props: ShotAssetRef[];
  dialogue: string;
  voiceover: string;
  validation_status: ShotValidationStatus;
  review_status: ShotReviewStatus;
  lock_status: ShotLockStatus;
}

export interface ShotReviewIssue {
  severity: ShotReviewSeverity;
  code: string;
  message: string;
  field?: string;
  suggestion?: string;
}

export interface ShotReviewItem {
  shot: StandardizedShotReview;
  errors: ShotReviewIssue[];
  warnings: ShotReviewIssue[];
  repair_suggestions: string[];
}

export interface ShotReviewScene {
  scene_id: string;
  shots: ShotReviewItem[];
}

export interface ShotReviewEpisode {
  episode_id: string;
  scenes: ShotReviewScene[];
}

export interface ShotReviewResult {
  review_type: "shot_review_validation_v1";
  valid: boolean;
  summary: {
    total: number;
    valid: number;
    needs_review: number;
    invalid: number;
    locked: number;
    errors: number;
    warnings: number;
  };
  episodes: ShotReviewEpisode[];
  shots: ShotReviewItem[];
}

export interface ShotReviewLockResult {
  review_type: "shot_review_lock_v1";
  locked: boolean;
  locked_shot_ids: string[];
  rejected_shot_ids: string[];
  shot_review: {
    version: 1;
    lockedAt: string;
    lockedShotIds: string[];
    shots: StandardizedShotReview[];
    validationSummary: ShotReviewResult["summary"];
  };
  validation: ShotReviewResult;
}

interface AssetLookup {
  assetsById: Map<string, ReviewAsset>;
  variantsById: Map<string, ReviewAssetVariant>;
  variantsByAssetId: Map<string, ReviewAssetVariant[]>;
}

const ABSTRACT_FRAME_PATTERNS = [
  /剧情/,
  /关系/,
  /身份/,
  /命运/,
  /内心/,
  /意识到/,
  /感受到/,
  /明白/,
  /回忆/,
  /伏笔/,
  /story/i,
  /plot/i,
  /relationship/i,
  /realizes?/i,
  /understands?/i,
];

const ABSTRACT_ACTION_PATTERNS = [
  /^continue\b/i,
  /continue the source scene beat/i,
  /scene continues/i,
  /无明确动作/,
  /待定/,
  /unknown/i,
  /unspecified/i,
  /tbd/i,
];

const MULTI_EVENT_PATTERNS = [
  /先.+再/,
  /从.+到/,
  /然后/,
  /随后/,
  /接着/,
  /之后/,
  /最终/,
  /最后/,
  /同时/,
  /转而/,
  /meanwhile/i,
  /\bthen\b/i,
  /\bnext\b/i,
  /afterward/i,
  /finally/i,
  /begins?.+then/i,
  /turns?.+and then/i,
];

const GENERIC_PROP_TERMS = [
  "杯",
  "水杯",
  "刀",
  "枪",
  "手机",
  "信",
  "照片",
  "病历",
  "药",
  "钥匙",
  "合同",
  "文件",
  "轮椅",
  "桌",
  "椅",
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

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function readStringArray(record: Record<string, unknown>, keys: string[]) {
  return unique(keys.flatMap((key) => parseStringArray(record[key])));
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildLookup(assetSystem: ReviewAssetSystem): AssetLookup {
  const variantsByAssetId = new Map<string, ReviewAssetVariant[]>();
  for (const variant of assetSystem.variants) {
    const list = variantsByAssetId.get(variant.assetId) ?? [];
    list.push(variant);
    variantsByAssetId.set(variant.assetId, list);
  }

  return {
    assetsById: new Map(assetSystem.assets.map((asset) => [asset.id, asset])),
    variantsById: new Map(assetSystem.variants.map((variant) => [variant.id, variant])),
    variantsByAssetId,
  };
}

function chooseBaseVariant(assetId: string, lookup: AssetLookup) {
  const variants = lookup.variantsByAssetId.get(assetId) ?? [];
  return variants.find((variant) => variant.variantType === "default")
    ?? variants.find((variant) => /default|base|基础/i.test(`${variant.name} ${variant.variantType ?? ""}`))
    ?? variants[0]
    ?? null;
}

function normalizeCamera(value: unknown) {
  const record = toRecord(value);
  return {
    shot_size: readString(record, ["shot_size", "shotSize", "size"]) || "",
    angle: readString(record, ["angle", "cameraAngle"]) || "",
    movement: readString(record, ["movement", "cameraMovement"]) || "",
    composition: readString(record, ["composition", "compositionGuide"]) || "",
  };
}

function normalizeAssetRef(value: unknown, fallbackType: ReviewAssetType, lookup: AssetLookup): ShotAssetRef | null {
  if (typeof value === "string") {
    const asset = lookup.assetsById.get(value);
    const variant = asset ? chooseBaseVariant(asset.id, lookup) : null;
    return {
      asset_id: value,
      variant_id: variant?.id ?? "",
      name: asset?.name,
      variant_name: variant?.name,
    };
  }

  const record = toRecord(value);
  const assetId = readString(record, ["asset_id", "assetId", "id"]);
  if (!assetId) return null;

  const asset = lookup.assetsById.get(assetId);
  const variantId = readString(record, ["variant_id", "variantId"]);
  const variant = variantId ? lookup.variantsById.get(variantId) ?? null : chooseBaseVariant(assetId, lookup);
  return {
    asset_id: assetId,
    variant_id: variant?.id ?? variantId,
    name: readString(record, ["name", "asset_name", "assetName"]) || asset?.name || fallbackType,
    variant_name: readString(record, ["variant_name", "variantName"]) || variant?.name || "",
  };
}

function normalizeAssetRefArray(
  rawArray: unknown,
  legacyIds: string[],
  type: ReviewAssetType,
  lookup: AssetLookup,
) {
  const values = Array.isArray(rawArray) ? rawArray : legacyIds;
  return values
    .map((value) => normalizeAssetRef(value, type, lookup))
    .filter((value): value is ShotAssetRef => Boolean(value));
}

function normalizeSceneAsset(rawShot: Record<string, unknown>, lookup: AssetLookup) {
  const direct = normalizeAssetRef(rawShot.scene_asset, "scene", lookup)
    ?? normalizeAssetRef(rawShot.sceneAsset, "scene", lookup);
  if (direct) return direct;
  const sceneAssetId = readString(rawShot, ["scene_asset_id", "sceneAssetId"]);
  return sceneAssetId ? normalizeAssetRef(sceneAssetId, "scene", lookup) : null;
}

function deriveFrameDescription(rawShot: Record<string, unknown>, action: string) {
  return readString(rawShot, ["frame_description", "frameDescription", "source_text", "sourceText", "startFrame", "prompt"])
    || action;
}

export function standardizeShotForReview(
  rawShot: unknown,
  index: number,
  assetSystem: ReviewAssetSystem,
): StandardizedShotReview {
  const lookup = buildLookup(assetSystem);
  const record = toRecord(rawShot);
  const camera = normalizeCamera(record.camera);
  if (!camera.shot_size) camera.shot_size = readString(record, ["shot_size", "shotSize", "shotType"]);
  if (!camera.angle) camera.angle = readString(record, ["camera_angle", "cameraAngle"]);
  if (!camera.movement) camera.movement = readString(record, ["camera_movement", "cameraMovement", "cameraDirection"]);
  if (!camera.composition) camera.composition = readString(record, ["composition", "compositionGuide"]);

  const action = readString(record, ["action", "motionScript", "motion_script"]);
  const characters = normalizeAssetRefArray(
    record.characters,
    readStringArray(record, ["character_asset_ids", "characterAssetIds", "character_ids", "characterIds"]),
    "character",
    lookup,
  );
  const props = normalizeAssetRefArray(
    record.props,
    readStringArray(record, ["prop_asset_ids", "propAssetIds", "prop_ids", "propIds"]),
    "prop",
    lookup,
  );

  return {
    shot_id: readString(record, ["shot_id", "shotId", "id"]) || `shot_${String(index + 1).padStart(3, "0")}`,
    episode_id: readString(record, ["episode_id", "episodeId"]),
    scene_id: readString(record, ["scene_id", "sceneId"]),
    shot_type: readString(record, ["shot_type", "shotType", "shot_role", "shotRole"]),
    camera,
    frame_description: deriveFrameDescription(record, action),
    action,
    emotion: readString(record, ["emotion", "focalPoint"]),
    characters,
    scene_asset: normalizeSceneAsset(record, lookup),
    props,
    dialogue: readString(record, ["dialogue", "dialogues"]),
    voiceover: readString(record, ["voiceover", "voiceOver"]),
    validation_status: readString(record, ["validation_status", "validationStatus"]) as ShotValidationStatus || "needs_review",
    review_status: readString(record, ["review_status", "reviewStatus"]) as ShotReviewStatus || "pending",
    lock_status: readString(record, ["lock_status", "lockStatus"]) as ShotLockStatus || "unlocked",
  };
}

function isNaturalLanguagePlaceholder(value: string) {
  return /^(女主|男主|主角|配角|反派|客厅|卧室|医院|场景|道具|人物|character|scene|prop)$/i.test(value.trim());
}

function assetTerms(asset: ReviewAsset) {
  return unique([asset.name, ...(asset.aliases ?? [])]);
}

function textMentionsAsset(text: string, asset: ReviewAsset) {
  const lower = text.toLowerCase();
  return assetTerms(asset).some((term) => term && lower.includes(term.toLowerCase()));
}

function isFrameVisualizable(text: string) {
  const value = compactText(text);
  if (!value || value.length < 4) return false;
  return !ABSTRACT_FRAME_PATTERNS.some((pattern) => pattern.test(value));
}

function hasMultipleEvents(text: string) {
  const value = compactText(text);
  const markerCount = MULTI_EVENT_PATTERNS.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
  const sentenceCount = value.split(/[。！？!?；;]/).map((item) => item.trim()).filter(Boolean).length;
  return markerCount >= 2 || sentenceCount > 2;
}

function isActionValid(text: string) {
  const value = compactText(text);
  if (!value || value.length < 3) return false;
  return !ABSTRACT_ACTION_PATTERNS.some((pattern) => pattern.test(value)) && !hasMultipleEvents(value);
}

function issue(severity: ShotReviewSeverity, code: string, message: string, field?: string, suggestion?: string): ShotReviewIssue {
  return { severity, code, message, field, suggestion };
}

function validateAssetRef(ref: ShotAssetRef, expectedType: ReviewAssetType, lookup: AssetLookup) {
  const issues: ShotReviewIssue[] = [];
  const asset = lookup.assetsById.get(ref.asset_id);
  if (!ref.asset_id || isNaturalLanguagePlaceholder(ref.asset_id)) {
    issues.push(issue("error", "natural_language_asset_binding", `${expectedType} binding must use asset_id, not natural language.`, `${expectedType}.asset_id`, "Select an asset from the asset library and use its asset_id."));
    return issues;
  }
  if (!asset) {
    issues.push(issue("error", "invalid_asset_id", `${expectedType} asset_id does not exist: ${ref.asset_id}`, `${expectedType}.asset_id`, "Bind this shot to an existing asset_id."));
    return issues;
  }
  if (asset.type !== expectedType) {
    issues.push(issue("error", "asset_type_mismatch", `${ref.asset_id} is ${asset.type}, expected ${expectedType}.`, `${expectedType}.asset_id`, "Choose an asset with the correct type."));
  }
  if (!ref.variant_id) {
    issues.push(issue("error", "missing_variant_id", `${expectedType} variant_id is missing and no base variant exists.`, `${expectedType}.variant_id`, "Create or select a base/default variant for this asset."));
  } else {
    const variant = lookup.variantsById.get(ref.variant_id);
    if (!variant) {
      issues.push(issue("error", "invalid_variant_id", `${expectedType} variant_id does not exist: ${ref.variant_id}`, `${expectedType}.variant_id`, "Select an existing variant_id."));
    } else if (variant.assetId !== ref.asset_id) {
      issues.push(issue("error", "variant_asset_mismatch", `variant_id ${ref.variant_id} does not belong to asset_id ${ref.asset_id}.`, `${expectedType}.variant_id`, "Use a variant that belongs to the selected asset."));
    }
  }
  return issues;
}

function validateShot(
  shot: StandardizedShotReview,
  assetSystem: ReviewAssetSystem,
  shotTypeCounts: Map<string, number>,
  totalShots: number,
) {
  const lookup = buildLookup(assetSystem);
  const errors: ShotReviewIssue[] = [];
  const warnings: ShotReviewIssue[] = [];
  const evidenceText = compactText(`${shot.frame_description} ${shot.action} ${shot.dialogue} ${shot.voiceover}`);

  if (!shot.shot_id) errors.push(issue("error", "missing_shot_id", "Shot is missing shot_id.", "shot_id"));
  if (!shot.scene_id) errors.push(issue("error", "missing_scene_id", "Shot is missing scene_id.", "scene_id"));
  if (!shot.frame_description) errors.push(issue("error", "missing_frame_description", "Shot is missing frame_description.", "frame_description"));
  if (!shot.action) errors.push(issue("error", "missing_action", "Shot is missing action.", "action"));
  if (shot.characters.length === 0) errors.push(issue("error", "missing_character_asset_binding", "Shot must bind at least one character asset.", "characters", "Bind character asset_id and variant_id before storyboard generation."));
  if (!shot.scene_asset) errors.push(issue("error", "missing_scene_asset_binding", "Shot must bind a scene asset.", "scene_asset", "Bind scene asset_id and variant_id before storyboard generation."));

  if (shot.frame_description && !isFrameVisualizable(shot.frame_description)) {
    errors.push(issue("error", "frame_description_not_visualizable", "frame_description is abstract and cannot be drawn as one image.", "frame_description", "Rewrite as a concrete static first-frame description."));
  }
  if (shot.action && !isActionValid(shot.action)) {
    errors.push(issue("error", "action_has_multiple_events", "action is empty, abstract, or contains multiple continuous plot events.", "action", "Keep exactly one visible action node in this shot."));
  }

  for (const ref of shot.characters) errors.push(...validateAssetRef(ref, "character", lookup));
  if (shot.scene_asset) errors.push(...validateAssetRef(shot.scene_asset, "scene", lookup));
  for (const ref of shot.props) errors.push(...validateAssetRef(ref, "prop", lookup));

  const mentionedProps = assetSystem.assets.filter((asset) => asset.type === "prop" && textMentionsAsset(evidenceText, asset));
  const genericPropMentioned = GENERIC_PROP_TERMS.some((term) => evidenceText.includes(term));
  if (shot.props.length === 0 && (mentionedProps.length > 0 || genericPropMentioned)) {
    warnings.push(issue("warning", "suspected_missing_prop", "Shot text may mention a prop, but no prop asset is bound.", "props", "Bind the prop asset if it should be visible in the storyboard frame."));
  }
  if (!shot.camera.shot_size && !shot.camera.angle && !shot.camera.movement && !shot.camera.composition) {
    warnings.push(issue("warning", "missing_camera", "Shot camera is missing.", "camera", "Add shot size, angle, movement, or composition."));
  }
  if (shot.frame_description.length > 260) {
    warnings.push(issue("warning", "frame_description_too_long", "frame_description is long for a single static storyboard frame.", "frame_description", "Shorten it to one concrete visual sentence."));
  }
  if (shot.dialogue.length > 160) {
    warnings.push(issue("warning", "dialogue_too_long", "Dialogue is long and may need another shot split.", "dialogue", "Split the dialogue into multiple shot beats if needed."));
  }
  const shotTypeCount = shotTypeCounts.get(shot.shot_type) ?? 0;
  if (shot.shot_type && totalShots >= 6 && shotTypeCount > Math.max(4, totalShots * 0.55)) {
    warnings.push(issue("warning", "shot_type_repeated_too_often", `shot_type "${shot.shot_type}" is repeated across many shots.`, "shot_type", "Review shot variety before storyboard generation."));
  }

  const validationStatus: ShotValidationStatus = errors.length > 0 ? "invalid" : warnings.length > 0 ? "needs_review" : "valid";
  shot.validation_status = validationStatus;
  const repairSuggestions = unique([...errors, ...warnings].map((item) => item.suggestion || "").filter(Boolean));
  return { shot, errors, warnings, repair_suggestions: repairSuggestions };
}

function groupReviewItems(items: ShotReviewItem[]) {
  const episodeMap = new Map<string, Map<string, ShotReviewItem[]>>();
  for (const item of items) {
    const episodeId = item.shot.episode_id || "episode_unassigned";
    const sceneId = item.shot.scene_id || "scene_unassigned";
    const sceneMap = episodeMap.get(episodeId) ?? new Map<string, ShotReviewItem[]>();
    const shots = sceneMap.get(sceneId) ?? [];
    shots.push(item);
    sceneMap.set(sceneId, shots);
    episodeMap.set(episodeId, sceneMap);
  }

  return Array.from(episodeMap.entries()).map(([episode_id, scenes]) => ({
    episode_id,
    scenes: Array.from(scenes.entries()).map(([scene_id, shots]) => ({ scene_id, shots })),
  }));
}

export function validateShotReview(input: {
  shot_spec: unknown[];
  asset_system: ReviewAssetSystem;
}): ShotReviewResult {
  const lookup = buildLookup(input.asset_system);
  const standardized = input.shot_spec.map((shot, index) => standardizeShotForReview(shot, index, input.asset_system));
  const shotTypeCounts = standardized.reduce((map, shot) => {
    if (!shot.shot_type) return map;
    map.set(shot.shot_type, (map.get(shot.shot_type) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

  // Touch lookup here so missing asset systems fail early in a predictable shape.
  void lookup.assetsById.size;

  const shots = standardized.map((shot) => validateShot(shot, input.asset_system, shotTypeCounts, standardized.length));
  const summary = {
    total: shots.length,
    valid: shots.filter((item) => item.shot.validation_status === "valid").length,
    needs_review: shots.filter((item) => item.shot.validation_status === "needs_review").length,
    invalid: shots.filter((item) => item.shot.validation_status === "invalid").length,
    locked: shots.filter((item) => item.shot.lock_status === "locked").length,
    errors: shots.reduce((sum, item) => sum + item.errors.length, 0),
    warnings: shots.reduce((sum, item) => sum + item.warnings.length, 0),
  };

  return {
    review_type: "shot_review_validation_v1",
    valid: summary.invalid === 0,
    summary,
    episodes: groupReviewItems(shots),
    shots,
  };
}

export function lockReviewedShots(input: {
  shot_ids: string[];
  updated_shots: unknown[];
  asset_system: ReviewAssetSystem;
  lockedAt?: string;
}): ShotReviewLockResult {
  const selected = new Set(input.shot_ids);
  const validation = validateShotReview({
    shot_spec: input.updated_shots,
    asset_system: input.asset_system,
  });
  const selectedItems = validation.shots.filter((item) => selected.has(item.shot.shot_id));
  const lockable = selectedItems.filter((item) => item.shot.validation_status !== "invalid");
  const rejected = selectedItems.filter((item) => item.shot.validation_status === "invalid");
  const lockedAt = input.lockedAt ?? new Date().toISOString();
  const lockedShots = lockable.map((item) => ({
    ...item.shot,
    review_status: "approved" as const,
    lock_status: "locked" as const,
  }));

  return {
    review_type: "shot_review_lock_v1",
    locked: rejected.length === 0 && lockedShots.length === selected.size,
    locked_shot_ids: lockedShots.map((shot) => shot.shot_id),
    rejected_shot_ids: rejected.map((item) => item.shot.shot_id),
    shot_review: {
      version: 1,
      lockedAt,
      lockedShotIds: lockedShots.map((shot) => shot.shot_id),
      shots: lockedShots,
      validationSummary: validation.summary,
    },
    validation,
  };
}
