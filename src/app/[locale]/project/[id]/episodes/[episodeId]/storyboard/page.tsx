"use client";

import { useParams } from "next/navigation";
import {
  useProjectStore,
  getFirstFrameUrl,
  getLastFrameUrl,
  getSceneRefFrameUrl,
  getKeyframeVideoUrl,
  getReferenceVideoUrl,
  getReferenceAssets,
  hasKeyframePair,
  hasAllPanels,
  getPanelUrl,
  getFirstFramePrompt,
  getLastFramePrompt,
} from "@/stores/project-store";
import { useEpisodeStore } from "@/stores/episode-store";
import { useModelStore } from "@/stores/model-store";
import { ShotCard } from "@/components/editor/shot-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslations, useLocale } from "next-intl";
import { useState, useEffect, useRef, useMemo } from "react";

import { useModelGuard } from "@/hooks/use-model-guard";
import {
  Film,
  Sparkles,
  ImageIcon,
  VideoIcon,
  Loader2,
  Download,
  RefreshCw,
  Play,
  Plus,
  LayoutGrid,
  List,
  ChevronDown,
  GitCompare,
  Binary,
  ArrowRightLeft,
  Check,
  X,
} from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { VideoRatioPicker } from "@/components/editor/video-ratio-picker";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { GenerationModeTab } from "@/components/editor/generation-mode-tab";
import { ShotDrawer } from "@/components/editor/shot-drawer";
import { CharactersInlinePanel } from "@/components/editor/characters-inline-panel";
import { ShotKanban } from "@/components/editor/shot-kanban";
import { VersionCompare } from "@/components/editor/version-compare";
import { VideoModelStrategyBadge } from "@/components/editor/video-model-strategy-badge";
import { VisualStyleBadge } from "@/components/editor/visual-style-badge";
import { PromptEditButton } from "@/components/prompt-templates/prompt-edit-button";
import { AgentPicker } from "@/components/agent-picker";
import { NewVersionDialog } from "@/components/editor/new-version-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { CanvasStoryboard } from "@/components/canvas/canvas-storyboard";
import { AgentChat } from "@/components/canvas/agent-chat";
import { useCanvasStore } from "@/stores/canvas-store";
import Link from "next/link";

