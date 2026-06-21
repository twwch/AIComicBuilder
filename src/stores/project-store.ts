import { create } from "zustand";
import { apiFetch } from "@/lib/api-fetch";

interface Character {
  id: string;
  name: string;
  description: string;
  referenceImage: string | null;
  referenceImageHistory?: string | null;
  referenceImageSingle?: string | null;
  referenceLayout?: "single" | "three-view" | "four-view" | null;
  visualHint?: string | null;
  scope?: string;
  episodeId?: string | null;
}

interface Dialogue {
  id: string;
  text: string;
  characterId: string;
  characterName: string;
  sequence: number;
}

/**
 * One row from the unified `shot_assets` table, exposed to the frontend.
 * type discriminates the role:
 *   - 'first_frame' / 'last_frame'  → keyframe-mode image assets
 *   - 'reference'                   → reference-mode image assets (multi)
 *   - 'keyframe_video'              → keyframe-mode video output
 *   - 'reference_video'             → reference-mode video output
 */
export type ShotAssetType =
  | "first_frame"
  | "last_frame"
  | "reference"
  | "keyframe_video"
  | "reference_video"
  | "panel_1"
  | "panel_2"
  | "panel_3"
  | "panel_4";

export interface ShotAsset {
  id: string;
  shotId: string;
  type: ShotAssetType;
  sequenceInType: number;
  assetVersion: number;
  isActive: number;
  prompt: string;
  fileUrl: string | null;
  status: "pending" | "generating" | "completed" | "failed";
  characters: string[] | null;
  modelProvider?: string | null;
  modelId?: string | null;
  meta?: { sceneName?: string } | null;
}

export interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  videoScript: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  sceneId?: string;
  transitionIn?: string;
  transitionOut?: string;
  videoPrompt: string | null;
  compositionGuide?: string;
  focalPoint?: string;
  depthOfField?: string;
  soundDesign?: string;
  musicCue?: string;
  qualityScore?: number;
  qualityIssues?: string[];
  isStale?: boolean;
  status: string;
  dialogues: Dialogue[];
  /** Active shot_assets rows for this shot, all types mixed. */
  assets: ShotAsset[];
}

// ─── Asset access helpers (use these in UI instead of legacy fields) ─────
// All helpers are null-safe — accept any object that may or may not have an
// `assets` field, falling back to empty array. Necessary because in-flight
// optimistic updates and partial fetches may produce shot objects without
// the assets field populated.

type ShotLike = { assets?: ShotAsset[] | null };

function safeAssets(shot: ShotLike): ShotAsset[] {
  return Array.isArray(shot?.assets) ? shot.assets : [];
}

/** Active assets only — `isActive === 1`. Use this for "current" reads. */
function activeAssets(shot: ShotLike): ShotAsset[] {
  return safeAssets(shot).filter((a) => a.isActive === 1);
}

/**
 * All version history rows for one slot (shot, type, sequenceInType),
 * sorted newest first by assetVersion. Use this to render history arrows.
 */
export function getAssetHistoryForSlot(
  shot: ShotLike,
  type: ShotAssetType,
  sequenceInType = 0
): ShotAsset[] {
  return safeAssets(shot)
    .filter((a) => a.type === type && a.sequenceInType === sequenceInType)
    .sort((a, b) => b.assetVersion - a.assetVersion);
}

/** Get the active first_frame image URL for a shot, or null. */
export function getFirstFrameUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "first_frame" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Get the active last_frame image URL for a shot, or null. */
export function getLastFrameUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "last_frame" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Get the keyframe-mode video URL, or null. */
export function getKeyframeVideoUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "keyframe_video" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Get the reference-mode video URL, or null. */
export function getReferenceVideoUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "reference_video" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Get all active reference image assets ordered by sequence_in_type. */
export function getReferenceAssets(shot: ShotLike): ShotAsset[] {
  return activeAssets(shot)
    .filter((a) => a.type === "reference")
    .sort((a, b) => a.sequenceInType - b.sequenceInType);
}

/** First reference image URL (used as the "scene reference frame"). */
export function getSceneRefFrameUrl(shot: ShotLike): string | null {
  return getReferenceAssets(shot)[0]?.fileUrl ?? null;
}

