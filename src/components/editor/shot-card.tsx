"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useModelStore } from "@/stores/model-store";
import {
  useProjectStore,
  type Shot,
  getFirstFrameUrl,
  getLastFrameUrl,
  getSceneRefFrameUrl,
  getKeyframeVideoUrl,
  getReferenceVideoUrl,
  getFirstFramePrompt,
  getLastFramePrompt,
  getPanelUrl,
  type ShotAsset,
} from "@/stores/project-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import {
  Loader2,
  ImageIcon,
  VideoIcon,
  MessageCircle,
  Clock,
  Sparkles,
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Circle,
  XCircle,
  Upload,
  Trash2,
  Plus,
} from "lucide-react";
import { AiOptimizeButton } from "./ai-optimize-button";
import { InlineModelPicker } from "./model-selector";
import { id as genId } from "@/lib/id";

// Local shape compatible with legacy rendering code, built from ShotAsset.
interface RefImage {
  id: string;
  type: "first_frame" | "last_frame" | "reference" | "video" | "ref_video" | "panel_1" | "panel_2" | "panel_3" | "panel_4";
  prompt: string;
  imagePath?: string;
  status: "pending" | "generated";
  characters?: string[];
  sceneName?: string;
  model?: { providerId: string; modelId: string };
  history?: string[];
  /** Parallel array to history: shot_assets row IDs for each historical version */
  historyIds?: string[];
}

function assetToRefImage(a: ShotAsset, allAssets: ShotAsset[] = []): RefImage {
  const typeMap: Record<ShotAsset["type"], RefImage["type"]> = {
    first_frame: "first_frame",
    last_frame: "last_frame",
    reference: "reference",
    keyframe_video: "video",
    reference_video: "ref_video",
    panel_1: "panel_1",
    panel_2: "panel_2",
    panel_3: "panel_3",
    panel_4: "panel_4",
  };
  // Build the version history from all sibling rows in the same slot,
  // sorted oldest → newest by assetVersion. Each entry has fileUrl + asset id
  // so the UI can call activate API by id.
  const siblings = allAssets
    .filter((x) => x.type === a.type && x.sequenceInType === a.sequenceInType)
    .sort((x, y) => x.assetVersion - y.assetVersion);
  const historyUrls = siblings.map((s) => s.fileUrl).filter((u): u is string => !!u);
  const historyIds = siblings.filter((s) => !!s.fileUrl).map((s) => s.id);
  return {
    id: a.id,
    type: typeMap[a.type],
    prompt: a.prompt ?? "",
    imagePath: a.fileUrl ?? undefined,
    status: a.status === "completed" && a.fileUrl ? "generated" : "pending",
    characters: a.characters ?? undefined,
    sceneName: a.meta?.sceneName,
    model: a.modelProvider && a.modelId ? { providerId: a.modelProvider, modelId: a.modelId } : undefined,
    history: historyUrls,
    historyIds,
  };
}

interface ShotCardProps {
  shot: Shot;
  projectId: string;
  episodeId?: string | null;
  onUpdate: () => void;
  generationMode?: "keyframe" | "reference" | "4grid";
  videoRatio?: string;
  isCompact?: boolean;
  onOpenDrawer?: (id: string) => void;
  batchGeneratingFrames?: boolean;
  batchGeneratingVideoPrompts?: boolean;
  batchGeneratingVideos?: boolean;
}

const TRANSITION_VALUES = ["cut", "dissolve", "fade_in", "fade_out", "wipeleft", "slideright", "circleopen"] as const;

type StepState = "done" | "generating" | "error" | "idle";

function StepIndicator({ state }: { state: StepState }) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />;
  if (state === "generating") return <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />;
  if (state === "error") return <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />;
  return <Circle className="h-4 w-4 text-[--text-muted] flex-shrink-0" />;
}

function StepRow({
  label,
  state,
  children,
  defaultOpen = false,
  isNext = false,
}: {
  label: string;
  state: StepState;
  children: React.ReactNode;
  defaultOpen?: boolean;
  isNext?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || isNext);

  useEffect(() => {
    if (isNext) setOpen(true);
  }, [isNext]);

  return (
    <div className={`rounded-xl border transition-colors ${
      isNext
        ? "border-primary/30 bg-primary/3"
        : state === "done"
          ? "border-emerald-100 bg-emerald-50/40"
          : state === "error"
            ? "border-destructive/20 bg-destructive/3"
            : "border-[--border-subtle] bg-[--surface]/50"
    }`}>
      <button
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <StepIndicator state={state} />
        <span className={`flex-1 text-[13px] font-medium ${
          isNext ? "text-primary" : state === "done" ? "text-emerald-700" : "text-[--text-secondary]"
        }`}>
          {label}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-[--text-muted]" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-[--text-muted]" />
        )}
      </button>
      {open && (
        <div className="border-t border-[--border-subtle] px-3 pb-3 pt-2.5">
          {children}
        </div>
      )}
    </div>
  );
}

