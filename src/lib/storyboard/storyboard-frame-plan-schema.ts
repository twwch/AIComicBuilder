import type { StoryboardSubjectType } from "./types";

export type StoryboardFramePlanSubjectType = StoryboardSubjectType;

export interface StoryboardFramePlanAssetRef {
  asset_id: string;
  variant_id?: string;
  role_in_frame?: "subject" | "background" | "reaction" | "supporting";
}

export interface StoryboardAgentFramePlan {
  frame_id?: string;
  shot_id: string;
  scene_id: string;
  episode_id: string;
  subject: {
    type: StoryboardFramePlanSubjectType;
    asset_id?: string;
    description: string;
  };
  static_frame_description: string;
  composition?: string;
  camera?: {
    shot_type?: string;
    angle?: string;
    framing?: string;
  };
  active_assets: {
    characters: StoryboardFramePlanAssetRef[];
    scene: StoryboardFramePlanAssetRef | null;
    props: StoryboardFramePlanAssetRef[];
  };
  safety_notes?: string;
  source_shot_ids?: string[];
}

export interface StoryboardFramePlanAgentOutput {
  scene_id: string;
  episode_id: string;
  frames: StoryboardAgentFramePlan[];
}

export function emptyPlanOutput(episodeId: string, sceneId: string): StoryboardFramePlanAgentOutput {
  return { episode_id: episodeId, scene_id: sceneId, frames: [] };
}
