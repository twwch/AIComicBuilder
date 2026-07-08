export type StoryboardAssetType = "character" | "scene" | "prop";
export type StoryboardSubjectType = "character" | "prop" | "environment" | "vehicle" | "detail" | "reaction";
export type StoryboardAssetRole = "subject" | "background" | "reaction" | "supporting";
export type StoryboardFrameStatus = "valid" | "needs_review" | "invalid";
export type StoryboardFrameLifecycleStatus = "draft" | "locked";
export type StoryboardValidationSeverity = "error" | "warning";

export interface StoryboardAssetInput {
  id: string;
  type: StoryboardAssetType;
  name: string;
  aliases?: string[] | null;
  description?: string | null;
  visualConstraints?: string | null;
  negativeConstraints?: string | null;
  referenceImage?: string | null;
  metadata?: unknown;
}

export interface StoryboardAssetVariantInput {
  id: string;
  assetId: string;
  name?: string | null;
  variantType?: string | null;
  state?: string | null;
  lockedTraits?: unknown;
  changedTraits?: unknown;
  visualConstraints?: string | null;
  negativeConstraints?: string | null;
  referenceImage?: string | null;
  status?: string | null;
}

export interface StoryboardVisualAssetInput {
  asset_id?: string | null;
  assetId?: string | null;
  variant_id?: string | null;
  variantId?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  fileUrl?: string | null;
  referenceImage?: string | null;
  role?: string | null;
  status?: string | null;
}

export interface StoryboardProductionBibleInput {
  title?: string | null;
  worldSetting?: string | null;
  visualStyle?: string | null;
  eraConstraints?: string | null;
  locationRules?: string | null;
  characterRules?: string | null;
  sceneRules?: string | null;
  propRules?: string | null;
  positivePromptTemplate?: string | null;
  negativePromptTemplate?: string | null;
  complianceRules?: string | null;
  metadata?: unknown;
}

export interface StoryboardAssetRef {
  asset_id: string;
  variant_id: string;
  name?: string;
}

export interface NormalizedStoryboardShot {
  shot_id: string;
  episode_id: string;
  scene_id: string;
  shot_type: string;
  frame_description: string;
  action: string;
  emotion: string;
  composition: string;
  camera: {
    shot_type: string;
    angle: string;
    framing: string;
    movement: string;
  };
  characters: StoryboardAssetRef[];
  scene_asset: StoryboardAssetRef | null;
  props: StoryboardAssetRef[];
  dialogue_text: string;
  voiceover: string;
  sound_effect: string;
  duration: string;
  lock_status: string;
  source_text: string;
  planned_frame_id?: string;
  preplanned_frame?: boolean;
  planner_visible_asset_ids?: string[];
}

export interface StoryboardBoundAsset {
  asset_id: string;
  variant_id: string;
  reference_image_url: string;
  name: string;
  asset_type: StoryboardAssetType;
  role_in_frame: StoryboardAssetRole;
  description: string;
}

export interface StoryboardSubject {
  type: StoryboardSubjectType;
  asset_id: string;
  description: string;
}

export interface StoryboardActiveAssets {
  characters: Array<{
    asset_id: string;
    variant_id: string;
    reference_image_url: string;
    role_in_frame: "subject" | "background" | "reaction";
  }>;
  scene: {
    asset_id: string;
    variant_id: string;
    reference_image_url: string;
  } | null;
  props: Array<{
    asset_id: string;
    variant_id: string;
    reference_image_url: string;
    role_in_frame: "subject" | "supporting" | "background";
  }>;
}

export interface StoryboardStyle {
  visual_style: string;
  lighting: string;
  atmosphere: string;
  era: string;
}

export interface StoryboardValidationIssue {
  severity: StoryboardValidationSeverity;
  code: string;
  message: string;
  field?: string;
  suggestion?: string;
}

export interface StoryboardValidationReport {
  status: StoryboardFrameStatus;
  errors: StoryboardValidationIssue[];
  warnings: StoryboardValidationIssue[];
  split_suggestions?: string[];
}

export interface StoryboardFrameSpec {
  frame_id: string;
  shot_id: string;
  episode_id: string;
  scene_id: string;
  subject: StoryboardSubject;
  active_assets: StoryboardActiveAssets;
  static_frame_description: string;
  frame_description: string;
  composition: string;
  camera: {
    shot_type: string;
    angle: string;
    framing: string;
    movement_removed: true;
  };
  style: StoryboardStyle;
  metadata: {
    dialogue_text: string;
    sound_effect: string;
    duration: string;
    voiceover: string;
    source_text?: string;
    split_from_shot?: boolean;
    frame_index?: number;
    frame_count?: number;
    safety_rewrites?: string[];
  };
  positive_prompt: string;
  negative_prompt: string;
  validation: StoryboardValidationReport;
  status: StoryboardFrameLifecycleStatus;
}

export interface StoryboardCompilerInput {
  locked_shots: unknown[];
  assets?: unknown[];
  assetVariants?: unknown[];
  visualAssets?: unknown[];
  productionBible?: StoryboardProductionBibleInput | null;
}

export interface StoryboardStats {
  total_frames: number;
  valid_frames: number;
  needs_review_frames: number;
  invalid_frames: number;
  average_active_assets_per_frame: number;
}

export interface StoryboardCompilerResult {
  compiler: "storyboard_prompt_compiler_v1";
  storyboard_frames: StoryboardFrameSpec[];
  validation: {
    status: StoryboardFrameStatus;
    errors: StoryboardValidationIssue[];
    warnings: StoryboardValidationIssue[];
  };
  stats: StoryboardStats;
  summary: {
    total: number;
    valid: number;
    needs_review: number;
    invalid: number;
    errors: number;
    warnings: number;
  };
}

export interface StoryboardLookup {
  assetsById: Map<string, StoryboardAssetInput>;
  variantsById: Map<string, StoryboardAssetVariantInput>;
  variantsByAssetId: Map<string, StoryboardAssetVariantInput[]>;
  visualAssets: StoryboardVisualAssetInput[];
}