/** First-frame prompt text (the LLM-generated description). Falls back to panel_1 asset prompt for 4-grid mode. */
export function getFirstFramePrompt(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "first_frame" && a.sequenceInType === 0
    )?.prompt ??
    activeAssets(shot).find(
      (a) => a.type === "panel_1" && a.sequenceInType === 0
    )?.prompt ??
    null
  );
}

/** Last-frame prompt text. Falls back to panel_4 asset prompt for 4-grid mode. */
export function getLastFramePrompt(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "last_frame" && a.sequenceInType === 0
    )?.prompt ??
    activeAssets(shot).find(
      (a) => a.type === "panel_4" && a.sequenceInType === 0
    )?.prompt ??
    null
  );
}

/** Whether all reference images for a shot have been generated (have file_url). */
export function hasAllReferenceImages(shot: ShotLike): boolean {
  const refs = getReferenceAssets(shot);
  return refs.length > 0 && refs.every((r) => !!r.fileUrl);
}

/** Whether the shot has both first and last frame image URLs. */
export function hasKeyframePair(shot: ShotLike): boolean {
  return !!getFirstFrameUrl(shot) && !!getLastFrameUrl(shot);
}

/** Get the active panel image URL for a 4-grid shot (panel index 1–4). */
export function getPanelUrl(shot: ShotLike, panel: 1 | 2 | 3 | 4): string | null {
  const type = `panel_${panel}` as ShotAssetType;
  return (
    activeAssets(shot).find(
      (a) => a.type === type && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Whether all 4-grid panels have images. */
export function hasAllPanels(shot: ShotLike): boolean {
  return [1, 2, 3, 4].every((p) => !!getPanelUrl(shot, p as 1 | 2 | 3 | 4));
}

export type StoryboardVersion = {
  id: string;
  label: string;
  versionNum: number;
  createdAt: number;
};

interface Project {
  id: string;
  title: string;
  idea: string;
  script: string;
  outline?: string;
  status: string;
  finalVideoUrl: string | null;
  generationMode: "keyframe" | "reference" | "4grid";
  characters: Character[];
  shots: Shot[];
  versions: StoryboardVersion[];
}

interface ProjectStore {
  project: Project | null;
  loading: boolean;
  currentEpisodeId: string | null;
  loadedProjectKey: string | null;
  pendingProjectKey: string | null;
  fetchProject: (id: string, episodeId?: string, versionId?: string, excludeShots?: boolean) => Promise<void>;
  updateIdea: (idea: string) => void;
  updateScript: (script: string) => void;
  setProject: (project: Project) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  loading: false,
  currentEpisodeId: null,
  loadedProjectKey: null,
  pendingProjectKey: null,

  fetchProject: async (id: string, episodeId?: string, versionId?: string, excludeShots?: boolean) => {
    const requestKey = `${id}:${episodeId ?? ""}:${versionId ?? ""}:${excludeShots ? "light" : "full"}`;
    const state = get();

    if (state.pendingProjectKey === requestKey || state.loadedProjectKey === requestKey) {
      return;
    }

    if (
      excludeShots &&
      state.project?.id === id &&
      (episodeId ? state.currentEpisodeId === episodeId : true) &&
      state.project.shots.length > 0
    ) {
      return;
    }

    // Only show loading spinner on initial load (no project yet).
    // Version switches are background refreshes — don't unmount children.
    if (!state.project) set({ loading: true, pendingProjectKey: requestKey });
    else set({ pendingProjectKey: requestKey });

    const params = new URLSearchParams();
    if (versionId) params.set("versionId", versionId);
    if (excludeShots) params.set("exclude", "shots");
    const query = params.toString();

    let url: string;
    if (episodeId) {
      url = `/api/projects/${id}/episodes/${episodeId}${query ? `?${query}` : ""}`;
    } else {
      url = `/api/projects/${id}${query ? `?${query}` : ""}`;
    }

    const res = await apiFetch(url);
    const data = await res.json();
    set({
      project: data,
      loading: false,
      currentEpisodeId: episodeId ?? null,
      loadedProjectKey: requestKey,
      pendingProjectKey: null,
    });
  },

  updateIdea: (idea: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, idea } : null,
    }));
  },

  updateScript: (script: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, script } : null,
    }));
  },

  setProject: (project: Project) => {
    set({ project });
  },
}));
