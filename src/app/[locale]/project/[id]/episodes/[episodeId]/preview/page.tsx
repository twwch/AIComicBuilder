"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useParams } from "next/navigation";
import {
  useProjectStore,
  getKeyframeVideoUrl,
  getReferenceVideoUrl,
  getSceneRefFrameUrl,
  getFirstFrameUrl,
  getPanelUrl,
} from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import {
  Sparkles,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Play,
  Monitor,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";

export default function EpisodePreviewPage() {
  const t = useTranslations();
  const { project, fetchProject } = useProjectStore();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const versionId = searchParams.get("versionId");

  useEffect(() => {
    if (versionId && params?.id) {
      fetchProject(params.id, undefined, versionId);
    }
  }, [versionId, params?.id, fetchProject]);

  const [assembling, setAssembling] = useState(false);
  const [selectedShot, setSelectedShot] = useState(0);
  const [videoValid, setVideoValid] = useState<boolean | null>(null);
  const checkedUrl = useRef<string | null>(null);

  const finalVideoUrl = project?.finalVideoUrl ?? null;
  const generationMode = project?.generationMode ?? "keyframe";
  type PreviewMode = "keyframe" | "reference" | "4grid";

  // Which mode's videos to preview — default to the project's generationMode
  const hasKeyframeVideos = project?.shots.some((s) => getKeyframeVideoUrl(s)) ?? false;
  const hasReferenceVideos = project?.shots.some((s) => getReferenceVideoUrl(s)) ?? false;
  const hasBothModes = hasKeyframeVideos && hasReferenceVideos;

  const [previewMode, setPreviewMode] = useState<PreviewMode>(generationMode);

  // Sync previewMode when project loads
  useEffect(() => {
    if (project) setPreviewMode(project.generationMode ?? "keyframe");
  }, [project?.generationMode]);

  // Check if final video file actually exists
  useEffect(() => {
    if (!finalVideoUrl) { setVideoValid(null); return; }
    if (checkedUrl.current === finalVideoUrl) return;
    checkedUrl.current = finalVideoUrl;
    fetch(uploadUrl(finalVideoUrl), { method: "HEAD" })
      .then((res) => setVideoValid(res.ok))
      .catch(() => setVideoValid(false));
  }, [finalVideoUrl]);

  if (!project) return null;

  const getVideoUrl = (shot: typeof project.shots[0]) =>
    previewMode === "reference" ? getReferenceVideoUrl(shot) : getKeyframeVideoUrl(shot);

  const getThumbnail = (shot: typeof project.shots[0]) =>
    previewMode === "reference"
      ? getSceneRefFrameUrl(shot)
      : previewMode === "4grid"
        ? getPanelUrl(shot, 1) || getPanelUrl(shot, 2) || getPanelUrl(shot, 3) || getPanelUrl(shot, 4)
        : getFirstFrameUrl(shot);

  const shotsWithVideo = project.shots.filter((s) => getVideoUrl(s));
  const completedVideos = shotsWithVideo.length;
  const currentShot = shotsWithVideo[selectedShot];
  const hasValidVideo = finalVideoUrl && videoValid === true;

  async function handleAssemble() {
    if (!project) return;
    setAssembling(true);
    checkedUrl.current = null;
    try {
      const res = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "video_assemble", payload: versionId ? { versionId } : undefined, episodeId: useProjectStore.getState().currentEpisodeId }),
      });
      await res.json();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Video assemble error:", msg);
      toast.error(msg.includes("余额") || msg.includes("quota") || msg.includes("insufficient") ? msg : t("common.generationFailed"));
    }
    setAssembling(false);
    await fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  function handleDownload() {
    if (!hasValidVideo) return;
    const a = document.createElement("a");
    a.href = uploadUrl(finalVideoUrl!);
    a.download = `${project!.title || "video"}-final.mp4`;
    a.click();
  }

  function handleModeSwitch(mode: PreviewMode) {
    setPreviewMode(mode);
    setSelectedShot(0);
  }

  return (
    <div className="animate-page-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Monitor className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("project.preview")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {t("project.shotsCompleted", {
                completed: completedVideos,
                total: project.shots.length,
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasValidVideo && (
            <Button onClick={handleDownload} size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-100">
              <Download className="h-3.5 w-3.5" />
              {t("project.downloadVideo")}
            </Button>
          )}
          <Button
            onClick={handleAssemble}
            disabled={assembling}
            size="sm"
          >
            {assembling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {assembling ? t("common.generating") : t("project.assembleVideo")}
          </Button>
        </div>
      </div>

      {/* Mode switcher — only shown when both modes have videos */}
      {hasBothModes && (
        <div className="flex items-center gap-1 rounded-xl border border-[--border-subtle] bg-[--surface] p-1 w-fit">
          <button
            onClick={() => handleModeSwitch(generationMode === "4grid" ? "4grid" : "keyframe")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150",
              previewMode === "keyframe" || previewMode === "4grid"
                ? "bg-white text-primary shadow ring-1 ring-primary/20"
                : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
            )}
          >
            {generationMode === "4grid" ? t("project.generationMode4Grid") : t("project.generationModeKeyframe")}
          </button>
          {hasReferenceVideos && (
            <button
              onClick={() => handleModeSwitch("reference")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150",
                previewMode === "reference"
                  ? "bg-white text-primary shadow ring-1 ring-primary/20"
                  : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
              )}
            >
              {t("project.generationModeReference")}
            </button>
          )}
        </div>
      )}

      {/* Final video player */}
      {hasValidVideo && (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-black shadow-2xl shadow-black/40">
            <video
              key={finalVideoUrl!}
              controls
              autoPlay
              className="aspect-video w-full"
              src={uploadUrl(finalVideoUrl!)}
            />
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5">
            <span className="text-sm font-medium text-emerald-700">{t("project.finalVideo")}</span>
            <span className="text-xs text-emerald-600/70">{t("project.finalVideoHint")}</span>
          </div>
        </div>
      )}

      {/* Shot clips player */}
      {shotsWithVideo.length > 0 && currentShot ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-[--border-subtle] bg-black shadow-2xl shadow-black/40">
            <video
              key={currentShot.id + previewMode}
              controls
              autoPlay={!hasValidVideo}
              className="aspect-video w-full"
              src={uploadUrl(getVideoUrl(currentShot)!)}
            />
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setSelectedShot(Math.max(0, selectedShot - 1))}
              disabled={selectedShot === 0}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-all hover:bg-[--surface-hover] hover:text-[--text-primary] disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-mono text-sm font-medium text-[--text-secondary]">
              {selectedShot + 1} / {shotsWithVideo.length}
            </span>
            <button
              onClick={() =>
                setSelectedShot(Math.min(shotsWithVideo.length - 1, selectedShot + 1))
              }
              disabled={selectedShot === shotsWithVideo.length - 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-all hover:bg-[--surface-hover] hover:text-[--text-primary] disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Thumbnail timeline */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {shotsWithVideo.map((shot, i) => {
              const thumb = getThumbnail(shot);
              return (
                <button
                  key={shot.id}
                  onClick={() => setSelectedShot(i)}
                  className={cn(
                    "flex-shrink-0 overflow-hidden rounded-xl border-2 transition-all duration-200",
                    i === selectedShot
                      ? "border-primary shadow-lg shadow-primary/20 scale-[1.03]"
                      : "border-[--border-subtle] hover:border-[--border-hover] opacity-70 hover:opacity-100"
                  )}
                >
                  <div className="relative h-14 w-22">
                    {thumb ? (
                      <img
                        src={uploadUrl(thumb)}
                        alt={`Shot ${shot.sequence}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[--surface]">
                        <Play className="h-3 w-3 text-[--text-muted]" />
                      </div>
                    )}
                    <span className="absolute bottom-1 left-1 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white backdrop-blur-sm">
                      {shot.sequence}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Play className="h-7 w-7 text-primary" />
          </div>
          <p className="max-w-sm text-center text-sm text-[--text-secondary]">
            {t("shot.noShots")}
          </p>
        </div>
      )}
    </div>
  );
}