export default function EpisodeStoryboardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const params = useParams<{ id: string; episodeId: string }>();
  const { project, fetchProject, loadedProjectKey } = useProjectStore();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [generating, setGenerating] = useState(false);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingVideos, setGeneratingVideos] = useState(false);
  const [generatingSceneFrames, setGeneratingSceneFrames] = useState(false);
  const [generatingRefImages, setGeneratingRefImages] = useState(false);
  const [generatingVideoPrompts, setGeneratingVideoPrompts] = useState(false);
  const [sceneFramesOverwrite, setSceneFramesOverwrite] = useState(false);
  const [generatingFramesOverwrite, setGeneratingFramesOverwrite] = useState(false);
  const [generatingVideosOverwrite, setGeneratingVideosOverwrite] = useState(false);
  const [videoRatio, setVideoRatio] = useState("16:9");
  const versions = project?.versions ?? [];
  const [_selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [openDrawerShotId, setOpenDrawerShotId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "kanban" | "canvas">("list");

  // Layout fetches lightweight data (no shots); re-fetch full data here
  useEffect(() => {
    if (
      project &&
      project.shots &&
      project.shots.length === 0 &&
      params.id &&
      params.episodeId &&
      loadedProjectKey !== `${params.id}:${params.episodeId}::full`
    ) {
      fetchProject(params.id, params.episodeId);
    }
  }, [project?.shots?.length, params.id, params.episodeId, fetchProject, loadedProjectKey]);
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);
  const versionDropdownRef = useRef<HTMLDivElement>(null);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    completed: number;
    failed: string[]; // shot IDs that failed
  } | null>(null);
  const [lastFailedShots, setLastFailedShots] = useState<string[]>([]);
  const [lastBatchAction, setLastBatchAction] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [generatingRefPrompts, setGeneratingRefPrompts] = useState(false);
  const [generatingKeyframeAssets, setGeneratingKeyframeAssets] = useState(false);
  const [newVersionDialogOpen, setNewVersionDialogOpen] = useState(false);
  const [transitionPreview, setTransitionPreview] = useState<Array<{ shotId: string; sequence: number; currentIn: string; currentOut: string; recommendedIn: string; recommendedOut: string; reason: string }> | null>(null);
  const [transitionDialogOpen, setTransitionDialogOpen] = useState(false);
  const [applyingTransitions, setApplyingTransitions] = useState(false);
  const [diagnosticData, setDiagnosticData] = useState<{
    summary: { totalShots: number; completedShots: number; failedShots: number; stuckShots: number; staleShots: number; shotsWithAllPanels: number; shotsWithVideoPrompt: number; readyForVideo: number; completionPercent: number; suboptimalTransitions: number };
    shots: Array<{ id: string; sequence: number; status: string; missingRequired: string[]; isStale: boolean; hasFirstFrame: boolean; hasLastFrame: boolean; hasVideo: boolean; hasVideoPrompt: boolean }>;
    diagnostics: Array<{ severity: string; code: string; message: string; fix: string }>;
  } | null>(null);
  const [diagnosticDialogOpen, setDiagnosticDialogOpen] = useState(false);
  const [loadingDiagnostic, setLoadingDiagnostic] = useState(false);

  const currentEpisodeId = useProjectStore((s) => s.currentEpisodeId);
  const episodeStoreEpisodes = useEpisodeStore((s) => s.episodes);
  const fetchEpisodes = useEpisodeStore((s) => s.fetchEpisodes);

  useEffect(() => {
    if (project?.id && episodeStoreEpisodes.length === 0) {
      fetchEpisodes(project.id);
    }
  }, [project?.id, episodeStoreEpisodes.length, fetchEpisodes]);


  function switchView(mode: "list" | "kanban" | "canvas") {
    setViewMode(mode);
    if (project) localStorage.setItem(`storyboardView:${project.id}`, mode);
  }

  const textGuard = useModelGuard("text");
  const imageGuard = useModelGuard("image");
  const videoGuard = useModelGuard("video");

  useEffect(() => {
    if (!project?.id) return;
    const stored = localStorage.getItem(`storyboardView:${project.id}`);
    if (stored === "list" || stored === "kanban" || stored === "canvas") setViewMode(stored);
  }, [project?.id]);

  // Derived: if user's selection is valid keep it, otherwise fall back to latest
  const selectedVersionId = (_selectedVersionId && versions.some((v) => v.id === _selectedVersionId))
    ? _selectedVersionId
    : (versions[0]?.id ?? null);

  const sceneGroups = useMemo(() => {
    if (!project) return { groups: [], ungrouped: [] };

    const groupMap = new Map<string, { sceneId: string; shots: typeof project.shots }>();
    const ungrouped: typeof project.shots = [];

    for (const shot of project.shots) {
      if (shot.sceneId) {
        const existing = groupMap.get(shot.sceneId);
        if (existing) {
          existing.shots.push(shot);
        } else {
          groupMap.set(shot.sceneId, { sceneId: shot.sceneId, shots: [shot] });
        }
      } else {
        ungrouped.push(shot);
      }
    }

    return {
      groups: Array.from(groupMap.values()),
      ungrouped,
    };
  }, [project?.shots]);

  // Check if all reference images are generated (for reference mode blocking)
  const allRefImagesGenerated = useMemo(() => {
    if (!project) return true;
    const mode = (project.generationMode || "keyframe") as "keyframe" | "reference" | "4grid";
    if (mode !== "reference") return true;
    for (const shot of project.shots) {
      const refOnly = getReferenceAssets(shot);
      if (refOnly.length === 0) continue;
      if (refOnly.some((r) => r.status !== "completed" && r.prompt)) {
        return false;
      }
    }
    return true;
  }, [project?.shots, project?.generationMode]);

  const shotsWithRefPrompts = useMemo(() => {
    if (!project) return 0;
    return project.shots.filter((s) => {
      const refOnly = getReferenceAssets(s);
      return refOnly.length > 0 && refOnly.some((r) => r.prompt);
    }).length;
  }, [project?.shots]);

  const nextVersionNum = useMemo(() => {
    if (versions.length === 0) return 1;
    return Math.max(...versions.map((v) => v.versionNum)) + 1;
  }, [versions]);

  if (!project) return null;

  const totalShots = project.shots.length;
  const generationMode = (project.generationMode || "keyframe") as "keyframe" | "reference" | "4grid";
  const shotHasAnyFrame = (shot: typeof project.shots[number]) => {
    if (generationMode === "reference") return !!getSceneRefFrameUrl(shot);
    if (generationMode === "4grid") return [1, 2, 3, 4].some((p) => !!getPanelUrl(shot, p as 1 | 2 | 3 | 4));
    return !!(getFirstFrameUrl(shot) || getLastFrameUrl(shot));
  };
  const shotHasRequiredFrames = (shot: typeof project.shots[number]) => {
    if (generationMode === "reference") return !!getSceneRefFrameUrl(shot);
    if (generationMode === "4grid") return hasAllPanels(shot);
    return hasKeyframePair(shot);
  };

  const shotsWithFrames = project.shots.filter((s) => shotHasRequiredFrames(s)).length;
  const shotsWithVideoPrompts = project.shots.filter((s) => s.videoPrompt).length;
  const shotsWithFrameAny = project.shots.filter((s) => shotHasAnyFrame(s)).length;
  const shotsReadyForFrameGeneration = project.shots.filter((s) =>
    generationMode === "4grid"
      ? !!(s.prompt || s.motionScript || s.videoScript || getFirstFramePrompt(s) || getLastFramePrompt(s))
      : !!(getFirstFramePrompt(s) || getLastFramePrompt(s))
  ).length;
  const charactersWithRefs = project.characters.filter((c) => c.referenceImage);
  const hasReferenceImages = charactersWithRefs.length > 0;

  const stuckShotsCount = project.shots.filter((s) => s.status === "generating").length;
  const anyGenerating = generating || generatingFrames || generatingVideos || generatingSceneFrames || generatingRefImages || generatingVideoPrompts || generatingRefPrompts;

  const drawerShots = project.shots;

  async function handleGenerateShots() {
    if (!project?.id) return;
    if (!textGuard()) return;
    setGenerating(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "shot_split",
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } catch (err) {
      console.error("Shot split error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGenerating(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setSelectedVersionId(null); // derived value will auto-select latest
  }

  function pollTaskSSE(taskId: string, signal?: AbortSignal): Promise<{ status: string; result?: { total?: number; completed?: number; failed?: string[] } }> {
    return new Promise((resolve, reject) => {
      const es = new EventSource(`/api/tasks/${taskId}/stream`);
      let settled = false;

      const finish = () => { if (!settled) { settled = true; es.close(); } };

      if (signal) {
        signal.addEventListener("abort", () => { finish(); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      }

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "progress" && data.progress) {
            setBatchProgress({
              total: data.progress.total ?? 0,
              completed: data.progress.completed ?? 0,
              failed: data.progress.failed ?? [],
            });
          } else if (data.type === "complete") {
            finish();
            const result = data.result || {};
            const failedIds = result.failed ?? [];
            const totalDone = result.total ?? 0;
            if (failedIds.length > 0) {
              setLastFailedShots(failedIds);
              toast.error(`${failedIds.length}/${totalDone} shots failed`);
            } else {
              setLastFailedShots([]);
              if (totalDone > 0) toast.success(`All ${totalDone} shots completed`);
            }
            resolve({ status: "completed", result });
          } else if (data.type === "fail") {
            finish();
            setLastFailedShots([]);
            toast.error(data.error || "Task failed");
            resolve({ status: "failed", result: { failed: [] } });
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        finish();
        // Fall back to HTTP polling
        pollTask(taskId, signal).then(resolve).catch(reject);
      };
    });
  }

  async function pollTask(taskId: string, signal?: AbortSignal) {
    const maxPolls = 600;
    for (let i = 0; i < maxPolls; i++) {
      if (signal?.aborted) break;
      await new Promise((r) => setTimeout(r, 3000));
      if (signal?.aborted) break;
      try {
        const res = await apiFetch(`/api/tasks/${taskId}`, { signal });
        const task = await res.json() as { status: string; result?: { total?: number; completed?: number; failed?: string[] }; error?: string };
        if (task.result) {
          setBatchProgress({
            total: task.result.total ?? 0,
            completed: task.result.completed ?? 0,
            failed: task.result.failed ?? [],
          });
        }
        if (task.status === "completed" || task.status === "failed") {
          const failedIds = task.result?.failed ?? [];
          const totalDone = task.result?.total ?? 0;
          if (failedIds.length > 0) {
            setLastFailedShots(failedIds);
            toast.error(`${failedIds.length}/${totalDone} shots failed`);
          } else {
            setLastFailedShots([]);
            if (totalDone > 0) toast.success(`All ${totalDone} shots completed`);
          }
          return task;
        }
        if (task.error) {
          throw new Error(task.error);
        }
      } catch {
        // network hiccup — retry
      }
    }
    throw new Error("Task polling timed out");
  }

  async function startBatchTask(
    action: string,
    body: Record<string, unknown>,
    targets: number,
  ) {
    if (!project?.id) return;
    setBatchProgress({ total: targets, completed: 0, failed: [] });
    const abortCtrl = new AbortController();

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortCtrl.signal,
      });

      const data = await response.json() as
        | { taskId: string }
        | { results: Array<{ shotId?: string; status: string }> };

      if ("taskId" in data && data.taskId) {
        try {
          await pollTaskSSE(data.taskId, abortCtrl.signal);
        } catch {
          await pollTask(data.taskId, abortCtrl.signal);
        }
      } else if ("results" in data && Array.isArray(data.results)) {
        const failedIds = data.results.filter((r) => r.status === "error").map((r) => r.shotId!).filter(Boolean);
        const totalProcessed = data.results.length || targets;
        setBatchProgress({ total: totalProcessed, completed: totalProcessed, failed: failedIds });
        if (failedIds.length > 0) {
          setLastFailedShots(failedIds);
          toast.error(`${failedIds.length}/${totalProcessed} shots failed`);
        } else {
          setLastFailedShots([]);
          if (totalProcessed > 0) toast.success(`All ${totalProcessed} shots completed`);
        }
      }
    } catch (err) {
      if (abortCtrl.signal.aborted) return;
      console.error(`${action} error:`, err);
      toast.error(err instanceof Error ? err.message : "Generation failed");
    }
  }

  async function handleBatchGenerateFrames(overwrite = false, chainContinuity = false) {
    if (!project?.id) return;
    if (!imageGuard()) return;
    setGeneratingFramesOverwrite(overwrite);
    setGeneratingFrames(true);
    setLastBatchAction("batch_frame_generate");

    const targets = project.shots.filter((s) => overwrite ? true : !getFirstFrameUrl(s));
    await startBatchTask("batch_frame_generate", {
      action: "batch_frame_generate",
      payload: { ratio: videoRatio, overwrite, versionId: selectedVersionId, chainContinuity },
      modelConfig: getModelConfig(),
      episodeId: useProjectStore.getState().currentEpisodeId,
    }, targets.length);

    setGeneratingFramesOverwrite(false);
    setGeneratingFrames(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setBatchProgress(null);
  }

  async function handleBatchGenerateVideos(overwrite = false) {
    if (!project?.id) return;
    if (!videoGuard()) return;
    setGeneratingVideosOverwrite(overwrite);
    setGeneratingVideos(true);
    setLastBatchAction("batch_video_generate");

    const targets = project.shots.filter((s) => overwrite ? true : !getKeyframeVideoUrl(s));
    await startBatchTask("batch_video_generate", {
      action: "batch_video_generate",
      payload: { ratio: videoRatio, overwrite, versionId: selectedVersionId },
      modelConfig: getModelConfig(),
      episodeId: useProjectStore.getState().currentEpisodeId,
    }, targets.length);

    setGeneratingVideosOverwrite(false);
    setGeneratingVideos(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setBatchProgress(null);
  }

  async function handleBatchGenerateSceneFrames(overwrite = false) {
    if (!project?.id) return;
    if (!imageGuard()) return;
    setSceneFramesOverwrite(overwrite);
    setGeneratingSceneFrames(true);
    setLastBatchAction("batch_scene_frame");

    const targets = project.shots.filter((s) => overwrite ? true : !getSceneRefFrameUrl(s));
    await startBatchTask("batch_scene_frame", {
      action: "batch_scene_frame",
      payload: { overwrite, versionId: selectedVersionId, ratio: videoRatio },
      modelConfig: getModelConfig(),
      episodeId: useProjectStore.getState().currentEpisodeId,
    }, targets.length);

    setSceneFramesOverwrite(false);
    setGeneratingSceneFrames(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setBatchProgress(null);
  }

  async function handleGenerateRefPrompts() {
    if (!project?.id) return;
    if (!textGuard()) return;
    setGeneratingRefPrompts(true);
    try {
      const resp = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_ref_prompts",
          payload: { versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      if (!resp.ok) throw new Error("Failed");
      const data = await resp.json();
      toast.success(`已生成 ${data.updatedCount}/${data.totalShots} 个镜头的参考图提示词`);
      await fetchProject(project.id, currentEpisodeId || undefined, selectedVersionId || undefined);
    } catch (err) {
      toast.error("Failed to generate ref prompts");
      console.error(err);
    } finally {
      setGeneratingRefPrompts(false);
    }
  }

  async function handleGenerateKeyframeAssets() {
    if (!project?.id) return;
    if (!textGuard()) return;
    setGeneratingKeyframeAssets(true);
    try {
      const resp = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_keyframe_prompts",
          payload: { versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      if (!resp.ok) throw new Error("Failed");
      const data = await resp.json();
      toast.success(`已生成 ${data.updatedCount}/${data.totalShots} 个镜头的首尾帧提示词`);
      await fetchProject(project.id, currentEpisodeId || undefined, selectedVersionId || undefined);
    } catch (err) {
      toast.error("生成首尾帧提示词失败");
      console.error(err);
    } finally {
      setGeneratingKeyframeAssets(false);
    }
  }

  async function handleBatchGenerateVideoPrompts() {
    if (!project?.id) return;
    setGeneratingVideoPrompts(true);
    setLastBatchAction("batch_video_prompt");

    const targets = project.shots.filter((s) => !s.videoPrompt);
    setBatchProgress({ total: targets.length, completed: 0, failed: [] });

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_video_prompt",
          payload: { versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      const data = await response.json() as { results: Array<{ shotId?: string; status: string }> };
      const failedIds = (data.results || []).filter((r) => r.status === "error").map((r) => r.shotId!).filter(Boolean);
      const totalProcessed = data.results?.length || targets.length;
      setBatchProgress({ total: totalProcessed, completed: totalProcessed, failed: failedIds });

      if (failedIds.length > 0) {
        setLastFailedShots(failedIds);
        toast.error(`${failedIds.length}/${totalProcessed} shots failed`);
      } else {
        setLastFailedShots([]);
        toast.success(`All ${totalProcessed} shots completed`);
      }
    } catch (err) {
      console.error("Batch video prompt error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }

    setGeneratingVideoPrompts(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setBatchProgress(null);
  }

  async function handleBatchGenerateReferenceVideos(overwrite = false) {
    if (!project?.id) return;
    if (!videoGuard()) return;
    setGeneratingVideosOverwrite(overwrite);
    setGeneratingVideos(true);
    setLastBatchAction("batch_reference_video");

    const targets = project.shots.filter((s) => overwrite ? true : !getReferenceVideoUrl(s));
    await startBatchTask("batch_reference_video", {
      action: "batch_reference_video",
      payload: { ratio: videoRatio, overwrite, versionId: selectedVersionId },
      modelConfig: getModelConfig(),
      episodeId: useProjectStore.getState().currentEpisodeId,
    }, targets.length);

    setGeneratingVideosOverwrite(false);
    setGeneratingVideos(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setBatchProgress(null);
  }

  async function handleRetryFailed() {
    if (!project?.id) return;
    const failedShots = project.shots.filter((s) => lastFailedShots.includes(s.id));
    if (failedShots.length === 0) return;

    // Map batch action to single-shot action
    const actionMap: Record<string, string> = {
      batch_frame_generate: "single_frame_generate",
      batch_video_generate: "single_video_generate",
      batch_scene_frame: "single_scene_frame",
      batch_reference_video: "single_reference_video",
      batch_video_prompt: "single_video_prompt",
    };
    const singleAction = lastBatchAction ? actionMap[lastBatchAction] : null;
    if (!singleAction) return;

    // Set appropriate generating state
    if (lastBatchAction === "batch_frame_generate") setGeneratingFrames(true);
    else if (lastBatchAction === "batch_video_generate" || lastBatchAction === "batch_reference_video") setGeneratingVideos(true);
    else if (lastBatchAction === "batch_scene_frame") setGeneratingSceneFrames(true);
    else if (lastBatchAction === "batch_video_prompt") setGeneratingVideoPrompts(true);

    setBatchProgress({ total: failedShots.length, completed: 0, failed: [] });
    const newFailedIds: string[] = [];

    for (const shot of failedShots) {
      try {
        const resp = await apiFetch(`/api/projects/${project.id}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: singleAction,
            payload: { shotId: shot.id, ratio: videoRatio, versionId: selectedVersionId },
            modelConfig: getModelConfig(),
            episodeId: useProjectStore.getState().currentEpisodeId,
          }),
        });
        if (!resp.ok) throw new Error(`Shot ${shot.sequence} failed`);
      } catch (err) {
        console.error(`Retry failed for shot ${shot.id}:`, err);
        newFailedIds.push(shot.id);
      }
      setBatchProgress((prev) =>
        prev ? { ...prev, completed: prev.completed + 1, failed: newFailedIds.slice() } : null
      );
    }

    // Reset generating states
    setGeneratingFrames(false);
    setGeneratingVideos(false);
    setGeneratingSceneFrames(false);
    setGeneratingVideoPrompts(false);

    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    setLastFailedShots(newFailedIds);
    setBatchProgress(null);

    if (newFailedIds.length === 0) {
      toast.success("All retries succeeded");
    } else {
      toast.error(`${newFailedIds.length} shots still failing`);
    }
  }

  async function handleResetStuckShots() {
    if (!project?.id) return;
    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset_stuck_shots",
          payload: { versionId: selectedVersionId },
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });
      if (!response.ok) throw new Error("Failed to reset stuck shots");
      const data = await response.json() as { count: number };
      toast.success(`已重置 ${data.count} 个卡住的镜头`);
      await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    } catch (err) {
      toast.error("重置失败");
      console.error(err);
    }
  }

  async function handlePreviewTransitions() {
    if (!project?.id || !currentEpisodeId) return;
    try {
      const res = await apiFetch(`/api/projects/${project.id}/transitions?episodeId=${currentEpisodeId}`);
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "加载转场推荐失败"); return; }
      setTransitionPreview(data.recommendations || []);
      setTransitionDialogOpen(true);
    } catch (err) {
      toast.error("加载转场推荐失败");
    }
  }

  async function handleRunDiagnostic() {
    if (!project?.id) return;
    setLoadingDiagnostic(true);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/diagnostic`);
      const data = await res.json();
      if (!res.ok) { toast.error("诊断失败"); return; }
      setDiagnosticData(data);
      setDiagnosticDialogOpen(true);
    } catch (err) {
      toast.error("诊断失败");
    } finally {
      setLoadingDiagnostic(false);
    }
  }

  async function handleApplyTransitions() {
    if (!project?.id || !currentEpisodeId) return;
    setApplyingTransitions(true);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/transitions?episodeId=${currentEpisodeId}`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); toast.error(err.error || "应用转场失败"); return; }
      toast.success("转场已应用");
      setTransitionDialogOpen(false);
      setTransitionPreview(null);
      await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
    } catch (err) {
      toast.error("应用转场失败");
    } finally {
      setApplyingTransitions(false);
    }
  }

  async function handleAutoRun() {
    if (!project?.id) return;
    if (!confirm(t("project.autoRunConfirm"))) return;

    const shots = project.shots;
    const needsText = shots.some((s) => !s.prompt && !s.motionScript);
    const needsFrame = shots.some((s) => !shotHasRequiredFrames(s));
    const needsPrompt = needsFrame || shots.some((s) => !s.videoPrompt);
    const needsVideo = shots.some((s) =>
      generationMode === "reference" ? !getReferenceVideoUrl(s) : !getKeyframeVideoUrl(s)
    );

    if (needsText) await handleGenerateShots();
    if (generationMode === "reference") {
      // Step 2a: Generate ref image prompts if needed
      const needsRefPrompts = shots.some((s) => getReferenceAssets(s).length === 0);
      if (needsRefPrompts) await handleGenerateRefPrompts();

      // Step 2b: Generate ref images
      if (needsFrame) await handleBatchGenerateSceneFrames(false);
    } else {
      if (needsFrame) await handleBatchGenerateFrames(false, true);
    }
    if (needsPrompt) await handleBatchGenerateVideoPrompts();
    if (needsVideo) {
      if (generationMode === "reference") await handleBatchGenerateReferenceVideos(false);
      else await handleBatchGenerateVideos(false);
    }
  }

  return (
    <div className="animate-page-in space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Film className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("project.storyboard")}
            </h2>
            <div className="flex items-center gap-2">
              <p className="text-xs text-[--text-muted]">
                {totalShots} shots
              </p>
              <VisualStyleBadge idea={project?.idea} script={project?.script} />
              <VideoModelStrategyBadge />
            </div>
            <div className="mt-1">
              <VideoModelStrategyBadge showLabel={false} showHint />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PromptEditButton
            // Full set of storyboard-related prompts — matches the
            // settings/prompts page "分镜" tab exactly (9 prompts across
            // shot / frame / video categories). Both keyframe and
            // reference modes share the same list so the quick-access
            // drawer and the backend menu are 1:1 consistent.
            promptKeys={[
              // shot
              "shot_split",
              "shot_split_keyframe_assets",
              // frame
              "frame_generate_first",
              "frame_generate_last",
              "scene_frame_generate",
              "ref_image_prompts",
              // video
              "video_generate",
              "video_generate_4grid",
              "ref_video_generate",
              "ref_video_prompt",
            ]}
            projectId={project.id}
          />
          {totalShots > 0 && (
            <div className="inline-flex gap-1 rounded-xl border border-[--border-subtle] bg-[--surface] p-1">
              <button
                onClick={() => switchView("list")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 ${
                  viewMode === "list"
                    ? "bg-white text-primary shadow ring-1 ring-primary/20"
                    : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
                }`}
              >
                <List className={`h-3.5 w-3.5 ${viewMode === "list" ? "text-primary" : ""}`} />
                {t("project.viewList")}
              </button>
              <button
                onClick={() => switchView("kanban")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 ${
                  viewMode === "kanban"
                    ? "bg-white text-primary shadow ring-1 ring-primary/20"
                    : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
                }`}
              >
                <LayoutGrid className={`h-3.5 w-3.5 ${viewMode === "kanban" ? "text-primary" : ""}`} />
                {t("project.viewKanban")}
              </button>
              <button
                onClick={() => switchView("canvas")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 ${
                  viewMode === "canvas"
                    ? "bg-white text-primary shadow ring-1 ring-primary/20"
                    : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
                }`}
              >
                <Binary className={`h-3.5 w-3.5 ${viewMode === "canvas" ? "text-primary" : ""}`} />
                Canvas
              </button>
            </div>
          )}
          {totalShots > 0 && versions.length >= 2 && (
            <Button
              variant={compareMode ? "default" : "outline"}
              size="sm"
              onClick={() => setCompareMode(!compareMode)}
            >
              <GitCompare className="h-3.5 w-3.5" />
              {compareMode ? t("project.exitCompare") || "Exit Compare" : t("project.compareVersions") || "Compare Versions"}
            </Button>
          )}
          {totalShots > 0 && (
            <Link
              href={`/${locale}/project/${project!.id}/episodes/${useProjectStore.getState().currentEpisodeId}/preview${selectedVersionId ? `?versionId=${selectedVersionId}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
            >
              <Film className="h-3.5 w-3.5" />
              {t("project.preview")}
            </Link>
          )}
          {totalShots > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const a = document.createElement("a");
                a.href = `/api/projects/${project!.id}/download?episodeId=${useProjectStore.getState().currentEpisodeId}`;
                a.download = "";
                a.click();
              }}
            >
              <Download className="h-3.5 w-3.5" />
              {t("project.downloadAll")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Control Panel ── */}
      <div className="rounded-2xl border border-[--border-subtle] bg-white p-4 space-y-3">
        {/* Generation mode + version tabs row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <GenerationModeTab />

          {/* Version tabs */}
          {versions.length > 0 && (
            <div className="flex items-center gap-1">
              {/* Show 2 newest versions */}
              {versions.slice(0, 2).map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setSelectedVersionId(v.id);
                    fetchProject(project!.id, currentEpisodeId || undefined, v.id);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    selectedVersionId === v.id
                      ? "bg-primary/10 text-primary"
                      : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-secondary]"
                  }`}
                >
                  {v.label}
                </button>
              ))}
              {/* Older versions dropdown */}
              {versions.length > 2 && (
                <div className="relative" ref={versionDropdownRef}>
                  <button
                    onClick={() => setVersionDropdownOpen((o) => !o)}
                    className={`flex items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                      versions.slice(2).some((v) => v.id === selectedVersionId)
                        ? "bg-primary/10 text-primary"
                        : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-secondary]"
                    }`}
                  >
                    {versions.slice(2).some((v) => v.id === selectedVersionId)
                      ? versions.find((v) => v.id === selectedVersionId)?.label
                      : `+${versions.length - 2}`}
                    <ChevronDown className={`h-3 w-3 transition-transform ${versionDropdownOpen ? "rotate-180" : ""}`} />
                  </button>
                  {versionDropdownOpen && (
                    <div
                      className="absolute right-0 top-full z-20 mt-1 min-w-[140px] overflow-hidden rounded-xl border border-[--border-subtle] bg-white shadow-lg"
                      onMouseLeave={() => setVersionDropdownOpen(false)}
                    >
                      {versions.slice(2).map((v) => (
                        <button
                          key={v.id}
                          onClick={() => {
                            setSelectedVersionId(v.id);
                            fetchProject(project!.id, currentEpisodeId || undefined, v.id);
                            setVersionDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-[13px] font-medium transition-colors hover:bg-[--surface] ${
                            selectedVersionId === v.id ? "text-primary" : "text-[--text-secondary]"
                          }`}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => setNewVersionDialogOpen(true)}
                disabled={anyGenerating}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-secondary] disabled:opacity-40"
                title={t("project.newVersion") || "New Version"}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Characters inline panel (Feature B) */}
        <CharactersInlinePanel
          characters={project.characters}
          projectId={project.id}
          generationMode={generationMode}
          onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
        />

        {/* Batch operations */}
        {viewMode === "list" && (
        <div className="space-y-2">
          {/* Row 1: Generate text / shots */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">1</span>
            <AgentPicker projectId={project.id} category="shot_split" />
            <InlineModelPicker capability="text" />
            <Button
              onClick={handleGenerateShots}
              disabled={anyGenerating}
              variant="default"
              size="sm"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generating ? t("common.generating") : t("project.generateShots")}
            </Button>
          </div>

          {/* Row 2: Frames */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">2</span>
            <AgentPicker projectId={project.id} category={generationMode === "reference" ? "ref_image_prompts" : "keyframe_prompts"} />
            <InlineModelPicker capability="image" />
            {generationMode === "reference" ? (
              <>
                <Button
                  size="sm"
                  onClick={handleGenerateRefPrompts}
                  disabled={generatingRefPrompts || anyGenerating || totalShots === 0}
                >
                  {generatingRefPrompts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {generatingRefPrompts ? t("common.generating") : (t("storyboard.generateRefPrompts") || "Generate Ref Prompts")}
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleBatchGenerateSceneFrames(false)}
                  disabled={anyGenerating || totalShots === 0 || shotsWithRefPrompts === 0}
                >
                  {generatingSceneFrames && !sceneFramesOverwrite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {generatingSceneFrames && !sceneFramesOverwrite ? t("common.generating") : (t("storyboard.batchGenerateRefImages") || "Batch Generate Ref Images")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBatchGenerateSceneFrames(true)}
                  disabled={anyGenerating || totalShots === 0 || !hasReferenceImages}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={handleGenerateKeyframeAssets}
                  disabled={generatingKeyframeAssets || anyGenerating || totalShots === 0}
                  title={generationMode === "4grid" ? "生成四宫格各面板的图像提示词" : "基于已有的镜头元数据生成首尾帧的图像提示词"}
                >
                  {generatingKeyframeAssets ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {generatingKeyframeAssets ? "生成中…" : generationMode === "4grid" ? "生成面板提示词" : "生成首尾帧提示词"}
                </Button>
                <Button
                  onClick={() => handleBatchGenerateFrames(false)}
                  disabled={anyGenerating || totalShots === 0 || shotsReadyForFrameGeneration === 0}
                  variant="default"
                  size="sm"
                >
                  {generatingFrames && !generatingFramesOverwrite ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5" />
                  )}
                  {generatingFrames && !generatingFramesOverwrite
                    ? t("common.generating")
                    : t("project.batchGenerateFrames")}
                </Button>
                <Button
                  onClick={() => handleBatchGenerateFrames(true)}
                  disabled={anyGenerating || totalShots === 0 || shotsReadyForFrameGeneration === 0}
                  variant="ghost"
                  size="icon"
                  title={t("project.batchGenerateFramesOverwrite")}
                >
                  {generatingFrames && generatingFramesOverwrite ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
              </>
            )}
          </div>

          {/* Row 3: Video prompts */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">3</span>
            <AgentPicker projectId={project.id} category={generationMode === "reference" ? "ref_video_prompts" : "video_prompts"} />
            <InlineModelPicker capability="text" />
            <Button
              onClick={handleBatchGenerateVideoPrompts}
              disabled={anyGenerating || shotsWithFrameAny === 0}
              variant="default"
              size="sm"
            >
              {generatingVideoPrompts ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generatingVideoPrompts ? t("common.generating") : t("project.batchGenerateVideoPrompts")}
            </Button>
          </div>

          {/* Row 4: Videos */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">4</span>
            <InlineModelPicker capability="video" />
            <VideoRatioPicker value={videoRatio} onChange={setVideoRatio} />
            <Button
              onClick={() =>
                generationMode === "reference"
                  ? handleBatchGenerateReferenceVideos(false)
                  : handleBatchGenerateVideos(false)
              }
              disabled={
  anyGenerating ||
  totalShots === 0 ||
  shotsWithVideoPrompts !== totalShots ||
  (generationMode === "reference"
    ? !hasReferenceImages || !allRefImagesGenerated || shotsWithRefPrompts !== totalShots
    : shotsWithFrames !== totalShots)
}
              variant="default"
              size="sm"
            >
              {generatingVideos && !generatingVideosOverwrite ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <VideoIcon className="h-3.5 w-3.5" />
              )}
              {generatingVideos && !generatingVideosOverwrite
                ? t("common.generating")
                : generationMode === "reference"
                  ? t("project.batchGenerateReferenceVideos")
                  : generationMode === "4grid"
                    ? "批量生成四宫格视频"
                    : t("project.batchGenerateVideos")}
            </Button>
            <Button
              onClick={() =>
                generationMode === "reference"
                  ? handleBatchGenerateReferenceVideos(true)
                  : handleBatchGenerateVideos(true)
              }
              disabled={
  anyGenerating ||
  totalShots === 0 ||
  shotsWithVideoPrompts !== totalShots ||
  (generationMode === "reference"
    ? !hasReferenceImages || !allRefImagesGenerated || shotsWithRefPrompts !== totalShots
    : shotsWithFrames !== totalShots)
}
              variant="ghost"
              size="icon"
              title={t("project.batchGenerateVideosOverwrite")}
            >
              {generatingVideos && generatingVideosOverwrite ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          {/* Row 5: Transitions */}
          {totalShots > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded-full bg-[--surface] text-[10px] font-bold text-[--text-muted]">T</span>
              <Button
                size="sm"
                variant="outline"
                onClick={handlePreviewTransitions}
                disabled={anyGenerating}
              >
                <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                转场推荐
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRunDiagnostic}
                disabled={loadingDiagnostic}
              >
                {loadingDiagnostic ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Binary className="h-3.5 w-3.5 mr-1" />}
                诊断
              </Button>
            </div>
          )}

          {/* Divider + Auto-run */}
          {totalShots > 0 && (
            <>
              <div className="h-px bg-[--border-subtle]" />
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleAutoRun}
                  disabled={anyGenerating}
                  variant="default"
                  size="sm"
                  className="gap-1.5"
                >
                  {anyGenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  {t("project.autoRun")}
                </Button>
                {lastFailedShots.length > 0 && !batchProgress && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetryFailed}
                    disabled={anyGenerating}
                    className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  >
                    <RefreshCw className="mr-1 h-4 w-4" />
                    Retry {lastFailedShots.length} failed
                  </Button>
                )}
                {stuckShotsCount > 0 && !batchProgress && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetStuckShots}
                    disabled={anyGenerating}
                    className="border-amber-500/50 text-amber-600 hover:bg-amber-50"
                  >
                    <RefreshCw className="mr-1 h-4 w-4" />
                    Reset {stuckShotsCount} stuck
                  </Button>
                )}
              </div>
            </>
          )}

          {/* Batch progress bar */}
          {batchProgress && (
            <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              <div className="flex-1">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{
                      width: `${batchProgress.total > 0 ? (batchProgress.completed / batchProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <span className="text-sm text-muted-foreground tabular-nums">
                {batchProgress.completed}/{batchProgress.total}
                {batchProgress.failed.length > 0 && (
                  <span className="text-destructive ml-1">
                    ({batchProgress.failed.length} failed)
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Shot cards */}
      {compareMode ? (
        <VersionCompare
          versions={versions}
          projectId={project.id}
          currentEpisodeId={currentEpisodeId}
        />
      ) : totalShots === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Film className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("project.storyboard")}
          </h3>
          <p className="mt-2 max-w-sm text-center text-sm text-[--text-secondary]">
            {t("shot.noShots")}
          </p>
        </div>
      ) : viewMode === "canvas" ? (
        <CanvasView project={project} />
      ) : viewMode === "kanban" ? (
        <ShotKanban
          shots={project.shots}
          generationMode={generationMode}
          anyGenerating={anyGenerating}
          onOpenDrawer={(id) => setOpenDrawerShotId(id)}
          onBatchFrames={() => handleBatchGenerateFrames(false)}
          onBatchSceneFrames={() => handleBatchGenerateSceneFrames(false)}
          onBatchVideoPrompts={handleBatchGenerateVideoPrompts}
          onBatchVideos={() => handleBatchGenerateVideos(false)}
          onBatchReferenceVideos={() => handleBatchGenerateReferenceVideos(false)}
          generatingFrames={generatingFrames}
          generatingSceneFrames={generatingSceneFrames}
          generatingVideoPrompts={generatingVideoPrompts}
          generatingVideos={generatingVideos}
        />
      ) : (
        (() => {
          const renderShotCard = (shot: typeof project.shots[number]) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              projectId={project.id}
              episodeId={currentEpisodeId}
              onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
              generationMode={generationMode}
              videoRatio={videoRatio}
              isCompact={openDrawerShotId !== null}
              onOpenDrawer={(id) => setOpenDrawerShotId(id)}
              batchGeneratingFrames={generationMode === "reference" ? generatingSceneFrames : generatingFrames}
              batchGeneratingVideoPrompts={generatingVideoPrompts}
              batchGeneratingVideos={generatingVideos}
            />
          );

          return sceneGroups.groups.length > 0 ? (
            <div className="space-y-6">
              {sceneGroups.groups.map((group, groupIndex) => (
                <div key={group.sceneId} className="space-y-3">
                  {/* Scene header */}
                  <div className="flex items-center gap-2 border-b pb-2 pt-4">
                    <Film className="h-4 w-4 text-[--text-muted]" />
                    <h3 className="text-sm font-medium">
                      Scene {groupIndex + 1}
                    </h3>
                    <span className="text-xs text-[--text-muted]">
                      {group.shots.length} {group.shots.length === 1 ? "shot" : "shots"}
                    </span>
                  </div>
                  {/* Shots in this scene */}
                  {group.shots.map((shot) => renderShotCard(shot))}
                </div>
              ))}

              {/* Ungrouped shots */}
              {sceneGroups.ungrouped.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 border-b pb-2 pt-4">
                    <h3 className="text-sm font-medium text-[--text-muted]">Other Shots</h3>
                  </div>
                  {sceneGroups.ungrouped.map((shot) => renderShotCard(shot))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {project.shots.map((shot) => renderShotCard(shot))}
            </div>
          );
        })()
      )}

      {openDrawerShotId && (
        <ShotDrawer
          shots={drawerShots}
          openShotId={openDrawerShotId}
          onClose={() => setOpenDrawerShotId(null)}
          onShotChange={(id) => setOpenDrawerShotId(id)}
          onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
          projectId={project.id}
          episodeId={currentEpisodeId}
          generationMode={generationMode}
          videoRatio={videoRatio}
          selectedVersionId={selectedVersionId}
          anyGenerating={anyGenerating}
        />
      )}

      <NewVersionDialog
        open={newVersionDialogOpen}
        onOpenChange={setNewVersionDialogOpen}
        onSubmit={async (_name) => {
          await handleGenerateShots();
        }}
        nextVersionNum={nextVersionNum}
        generating={generating}
      />

      <Dialog open={transitionDialogOpen} onOpenChange={setTransitionDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>转场推荐预览</DialogTitle>
            <DialogDescription>
              基于镜头方向、场景变化、动态特征分析的自动转场建议
            </DialogDescription>
          </DialogHeader>
          {!transitionPreview || transitionPreview.length === 0 ? (
            <p className="text-sm text-[--text-muted] py-4 text-center">暂无推荐数据</p>
          ) : (
            <div className="space-y-2">
              {transitionPreview.map((rec, i) => {
                const changedIn = rec.recommendedIn !== rec.currentIn;
                const changedOut = rec.recommendedOut !== rec.currentOut;
                return (
                  <div key={rec.shotId} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                    <span className="w-8 h-6 flex items-center justify-center rounded-md bg-[--surface] font-mono text-xs font-bold text-[--text-muted]">#{rec.sequence}</span>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[--text-muted] text-xs">入:</span>
                        <span className={changedIn ? "line-through text-[--text-muted]" : "text-emerald-600"}>{rec.currentIn}</span>
                        {changedIn && <><ArrowRightLeft className="h-3 w-3 text-primary" /><span className="text-primary font-medium">{rec.recommendedIn}</span></>}
                        <span className="text-[--text-muted] mx-1">&rarr;</span>
                        <span className="text-[--text-muted] text-xs">出:</span>
                        <span className={changedOut ? "line-through text-[--text-muted]" : "text-emerald-600"}>{rec.currentOut}</span>
                        {changedOut && <><ArrowRightLeft className="h-3 w-3 text-primary" /><span className="text-primary font-medium">{rec.recommendedOut}</span></>}
                      </div>
                      <p className="text-xs text-[--text-muted]">{rec.reason}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setTransitionDialogOpen(false)}>
              <X className="h-3.5 w-3.5 mr-1" /> 关闭
            </Button>
            <Button variant="default" size="sm" onClick={handleApplyTransitions} disabled={applyingTransitions || !transitionPreview || transitionPreview.length === 0}>
              {applyingTransitions ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
              应用全部推荐
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={diagnosticDialogOpen} onOpenChange={setDiagnosticDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>项目诊断</DialogTitle>
            <DialogDescription>镜头管线完整性与问题一览</DialogDescription>
          </DialogHeader>
          {diagnosticData && (
            <div className="space-y-4">
              {/* Summary grid */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "总数", value: diagnosticData.summary.totalShots, color: "" },
                  { label: "完成", value: diagnosticData.summary.completedShots, color: "text-emerald-600" },
                  { label: "失败", value: diagnosticData.summary.failedShots, color: "text-red-600" },
                  { label: "卡住", value: diagnosticData.summary.stuckShots, color: "text-amber-600" },
                  { label: "过期", value: diagnosticData.summary.staleShots, color: "text-amber-600" },
                  { label: "帧就绪", value: diagnosticData.summary.shotsWithAllPanels, color: "" },
                  { label: "提示词就绪", value: diagnosticData.summary.shotsWithVideoPrompt, color: "" },
                  { label: "视频就绪", value: diagnosticData.summary.readyForVideo, color: "" },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border p-2 text-center">
                    <div className={`text-lg font-bold tabular-nums ${item.color}`}>{item.value}</div>
                    <div className="text-[10px] text-[--text-muted]">{item.label}</div>
                  </div>
                ))}
              </div>

              {/* Completion bar */}
              <div>
                <div className="flex justify-between text-xs text-[--text-muted] mb-1">
                  <span>整体完成度</span>
                  <span>{diagnosticData.summary.completionPercent}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${diagnosticData.summary.completionPercent}%` }} />
                </div>
              </div>

              {/* Diagnostics */}
              {diagnosticData.diagnostics.length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-[--text-muted] uppercase tracking-wider">诊断</h4>
                  {diagnosticData.diagnostics.map((d, i) => {
                    const colors: Record<string, string> = { error: "border-red-200 bg-red-50 text-red-700", warning: "border-amber-200 bg-amber-50 text-amber-700", info: "border-blue-200 bg-blue-50 text-blue-700" };
                    return (
                      <div key={i} className={`rounded-lg border p-2.5 text-xs ${colors[d.severity] || "border-[--border-subtle]"}`}>
                        <div className="font-medium">{d.message}</div>
                        <div className="opacity-70 mt-0.5">{d.fix}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Per-shot breakdown */}
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-[--text-muted] uppercase tracking-wider">镜头状态</h4>
                <div className="grid grid-cols-1 gap-1 max-h-48 overflow-y-auto">
                  {diagnosticData.shots.map((s) => {
                    const statusColor = s.status === "completed" ? "border-emerald-200 bg-emerald-50" : s.status === "failed" ? "border-red-200 bg-red-50" : s.status === "generating" ? "border-amber-200 bg-amber-50" : "border-[--border-subtle]";
                    const missingStr = s.missingRequired.length > 0 ? s.missingRequired.join(", ") : "✓";
                    return (
                      <div key={s.id} className={`flex items-center gap-2 rounded border p-2 text-xs ${statusColor}`}>
                        <span className="font-mono font-bold w-8">#{s.sequence}</span>
                        <span className="flex-1 truncate text-[--text-muted]">{missingStr}</span>
                        {s.isStale && <span className="text-amber-600 font-medium">stale</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDiagnosticDialogOpen(false)}>
              <X className="h-3.5 w-3.5 mr-1" /> 关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CanvasView({ project }: { project: NonNullable<ReturnType<typeof useProjectStore.getState>["project"]> }) {
  const selectedShotId = useCanvasStore((s) => s.selectedShotId);
  return (
    <div className="relative flex h-[calc(100vh-220px)] overflow-hidden rounded-xl border">
      <div className="flex-1">
        <CanvasStoryboard shots={project.shots} />
      </div>
      <div className="w-80 flex-shrink-0">
        <AgentChat
          shot={(selectedShotId ? project.shots.find((s) => s.id === selectedShotId) : null) ?? null}
        />
      </div>
    </div>
  );
}