export function ShotCard({
  shot,
  projectId,
  episodeId,
  onUpdate,
  generationMode = "keyframe",
  videoRatio = "16:9",
  isCompact = false,
  onOpenDrawer,
  batchGeneratingFrames = false,
  batchGeneratingVideoPrompts = false,
  batchGeneratingVideos = false,
}: ShotCardProps) {
  const id = shot.id;
  const sequence = shot.sequence;
  const prompt = shot.prompt;
  const videoScript = shot.videoScript;
  const motionScript = shot.motionScript;
  const cameraDirection = shot.cameraDirection;
  const duration = shot.duration;
  const videoPrompt = shot.videoPrompt;
  const transitionIn = shot.transitionIn;
  const transitionOut = shot.transitionOut;
  const compositionGuide = shot.compositionGuide;
  const focalPoint = shot.focalPoint;
  const depthOfField = shot.depthOfField;
  const soundDesign = shot.soundDesign;
  const musicCue = shot.musicCue;
  const isStale = shot.isStale;
  const dialogues = shot.dialogues ?? [];
  const firstFrame = getFirstFrameUrl(shot);
  const lastFrame = getLastFrameUrl(shot);
  const sceneRefFrame = getSceneRefFrameUrl(shot);
  const panel1 = getPanelUrl(shot, 1);
  const panel2 = getPanelUrl(shot, 2);
  const panel3 = getPanelUrl(shot, 3);
  const panel4 = getPanelUrl(shot, 4);
  const videoUrl = generationMode === "reference" ? getReferenceVideoUrl(shot) : getKeyframeVideoUrl(shot);
  const startFrameDesc = getFirstFramePrompt(shot);
  const endFrameDesc = getLastFramePrompt(shot);
  const status = generationMode === "reference"
    ? shot.status === "generating"
      ? "generating"
      : videoUrl ? "completed" : "pending"
    : shot.status;
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);

  // Edit state
  const [editPrompt, setEditPrompt] = useState(prompt);
  const [editStartFrame, setEditStartFrame] = useState(startFrameDesc ?? "");
  const [editEndFrame, setEditEndFrame] = useState(endFrameDesc ?? "");
  const [editMotionScript, setEditMotionScript] = useState(motionScript ?? "");
  const [editVideoPrompt, setEditVideoPrompt] = useState(videoPrompt ?? "");
  const [editCameraDirection, setEditCameraDirection] = useState(cameraDirection ?? "static");
  const [editDuration, setEditDuration] = useState(duration);

  useEffect(() => { setEditPrompt(prompt); }, [prompt]);
  useEffect(() => { setEditStartFrame(startFrameDesc ?? ""); }, [startFrameDesc]);
  useEffect(() => { setEditEndFrame(endFrameDesc ?? ""); }, [endFrameDesc]);
  useEffect(() => { setEditMotionScript(motionScript ?? ""); }, [motionScript]);
  useEffect(() => { setEditVideoPrompt(videoPrompt ?? ""); }, [videoPrompt]);
  useEffect(() => { setEditCameraDirection(cameraDirection ?? "static"); }, [cameraDirection]);
  useEffect(() => { setEditDuration(duration); }, [duration]);

  // Generation state
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingSceneFrame, setGeneratingSceneFrame] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [rewritingText, setRewritingText] = useState(false);

  // Project characters (reactive)
  const projectCharacters = useProjectStore((s) => s.project?.characters || []);

  // UI state
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadFieldRef = useRef<string | null>(null);

  const imageGuard = useModelGuard("image");
  const videoGuard = useModelGuard("video");

  // Build legacy-shape RefImage[] from the unified shot.assets[] (null-safe)
  // Build legacy-shape RefImage[] from the unified shot.assets[] (null-safe).
  // Only ACTIVE rows become entries; siblings (older versions) are folded
  // into history / historyIds for the version arrows.
  const allRefItems = useMemo(() => {
    const all = Array.isArray(shot.assets) ? shot.assets : [];
    return all
      .filter((a) => a.isActive === 1)
      .map((a) => assetToRefImage(a, all));
  }, [shot.assets]);
  const parsedRefImages = useMemo(() => allRefItems.filter((r) => r.type === "reference"), [allRefItems]);
  const firstFrameItem = useMemo(() => allRefItems.find((r) => r.type === "first_frame"), [allRefItems]);
  const lastFrameItem = useMemo(() => allRefItems.find((r) => r.type === "last_frame"), [allRefItems]);

  // Derived state
  const hasText = !!(prompt || startFrameDesc || motionScript);
  const hasFrame = generationMode === "4grid"
    ? !!(panel1 || panel2 || panel3 || panel4)
    : !!(sceneRefFrame || firstFrame || lastFrame);
  const hasFramePair = !!(firstFrame && lastFrame);
  const hasVideoPrompt = !!videoPrompt;
  const hasVideo = !!videoUrl;
  const hasRefImages = parsedRefImages.some((r) => r.status === "generated" && r.imagePath);
  const isGenerating = status === "generating";

  // Step states
  const textState: StepState = rewritingText ? "generating" : hasText ? "done" : "idle";
  const frameState: StepState =
    generatingFrames || generatingSceneFrame || batchGeneratingFrames ? "generating"
    : status === "failed" && !hasFrame ? "error"
    : hasFrame ? "done" : "idle";
  const promptState: StepState = generatingPrompt || batchGeneratingVideoPrompts ? "generating" : hasVideoPrompt ? "done" : "idle";
  const videoState: StepState =
    generatingVideo || batchGeneratingVideos || (isGenerating && !hasVideo) ? "generating"
    : status === "failed" && !hasVideo ? "error"
    : hasVideo ? "done" : "idle";

  // Which step is "next"
  const nextStep = !hasFrame ? "frame" : !hasVideoPrompt ? "prompt" : !hasVideo ? "video" : null;

  async function patchShot(fields: Record<string, unknown>) {
    await apiFetch(`/api/projects/${projectId}/shots/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  async function handleGenerateFrames() {
    if (!imageGuard()) return;
    setGeneratingFrames(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_frame_generate",
          payload: { shotId: id, ratio: videoRatio },
          modelConfig: getModelConfig(),
          episodeId,
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingFrames(false);
  }

  async function handleGenerateVideoPrompt() {
    setGeneratingPrompt(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_video_prompt",
          payload: { shotId: id },
          modelConfig: getModelConfig(),
          episodeId,
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingPrompt(false);
  }

  async function handleGenerateVideo() {
    if (!videoGuard()) return;
    setGeneratingVideo(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: generationMode === "reference" ? "single_reference_video" : "single_video_generate",
          payload: { shotId: id, ratio: videoRatio },
          modelConfig: getModelConfig(),
          episodeId,
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setGeneratingVideo(false);
  }

  async function handleRewriteText() {
    setRewritingText(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_shot_rewrite",
          payload: { shotId: id },
          modelConfig: getModelConfig(),
          episodeId,
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setRewritingText(false);
  }

  // ─── shot_assets sync helpers (PUT /shots/:id/assets) ─────
  // Convert legacy-shape RefImage[] back to ShotAsset patches and PUT them.
  function refImageToAssetPatch(r: RefImage) {
    const reverseTypeMap: Record<RefImage["type"], ShotAsset["type"] | null> = {
      first_frame: "first_frame",
      last_frame: "last_frame",
      reference: "reference",
      video: "keyframe_video",
      ref_video: "reference_video",
      panel_1: "panel_1",
      panel_2: "panel_2",
      panel_3: "panel_3",
      panel_4: "panel_4",
    };
    const type = reverseTypeMap[r.type];
    if (!type) return null;
    return {
      id: r.id,
      type,
      sequenceInType: 0, // default; reference items override below by index
      prompt: r.prompt,
      characters: r.characters ?? null,
      fileUrl: r.imagePath ?? null,
      status: r.status === "generated" ? "completed" : "pending",
    };
  }

  async function syncAssetsToBackend(items: RefImage[]) {
    // Group reference items so we can assign sequenceInType by array order
    const patches = items
      .map((r, idx) => {
        const p = refImageToAssetPatch(r);
        if (!p) return null;
        // For reference type, use position in filtered ref list as sequenceInType
        if (p.type === "reference") {
          const refIdx = items.filter((x) => x.type === "reference").indexOf(r);
          p.sequenceInType = refIdx >= 0 ? refIdx : idx;
        }
        return p;
      })
      .filter(Boolean);

    try {
      const resp = await apiFetch(`/api/projects/${projectId}/shots/${id}/assets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: patches }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save assets");
    }
  }

  async function handleClearFrame(field: string) {
    const FIELD_TO_TYPE: Record<string, ShotAsset["type"]> = {
      firstFrame: "first_frame",
      lastFrame: "last_frame",
      sceneRefFrame: "reference",
      panel1: "panel_1",
      panel2: "panel_2",
      panel3: "panel_3",
      panel4: "panel_4",
    };
    const targetType = FIELD_TO_TYPE[field];
    if (!targetType) return;
    const updated = allRefItems.filter(
      (r) => !(r.type === targetType && (field === "sceneRefFrame"
        ? r.id === allRefItems.find((x) => x.type === "reference")?.id
        : true))
    );
    await syncAssetsToBackend(updated);
  }

  async function saveRefImages(updatedRefItems: RefImage[]) {
    // Merge: keep first/last frame items as-is, replace reference items with the new list
    const nonRef = allRefItems.filter((r) => r.type !== "reference");
    const merged = [...nonRef, ...updatedRefItems.filter((r) => r.type === "reference")];
    await syncAssetsToBackend(merged);
  }

  async function saveAllItems(updated: RefImage[]) {
    await syncAssetsToBackend(updated);
  }

  /**
   * Activate a specific historical version of an asset (by shot_assets row ID).
   * The backend flips is_active flags and the next fetchProject pulls the new
   * active row.
   */
  async function activateAssetById(assetId: string) {
    try {
      const resp = await apiFetch(
        `/api/projects/${projectId}/shots/${id}/assets/${assetId}/activate`,
        { method: "POST" }
      );
      if (!resp.ok) throw new Error(await resp.text());
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to switch version");
    }
  }

  /**
   * Save the prompt text for first_frame, last_frame, or panel types.
   * If the asset row doesn't exist yet, create it via the sync endpoint.
   */
  async function saveKeyframePrompt(slot: RefImage["type"], prompt: string) {
    const existing = allRefItems.find((r) => r.type === slot);
    let updated: RefImage[];
    if (existing) {
      updated = allRefItems.map((r) =>
        r.id === existing.id ? { ...r, prompt } : r
      );
    } else {
      // Create a new pending entry for this slot
      updated = [
        ...allRefItems,
        {
          id: genId(),
          type: slot,
          prompt,
          status: "pending" as const,
        },
      ];
    }
    await syncAssetsToBackend(updated);
  }

  // Add empty ref image card
  function handleAddRefImage() {
    const updated = [...parsedRefImages, { id: genId(), type: "reference" as const, prompt: "", status: "pending" as const }];
    saveRefImages(updated);
  }

  // Remove a ref image
  function handleRemoveRefImage(refId: string) {
    const updated = parsedRefImages.filter((r) => r.id !== refId);
    saveRefImages(updated);
  }

  // ─── Pending-save coordinator ────────────────────────────
  // Each pending save is registered in a global ref. On unmount or
  // visibility change (tab switch / refresh), all pending closures are
  // flushed synchronously so no edit is lost.
  const pendingSavesRef = useRef<Map<string, () => Promise<void>>>(new Map());
  function registerPendingSave(key: string, runner: () => Promise<void>) {
    pendingSavesRef.current.set(key, runner);
  }
  function clearPendingSave(key: string) {
    pendingSavesRef.current.delete(key);
  }
  async function flushAllPendingSaves() {
    const tasks = Array.from(pendingSavesRef.current.values());
    pendingSavesRef.current.clear();
    await Promise.allSettled(tasks.map((t) => t()));
  }
  useEffect(() => {
    const handler = () => {
      // Fire-and-forget; browser may not wait for promises but at least
      // synchronous body of each runner gets a chance to fetch().
      flushAllPendingSaves();
    };
    window.addEventListener("beforeunload", handler);
    document.addEventListener("visibilitychange", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      document.removeEventListener("visibilitychange", handler);
      // Component unmount → flush whatever is queued
      flushAllPendingSaves();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced auto-save for keyframe (first/last frame) prompts
  const keyframeSaveTimerRef = useRef<{ first?: ReturnType<typeof setTimeout>; last?: ReturnType<typeof setTimeout> }>({});
  function scheduleKeyframeSave(slot: "first_frame" | "last_frame", prompt: string) {
    const key = slot;
    const timerKey = slot === "first_frame" ? "first" : "last";
    if (keyframeSaveTimerRef.current[timerKey]) {
      clearTimeout(keyframeSaveTimerRef.current[timerKey]);
    }
    const runner = async () => {
      clearPendingSave(key);
      await saveKeyframePrompt(slot, prompt);
    };
    registerPendingSave(key, runner);
    keyframeSaveTimerRef.current[timerKey] = setTimeout(runner, 500);
  }

  // Local state for ref image prompts (controlled inputs with debounced save)
  const [localRefPrompts, setLocalRefPrompts] = useState<Record<string, string>>({});
  const refPromptTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function getRefPromptValue(refId: string, defaultPrompt: string) {
    return localRefPrompts[refId] ?? defaultPrompt;
  }

  function handleRefPromptChange(refId: string, value: string) {
    setLocalRefPrompts((prev) => ({ ...prev, [refId]: value }));
    // Debounced save, registered with the unmount-flush coordinator
    if (refPromptTimerRef.current[refId]) clearTimeout(refPromptTimerRef.current[refId]);
    const key = `ref:${refId}`;
    const runner = async () => {
      clearPendingSave(key);
      const updated = parsedRefImages.map((r) => r.id === refId ? { ...r, prompt: value } : r);
      await saveRefImages(updated);
    };
    registerPendingSave(key, runner);
    refPromptTimerRef.current[refId] = setTimeout(runner, 500);
  }

  // Switch active version of a ref image — calls the backend activate endpoint
  // by id, then re-fetches. Ref id is the *currently active* asset row id.
  async function handleSwitchRefImageVersion(refId: string, direction: "prev" | "next") {
    const ref = parsedRefImages.find((r) => r.id === refId);
    if (!ref || !ref.historyIds || ref.historyIds.length < 2) return;
    const currentIdx = ref.historyIds.indexOf(refId);
    if (currentIdx < 0) return;
    const nextIdx = direction === "next"
      ? (currentIdx + 1) % ref.historyIds.length
      : (currentIdx - 1 + ref.historyIds.length) % ref.historyIds.length;
    const targetId = ref.historyIds[nextIdx];
    await activateAssetById(targetId);
  }

  // Update a ref image's prompt (immediate save, e.g. on blur)
  function handleUpdateRefPrompt(refId: string, prompt: string) {
    if (refPromptTimerRef.current[refId]) clearTimeout(refPromptTimerRef.current[refId]);
    const updated = parsedRefImages.map((r) => r.id === refId ? { ...r, prompt } : r);
    saveRefImages(updated);
  }

  // Per-ref-image loading state
  const [regeneratingRefIds, setRegeneratingRefIds] = useState<Set<string>>(new Set());

  // Resolve a model ref to a full provider config (for per-card model override)
  function resolvePerCardImageRef(modelRef?: { providerId: string; modelId: string }) {
    if (!modelRef) return null;
    const providers = useModelStore.getState().providers;
    const provider = providers.find((p) => p.id === modelRef.providerId);
    if (!provider) return null;
    return {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      secretKey: provider.secretKey,
      modelId: modelRef.modelId,
    };
  }

  // Regenerate a single ref image
  async function handleRegenerateRefImage(refId: string) {
    if (!imageGuard()) return;

    // Mark as loading
    setRegeneratingRefIds((prev) => new Set(prev).add(refId));

    try {
      // Get per-card model (if set) or fall back to global
      const ref = parsedRefImages.find((r) => r.id === refId);
      const baseConfig = getModelConfig();
      const perCardImage = resolvePerCardImageRef(ref?.model);
      const modelConfig = perCardImage
        ? { ...baseConfig, image: perCardImage }
        : baseConfig;

      const resp = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_ref_image_generate",
          payload: { shotId: id, refImageId: refId, ratio: videoRatio },
          modelConfig,
          episodeId,
        }),
      });
      if (!resp.ok) throw new Error("Failed");
      onUpdate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg.includes("余额") || msg.includes("quota") || msg.includes("insufficient") ? msg : t("common.generationFailed"));
    } finally {
      setRegeneratingRefIds((prev) => {
        const next = new Set(prev);
        next.delete(refId);
        return next;
      });
    }
  }

  async function handleBatchGenerateRefImagesForShot() {
    if (!imageGuard()) return;
    setGeneratingSceneFrame(true);
    try {
      const resp = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_ref_image_generate_all",
          payload: { shotId: id, ratio: videoRatio },
          modelConfig: getModelConfig(),
          episodeId,
        }),
      });
      if (!resp.ok) throw new Error("Failed");
      onUpdate();
      toast.success(t("common.generationCompleted"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg.includes("余额") || msg.includes("quota") || msg.includes("insufficient") ? msg : t("common.generationFailed"));
    }
    setGeneratingSceneFrame(false);
  }

  function handleUploadFrame(field: string) {
    uploadFieldRef.current = field;
    uploadInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const field = uploadFieldRef.current;
    if (!file || !field) return;
    e.target.value = "";
    setUploadingField(field);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("field", field);
      const res = await apiFetch(`/api/projects/${projectId}/shots/${id}/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error("Upload failed");
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    setUploadingField(null);
  }

  function handleCopyPrompt() {
    const text = videoPrompt || `${videoScript || motionScript || prompt}\nCamera: ${cameraDirection}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const frameAssets = generationMode === "4grid"
    ? [
        { src: panel1, label: "PANEL 1", type: "image" as const, panelIdx: 0, field: "panel1" as const },
        { src: panel2, label: "PANEL 2", type: "image" as const, panelIdx: 1, field: "panel2" as const },
        { src: panel3, label: "PANEL 3", type: "image" as const, panelIdx: 2, field: "panel3" as const },
        { src: panel4, label: "PANEL 4", type: "image" as const, panelIdx: 3, field: "panel4" as const },
      ]
    : generationMode === "reference"
    ? [{ src: sceneRefFrame, label: t("shot.sceneRefFrame"), type: "image" as const, panelIdx: 0, field: "sceneRefFrame" as const }]
    : [
        { src: firstFrame, label: t("shot.firstFrame"), type: "image" as const, panelIdx: 0, field: "firstFrame" as const },
        { src: lastFrame, label: t("shot.lastFrame"), type: "image" as const, panelIdx: 1, field: "lastFrame" as const },
      ];

  if (isCompact) {
    return (
      <div
        className="flex items-center gap-3 rounded-xl border border-[--border-subtle] bg-white px-3 py-2 cursor-pointer hover:border-primary/30 hover:bg-primary/2 transition-colors"
        onClick={() => onOpenDrawer?.(id)}
      >
        {/* Sequence */}
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/8 font-mono text-xs font-bold text-primary">
          {sequence}
        </div>
        {/* Thumbnails */}
        <div className="flex gap-1">
          {(() => {
            const thumbs = generationMode === "4grid"
              ? [panel1, panel2, panel3, panel4]
              : generationMode === "reference"
                ? [sceneRefFrame, videoUrl]
                : [firstFrame, lastFrame, videoUrl];
            const vidIdx = generationMode === "reference" ? 1 : (generationMode === "4grid" ? -1 : 2);
            return thumbs.map((src, i) => {
              const isVid = i === vidIdx;
            return (
              <div key={i} className="h-8 w-11 flex-shrink-0 overflow-hidden rounded-md border border-[--border-subtle] bg-[--surface]">
                {src ? (
                  isVid
                    ? <video className="h-full w-full object-cover" src={uploadUrl(src)} />
                    : <img src={uploadUrl(src)} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    {isVid
                      ? <VideoIcon className="h-3 w-3 text-[--text-muted]" />
                      : <ImageIcon className="h-3 w-3 text-[--text-muted]" />
                    }
                  </div>
                )}
              </div>
            );
            });
          })()}
        </div>
        {/* Scene text */}
        <p className="flex-1 truncate text-xs text-[--text-secondary]">{prompt}</p>
        {/* Progress dots */}
        <div className="flex items-center gap-1">
          {[hasText, hasFrame, hasVideoPrompt, hasVideo].map((done, i) => (
            <div key={i} className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-400" : "bg-[--border-subtle]"}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[--border-subtle] bg-white transition-colors hover:border-[--border-hover]">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Sequence */}
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/8 font-mono text-sm font-bold text-primary cursor-pointer hover:bg-primary/15 transition-colors"
          onClick={() => onOpenDrawer?.(id)}
          title="Open editor"
        >
          {sequence}
        </div>

        {/* Media thumbnails */}
        <div className="flex gap-1.5">
          {(generationMode === "4grid"
            ? [panel1, panel2, panel3, panel4]
            : generationMode === "reference"
              ? [sceneRefFrame, videoUrl]
              : [firstFrame, lastFrame, videoUrl]
          ).map((src, i) => {
            const total = generationMode === "4grid" ? 4 : (generationMode === "reference" ? 2 : 3);
            const isVideo = i === total - 1 && generationMode !== "4grid";
            return (
              <div
                key={i}
                className={`h-12 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-[--border-subtle] ${src ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
                onClick={() => src && setPreviewSrc(uploadUrl(src))}
              >
                {src ? (
                  isVideo ? (
                    <video className="h-full w-full object-cover" src={uploadUrl(src)} />
                  ) : (
                    <img src={uploadUrl(src)} className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[--surface]">
                    {isVideo
                      ? <VideoIcon className="h-3.5 w-3.5 text-[--text-muted]" />
                      : <ImageIcon className="h-3.5 w-3.5 text-[--text-muted]" />
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Scene summary + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm text-[--text-primary]">{prompt}</p>
            {isStale ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 flex-shrink-0">
                {t("storyboard.stale")}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-2">
            {/* Duration */}
            <span className="flex items-center gap-1 text-xs text-[--text-muted]">
              <Clock className="h-3 w-3" />
              <input
                type="number"
                min={5}
                max={15}
                value={editDuration}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = Math.min(15, Math.max(5, Number(e.target.value)));
                  setEditDuration(v);
                  patchShot({ duration: v });
                }}
                className="w-9 rounded border border-[--border-subtle] bg-white px-1 py-0.5 text-center text-[11px] font-medium text-[--text-primary] outline-none focus:border-primary/50"
              />
              <span className="text-[11px]">s</span>
            </span>
            {dialogues.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-[--text-muted]">
                <MessageCircle className="h-3 w-3" />
                {dialogues.length}
              </span>
            )}
            {/* Pipeline progress dots */}
            <div className="flex items-center gap-1 ml-1">
              {[hasText, hasFrame, hasVideoPrompt, hasVideo].map((done, i) => (
                <div key={i} className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-400" : "bg-[--border-subtle]"}`} />
              ))}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[--text-muted] shrink-0">{t("shot.transition")}:</span>
              <select
                value={transitionIn || "cut"}
                onChange={(e) => { patchShot({ transitionIn: e.target.value }); onUpdate(); }}
                onClick={(e) => e.stopPropagation()}
                className="h-7 rounded border border-[--border-subtle] bg-white px-2 text-xs outline-none focus:border-primary/50"
              >
                {TRANSITION_VALUES.map((v) => (
                  <option key={v} value={v}>{t(`shot.trans_${v}`)}</option>
                ))}
              </select>
              <span className="text-[--text-muted]">&rarr;</span>
              <select
                value={transitionOut || "cut"}
                onChange={(e) => { patchShot({ transitionOut: e.target.value }); onUpdate(); }}
                onClick={(e) => e.stopPropagation()}
                className="h-7 rounded border border-[--border-subtle] bg-white px-2 text-xs outline-none focus:border-primary/50"
              >
                {TRANSITION_VALUES.map((v) => (
                  <option key={v} value={v}>{t(`shot.trans_${v}`)}</option>
                ))}
              </select>
            </div>
            {compositionGuide && (
              <span className="text-xs text-[--text-muted]">
                {compositionGuide.replace(/_/g, " ")}
              </span>
            )}
            {focalPoint && (
              <span className="text-xs text-[--text-muted]">
                {t("shot.focus")}: {focalPoint}
              </span>
            )}
            {depthOfField && depthOfField !== "medium" && (
              <span className="text-xs text-[--text-muted]">
                {t("shot.dof")}: {depthOfField}
              </span>
            )}
          </div>
          {(soundDesign || musicCue) && (
            <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-[--text-muted]">
              {soundDesign && <span>{t("shot.sfx")}: {soundDesign}</span>}
              {musicCue && <span>{t("shot.music")}: {musicCue}</span>}
            </div>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopyPrompt}
            title={t("shot.copyPrompt")}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* ── Pipeline Steps ── */}
      <div className="space-y-2 border-t border-[--border-subtle] px-4 pb-3 pt-3">

        {/* Step 1: 分镜描述 */}
        <StepRow
          label={t("shot.stepDesc")}
          state={textState}
          defaultOpen={false}
        >
          {generationMode === "4grid" ? (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                {([
                  { key: "start", label: "PANEL 1（开场）", value: editStartFrame, setter: setEditStartFrame, dbField: "startFrameDesc", panelType: "panel_1" as const },
                  { key: "prompt", label: "PANEL 2（发展）", value: editPrompt, setter: setEditPrompt, dbField: "prompt", panelType: null },
                  { key: "motion", label: "PANEL 3（转折）", value: editMotionScript, setter: setEditMotionScript, dbField: "motionScript", panelType: null },
                  { key: "end", label: "PANEL 4（收束）", value: editEndFrame, setter: setEditEndFrame, dbField: "endFrameDesc", panelType: "panel_4" as const },
                ] as const).map((panel) => {
                  const save = (v: string) => {
                    panel.setter(v);
                    if (panel.panelType) {
                      saveKeyframePrompt(panel.panelType, v);
                    } else {
                      patchShot({ [panel.dbField]: v });
                    }
                  };
                  return (
                  <div key={panel.key}>
                    <div className="mb-1 flex items-center gap-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-600">{panel.label}</p>
                      <AiOptimizeButton
                        value={panel.value}
                        onOptimized={(v) => save(v)}
                        fieldLabel={panel.dbField}
                        projectId={projectId}
                      />
                    </div>
                    <Textarea
                      value={panel.value}
                      onChange={(e) => panel.setter(e.target.value)}
                      onBlur={() => save(panel.value)}
                      rows={2}
                    />
                  </div>
                  );
                })}
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.cameraDirection")}</p>
                <input
                  value={editCameraDirection}
                  onChange={(e) => setEditCameraDirection(e.target.value)}
                  onBlur={() => patchShot({ cameraDirection: editCameraDirection })}
                  className="w-full rounded-xl border border-[--border-subtle] bg-white px-3 py-2 text-sm outline-none focus:border-primary/50"
                  placeholder="static / pan-left / zoom-in ..."
                />
              </div>
            </div>
          ) : (
          <div className="space-y-2.5">
            <div>
              <div className="mb-1 flex items-center gap-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.sceneDescription")}</p>
                <AiOptimizeButton
                  value={editPrompt}
                  onOptimized={(v) => { setEditPrompt(v); patchShot({ prompt: v }); }}
                  fieldLabel="sceneDescription"
                  projectId={projectId}
                />
              </div>
              <Textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                onBlur={() => patchShot({ prompt: editPrompt })}
                rows={2}
                placeholder={t("shot.prompt")}
              />
            </div>
            {/* Frame prompts moved to Step 2 (below images) */}
            <div>
              <div className="mb-1 flex items-center gap-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-600">{t("shot.motionScript")}</p>
                <AiOptimizeButton
                  value={editMotionScript}
                  onOptimized={(v) => { setEditMotionScript(v); patchShot({ motionScript: v }); }}
                  fieldLabel="motionScript"
                  projectId={projectId}
                />
              </div>
              <Textarea
                value={editMotionScript}
                onChange={(e) => setEditMotionScript(e.target.value)}
                onBlur={() => patchShot({ motionScript: editMotionScript })}
                rows={2}
                placeholder={t("shot.motionScript")}
                className="border-emerald-200 bg-emerald-50/30 text-sm"
              />
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[--text-muted]">{t("shot.cameraDirection")}</p>
              <input
                value={editCameraDirection}
                onChange={(e) => setEditCameraDirection(e.target.value)}
                onBlur={() => patchShot({ cameraDirection: editCameraDirection })}
                className="w-full rounded-xl border border-[--border-subtle] bg-white px-3 py-2 text-sm outline-none focus:border-primary/50"
                placeholder="static / pan-left / zoom-in ..."
              />
            </div>
            <Button
              size="xs"
              variant="outline"
              onClick={handleRewriteText}
              disabled={rewritingText}
            >
              {rewritingText ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {rewritingText ? t("common.generating") : t("shot.rewriteText")}
            </Button>
          </div>
          )}
        </StepRow>

        {/* Step 2: 帧 */}
        <StepRow
          label={generationMode === "reference" ? t("shot.stepSceneFrame") : generationMode === "4grid" ? "四宫格分镜帧" : t("shot.stepFrames")}
          state={frameState}
          isNext={nextStep === "frame"}
        >
          {/* Frame thumbnails */}
          {generationMode === "reference" ? (
            <div className="mb-2.5 space-y-2">
              {parsedRefImages.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                  {parsedRefImages.map((ref, refIdx) => (
                    <div key={ref.id} className="rounded-lg border border-[--border-subtle] bg-white overflow-hidden">
                      {/* Image or placeholder */}
                      <div className={`relative bg-[--surface] ${ref.imagePath ? "aspect-video" : "h-20"}`}>
                        {ref.imagePath ? (
                          <img
                            src={uploadUrl(ref.imagePath)}
                            className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => setPreviewSrc(uploadUrl(ref.imagePath!))}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <ImageIcon className="h-5 w-5 text-[--text-muted]" />
                          </div>
                        )}
                        {/* History navigation arrows */}
                        {(() => {
                          const history = ref.history || (ref.imagePath ? [ref.imagePath] : []);
                          if (history.length < 2) return null;
                          const currentIdx = ref.imagePath ? history.indexOf(ref.imagePath) : -1;
                          return (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSwitchRefImageVersion(ref.id, "prev"); }}
                                className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70 transition-colors"
                              >
                                <ChevronLeft className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSwitchRefImageVersion(ref.id, "next"); }}
                                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70 transition-colors"
                              >
                                <ChevronRight className="h-3 w-3" />
                              </button>
                              <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/50 px-1.5 py-0.5 text-[9px] text-white">
                                {currentIdx + 1}/{history.length}
                              </span>
                            </>
                          );
                        })()}
                        {/* Loading overlay during regeneration */}
                        {regeneratingRefIds.has(ref.id) && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm">
                            <Loader2 className="h-5 w-5 animate-spin text-white" />
                          </div>
                        )}
                      </div>
                      {/* Scene name badge — always rendered, falls back to "场景 N" */}
                      <div className="border-t border-[--border-subtle] px-2 py-1 bg-primary/5">
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          {ref.sceneName || `${t("shot.scene")} ${refIdx + 1}`}
                        </span>
                      </div>
                      {/* Editable prompt with auto-save */}
                      <div className="border-t border-[--border-subtle]">
                        <div className="flex items-center gap-1 px-2 pt-1">
                          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-violet-500">{t("shot.refImagePrompt")}</p>
                          <AiOptimizeButton
                            value={getRefPromptValue(ref.id, ref.prompt)}
                            onOptimized={(v) => {
                              setLocalRefPrompts((prev) => ({ ...prev, [ref.id]: v }));
                              handleUpdateRefPrompt(ref.id, v);
                            }}
                            fieldLabel="refImagePrompt"
                            projectId={projectId}
                            images={ref.imagePath ? [ref.imagePath] : undefined}
                          />
                        </div>
                        <textarea
                          value={getRefPromptValue(ref.id, ref.prompt)}
                          onChange={(e) => handleRefPromptChange(ref.id, e.target.value)}
                          onBlur={(e) => handleUpdateRefPrompt(ref.id, e.target.value)}
                          placeholder={t("shot.refImagePrompt")}
                          rows={6}
                          className="w-full resize-none border-0 bg-transparent px-2 py-1 text-[10px] leading-snug text-[--text-secondary] placeholder:text-[--text-muted] focus:outline-none"
                        />
                      </div>
                      {/* Character tags */}
                      <div className="flex items-center gap-1 flex-wrap border-t border-[--border-subtle] px-2 py-1.5">
                        <span className="text-[9px] text-[--text-muted] shrink-0">{t("shot.refChars") || "Chars"}:</span>
                        {projectCharacters.map((char) => {
                          const isSelected = ref.characters?.includes(char.name);
                          return (
                            <button
                              key={char.id}
                              onClick={() => {
                                const currentChars = ref.characters || [];
                                const newChars = isSelected
                                  ? currentChars.filter((n) => n !== char.name)
                                  : [...currentChars, char.name];
                                const updated = parsedRefImages.map((r) =>
                                  r.id === ref.id ? { ...r, characters: newChars } : r
                                );
                                saveRefImages(updated);
                              }}
                              className={`rounded-full px-1.5 py-0.5 text-[9px] transition-colors ${
                                isSelected
                                  ? "bg-primary/10 text-primary border border-primary/30"
                                  : "bg-[--bg-muted] text-[--text-muted] border border-transparent hover:border-[--border-subtle]"
                              }`}
                            >
                              {char.name}
                            </button>
                          );
                        })}
                      </div>
                      {/* Action bar */}
                      <div className="flex items-center gap-1 border-t border-[--border-subtle] px-1.5 py-1">
                        <InlineModelPicker
                          capability="image"
                          value={ref.model || null}
                          onChange={(modelRef) => {
                            const updated = parsedRefImages.map((r) =>
                              r.id === ref.id ? { ...r, model: modelRef } : r
                            );
                            saveRefImages(updated);
                          }}
                        />
                        <div className="flex-1" />
                        <button
                          onClick={() => handleRegenerateRefImage(ref.id)}
                          disabled={!ref.prompt?.trim() || regeneratingRefIds.has(ref.id)}
                          className="flex items-center rounded px-1.5 py-0.5 text-[10px] text-[--text-muted] hover:bg-[--bg-muted] hover:text-primary disabled:opacity-30 transition-colors"
                        >
                          {regeneratingRefIds.has(ref.id) ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-2.5 w-2.5" />
                          )}
                        </button>
                        <button
                          onClick={() => handleRemoveRefImage(ref.id)}
                          className="flex items-center rounded px-1.5 py-0.5 text-[10px] text-[--text-muted] hover:bg-red-50 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-[--border-subtle] p-4 text-xs text-[--text-muted]">
                  {t("shot.noRefImages") || "No reference image prompts yet"}
                </div>
              )}

              {/* Add ref image button */}
              {parsedRefImages.length < 9 && (
                <button
                  onClick={handleAddRefImage}
                  className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[--border-subtle] py-2 text-xs text-[--text-muted] hover:border-primary/40 hover:text-primary transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  {t("shot.addRefImage")}
                </button>
              )}
            </div>
          ) : generationMode === "4grid" ? (
            <div className="mb-2.5 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {frameAssets.map((asset, i) => {
                  const panelLabels = ["PANEL 1（开场）", "PANEL 2（发展）", "PANEL 3（转折）", "PANEL 4（收束）"];
                  const fieldName = asset.field;
                  const isUploading = uploadingField === fieldName;
                  return (
                    <div key={i} className="rounded-lg border border-[--border-subtle] bg-white overflow-hidden">
                      <div
                        className={`relative bg-[--surface] ${asset.src ? "aspect-video" : "h-16"} ${asset.src && !isUploading ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
                        onClick={() => asset.src && !isUploading && setPreviewSrc(uploadUrl(asset.src))}
                      >
                        {isUploading ? (
                          <div className="flex h-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
                        ) : asset.src ? (
                          <img src={uploadUrl(asset.src)} className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center"><ImageIcon className="h-5 w-5 text-[--text-muted]" /></div>
                        )}
                      </div>
                      <div className="border-t border-[--border-subtle] px-2 py-1 bg-emerald-50 flex items-center gap-1">
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          {panelLabels[i]}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 border-t border-[--border-subtle] px-1.5 py-1">
                        <button
                          onClick={() => handleUploadFrame(fieldName)}
                          disabled={isUploading}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[--text-muted] hover:bg-[--bg-muted] hover:text-primary disabled:opacity-40 transition-colors"
                        >
                          <Upload className="h-2.5 w-2.5" />
                          {t("common.upload")}
                        </button>
                        <div className="flex-1" />
                        {asset.src && (
                          <button
                            onClick={() => handleClearFrame(fieldName)}
                            className="flex items-center rounded px-1.5 py-0.5 text-[10px] text-[--text-muted] hover:bg-red-50 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mb-2.5 space-y-2">
              {(() => {
                // Empty state: show when there is no actual content for either frame.
                // "Content" = prompt text OR generated image (file URL or local edit).
                const hasFirstPrompt = !!firstFrameItem?.prompt || !!editStartFrame;
                const hasLastPrompt = !!lastFrameItem?.prompt || !!editEndFrame;
                const hasFrameImage = !!firstFrame || !!lastFrame;
                return !hasFirstPrompt && !hasLastPrompt && !hasFrameImage;
              })() ? (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-[--border-subtle] p-4 text-xs text-[--text-muted]">
                  {t("shot.noKeyframes") || "暂无首尾帧提示词"}
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-2">
              {frameAssets.map((asset, i) => {
                const fieldName = (i === 0 ? "firstFrame" : "lastFrame") as "firstFrame" | "lastFrame";
                const isUploading = uploadingField === fieldName;
                const isStart = i === 0;
                const editValue = isStart ? editStartFrame : editEndFrame;
                const setEditValue = isStart ? setEditStartFrame : setEditEndFrame;
                const dbField = isStart ? "startFrameDesc" : "endFrameDesc";
                const label = isStart ? t("shot.startFrame") : t("shot.endFrame");

                const frameItem = isStart ? firstFrameItem : lastFrameItem;
                const frameHistoryIds = frameItem?.historyIds || [];
                const frameCurrentIdx = frameItem ? frameHistoryIds.indexOf(frameItem.id) : -1;
                return (
                  <div key={i} className="rounded-lg border border-[--border-subtle] bg-white overflow-hidden">
                    {/* Image */}
                    <div
                      className={`relative bg-[--surface] ${asset.src ? "aspect-video" : "h-16"} ${asset.src && !isUploading ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
                      onClick={() => asset.src && !isUploading && setPreviewSrc(uploadUrl(asset.src))}
                    >
                      {isUploading ? (
                        <div className="flex h-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
                      ) : asset.src ? (
                        <img src={uploadUrl(asset.src)} className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center"><ImageIcon className="h-5 w-5 text-[--text-muted]" /></div>
                      )}
                      {/* History arrows */}
                      {frameHistoryIds.length > 1 && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = (frameCurrentIdx - 1 + frameHistoryIds.length) % frameHistoryIds.length;
                              activateAssetById(frameHistoryIds[next]);
                            }}
                            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
                          >
                            <ChevronLeft className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = (frameCurrentIdx + 1) % frameHistoryIds.length;
                              activateAssetById(frameHistoryIds[next]);
                            }}
                            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
                          >
                            <ChevronRight className="h-3 w-3" />
                          </button>
                          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/50 px-1.5 py-0.5 text-[9px] text-white">
                            {frameCurrentIdx + 1}/{frameHistoryIds.length}
                          </span>
                        </>
                      )}
                    </div>
                    {/* Frame label badge (matches scene-name badge aesthetic) */}
                    <div className="border-t border-[--border-subtle] px-2 py-1 bg-primary/5 flex items-center gap-1">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {label}
                      </span>
                      <div className="ml-auto">
                        <AiOptimizeButton
                          value={editValue}
                          onOptimized={(v) => { setEditValue(v); saveKeyframePrompt(isStart ? "first_frame" : "last_frame", v); }}
                          fieldLabel={dbField}
                          projectId={projectId}
                          images={asset.src ? [asset.src] : undefined}
                        />
                      </div>
                    </div>
                    {/* Prompt textarea */}
                    <div className="border-t border-[--border-subtle]">
                      <textarea
                        value={editValue}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditValue(v);
                          scheduleKeyframeSave(isStart ? "first_frame" : "last_frame", v);
                        }}
                        onBlur={() => saveKeyframePrompt(isStart ? "first_frame" : "last_frame", editValue)}
                        placeholder={label}
                        rows={6}
                        className="w-full resize-none border-0 bg-transparent px-2 py-1 text-[10px] leading-snug text-[--text-secondary] placeholder:text-[--text-muted] focus:outline-none"
                      />
                    </div>
                    {/* Character tags — read from first_frame/last_frame item */}
                    {(() => {
                      const frameItem = isStart ? firstFrameItem : lastFrameItem;
                      const currentChars = frameItem?.characters || [];
                      return (
                        <div className="flex items-center gap-1 flex-wrap border-t border-[--border-subtle] px-2 py-1.5">
                          <span className="text-[9px] text-[--text-muted] shrink-0">{t("shot.refChars")}:</span>
                          {projectCharacters.map((char) => {
                            const isSelected = currentChars.includes(char.name);
                            return (
                              <button
                                key={char.id}
                                onClick={() => {
                                  if (!frameItem) return;
                                  const newChars = isSelected
                                    ? currentChars.filter((n) => n !== char.name)
                                    : [...currentChars, char.name];
                                  const updated = allRefItems.map((r) =>
                                    r.id === frameItem.id ? { ...r, characters: newChars } : r
                                  );
                                  saveAllItems(updated);
                                }}
                                className={`rounded-full px-1.5 py-0.5 text-[9px] transition-colors ${
                                  isSelected
                                    ? "bg-primary/10 text-primary border border-primary/30"
                                    : "bg-[--bg-muted] text-[--text-muted] border border-transparent hover:border-[--border-subtle]"
                                }`}
                              >
                                {char.name}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                    {/* Action bar */}
                    <div className="flex items-center gap-1 border-t border-[--border-subtle] px-1.5 py-1">
                      <button
                        onClick={() => handleUploadFrame(fieldName)}
                        disabled={isUploading}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[--text-muted] hover:bg-[--bg-muted] hover:text-primary disabled:opacity-40 transition-colors"
                      >
                        <Upload className="h-2.5 w-2.5" />
                        {t("common.upload")}
                      </button>
                      <div className="flex-1" />
                      {asset.src && (
                        <button
                          onClick={() => handleClearFrame(fieldName)}
                          className="flex items-center rounded px-1.5 py-0.5 text-[10px] text-[--text-muted] hover:bg-red-50 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
              )}
            </div>
          )}
          <Button
            size="xs"
            variant={nextStep === "frame" ? "default" : "outline"}
            onClick={generationMode === "reference" ? handleBatchGenerateRefImagesForShot : handleGenerateFrames}
            disabled={generatingFrames || generatingSceneFrame || generatingVideo || batchGeneratingFrames}
          >
            {(generatingFrames || generatingSceneFrame || batchGeneratingFrames)
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <ImageIcon className="h-3 w-3" />
            }
            {(generatingFrames || generatingSceneFrame || batchGeneratingFrames)
              ? t("common.generating")
              : generationMode === "reference"
                ? (hasRefImages ? t("shot.regenerateRefImages") : t("shot.generateRefImages"))
                : generationMode === "4grid"
                  ? (hasFrame ? "重新生成四宫格帧" : "生成四宫格帧")
                  : hasFrame ? t("shot.regenerateFrames") : t("project.generateFrames")
            }
          </Button>
        </StepRow>

        {/* Step 3: 视频提示词 */}
        <StepRow
          label={generationMode === "4grid" ? "四宫格视频提示词" : t("shot.stepVideoPrompt")}
          state={promptState}
          isNext={nextStep === "prompt"}
        >
          {hasVideoPrompt && (
            <div className="mb-2">
              <div className="mb-1 flex items-center gap-1">
                <AiOptimizeButton
                  value={editVideoPrompt}
                  onOptimized={(v) => { setEditVideoPrompt(v); patchShot({ videoPrompt: v }); }}
                  fieldLabel="videoPrompt"
                  projectId={projectId}
                />
              </div>
              <Textarea
                value={editVideoPrompt}
                onChange={(e) => setEditVideoPrompt(e.target.value)}
                onBlur={() => patchShot({ videoPrompt: editVideoPrompt })}
                className="min-h-[5rem] resize-none font-mono text-xs leading-relaxed"
              />
            </div>
          )}
          <Button
            size="xs"
            variant={nextStep === "prompt" ? "default" : "outline"}
            onClick={handleGenerateVideoPrompt}
            disabled={generatingPrompt || batchGeneratingVideoPrompts || !hasFrame}
          >
            {(generatingPrompt || batchGeneratingVideoPrompts) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {(generatingPrompt || batchGeneratingVideoPrompts)
              ? t("common.generating")
              : hasVideoPrompt ? t("shot.regeneratePrompt") : t("shot.generateVideoPrompt")
            }
          </Button>
        </StepRow>

        {/* Step 4: 视频 */}
        <StepRow
          label={generationMode === "4grid" ? "四宫格合成视频" : t("shot.stepVideo")}
          state={videoState}
          isNext={nextStep === "video"}
        >
          {hasVideo && (() => {
            const videoTypeKey = generationMode === "reference" ? "ref_video" : "video";
            const videoItem = allRefItems.find((r) => r.type === videoTypeKey);
            const videoHistoryIds = videoItem?.historyIds || [];
            const videoCurrentIdx = videoItem ? videoHistoryIds.indexOf(videoItem.id) : -1;
            return (
              <div
                className="group relative mb-2.5 w-full overflow-hidden rounded-xl border border-[--border-subtle] bg-black cursor-pointer"
                style={{ aspectRatio: "16/9" }}
                onClick={() => setPreviewSrc(uploadUrl(videoUrl!))}
              >
                <video className="h-full w-full object-contain" src={uploadUrl(videoUrl!)} />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-lg">
                    <VideoIcon className="h-4 w-4 text-[--text-primary] translate-x-0.5" />
                  </div>
                </div>
                {/* History navigation arrows */}
                {videoHistoryIds.length > 1 && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = (videoCurrentIdx - 1 + videoHistoryIds.length) % videoHistoryIds.length;
                        activateAssetById(videoHistoryIds[next]);
                      }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = (videoCurrentIdx + 1) % videoHistoryIds.length;
                        activateAssetById(videoHistoryIds[next]);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white">
                      {videoCurrentIdx + 1}/{videoHistoryIds.length}
                    </span>
                  </>
                )}
              </div>
            );
          })()}
          <Button
            size="xs"
            variant={nextStep === "video" ? "default" : "outline"}
            onClick={handleGenerateVideo}
            disabled={generatingVideo || batchGeneratingVideos || (generationMode === "keyframe" && !hasFramePair)}
          >
            {(generatingVideo || batchGeneratingVideos || (isGenerating && !hasVideo))
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <VideoIcon className="h-3 w-3" />
            }
            {(generatingVideo || batchGeneratingVideos || (isGenerating && !hasVideo))
              ? t("common.generating")
              : hasVideo ? t("shot.regenerateVideo") : t("project.generateVideo")
            }
          </Button>
        </StepRow>

      </div>

      {/* Hidden file input for frame uploads */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Preview lightbox */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewSrc(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            {previewSrc.match(/\.(mp4|webm|mov)/) ? (
              <video src={previewSrc} controls autoPlay className="max-h-[85vh] rounded-xl" />
            ) : (
              <img src={previewSrc} alt="Preview" className="max-h-[85vh] rounded-xl" />
            )}
            <button
              onClick={() => setPreviewSrc(null)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-sm font-bold shadow-lg hover:scale-110 transition-transform"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
