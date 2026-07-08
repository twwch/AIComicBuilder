import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import type { AgentPlatform } from "@/lib/ai/agent-caller";

export type EnrichmentAssetType =
  | "character"
  | "scene"
  | "prop"
  | "set_dressing"
  | "prompt_detail";

export type EnrichmentImportance =
  | "core"
  | "important"
  | "temporary"
  | "background"
  | "prompt_only";

export type EnrichmentSourceType =
  | "explicit"
  | "inferred_from_context"
  | "default_from_bible";

export interface AddedVisualDetails {
  location_detail: string;
  blocking: string;
  props: string[];
  set_dressing: string[];
  wardrobe_detail: string;
  action_detail: string;
  emotion: string;
  lighting: string;
  atmosphere: string;
}

export interface EnrichmentAssetCandidate {
  name: string;
  type: EnrichmentAssetType;
  importance: EnrichmentImportance;
}

export interface EnrichmentPatch {
  scene_id: string;
  beat_id: string;
  original_text: string;
  enriched_text: string;
  added_visual_details: AddedVisualDetails;
  asset_candidates: EnrichmentAssetCandidate[];
  source_type: EnrichmentSourceType;
  confidence: number;
  needs_human_review: boolean;
  reason: string;
}

export interface EnrichmentValidationResult {
  status: "valid" | "needs_review" | "invalid";
  errors: string[];
  warnings: string[];
  rejected_patches: EnrichmentPatch[];
  accepted_patches: EnrichmentPatch[];
}

export interface ScriptVisualEnrichmentStats {
  total_beats: number;
  enriched_beats: number;
  needs_review: number;
  invalid: number;
}

export interface ScriptVisualEnrichmentPreviewResult {
  patches: EnrichmentPatch[];
  validation: EnrichmentValidationResult;
  stats: ScriptVisualEnrichmentStats;
}

export interface ScriptVisualEnrichmentPreviewInput {
  script?: string;
  episodes?: unknown[];
  scenes?: unknown[];
  beats?: unknown[];
  assets?: unknown[];
  productionBible?: unknown;
  modelConfig?: { text?: ProviderConfig | null } | null;
  agentConfig?: {
    platform: AgentPlatform;
    appId: string;
    apiKey: string;
  } | null;
  useAI?: boolean;
  fallbackToLocal?: boolean;
  maxBeats?: number;
}

export interface NormalizedScene {
  id: string;
  episode_id: string;
  title: string;
  text: string;
  location: string;
  description: string;
}

export interface NormalizedBeat {
  id: string;
  scene_id: string;
  episode_id: string;
  text: string;
  scene_title: string;
  scene_text: string;
}

export interface NormalizedAsset {
  id: string;
  type: "character" | "scene" | "prop";
  name: string;
  aliases: string[];
  importance: EnrichmentImportance;
  description: string;
}

export interface NormalizedProductionBible {
  title: string;
  worldSetting: string;
  visualStyle: string;
  eraConstraints: string;
  locationRules: string;
  characterRules: string;
  sceneRules: string;
  propRules: string;
  complianceRules: string;
  rawText: string;
}

export interface EnrichmentContext {
  script: string;
  episodes: unknown[];
  scenes: NormalizedScene[];
  beats: NormalizedBeat[];
  assets: NormalizedAsset[];
  productionBible: NormalizedProductionBible;
  sceneById: Map<string, NormalizedScene>;
  knownCharacters: Set<string>;
  knownScenes: Set<string>;
  knownProps: Set<string>;
}
