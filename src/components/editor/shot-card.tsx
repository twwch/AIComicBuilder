"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useModelStore } from "@/stores/model-store";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { useModelGuard } from "@/hooks/use-model-guard";
import { VideoRatioPicker } from "@/components/editor/video-ratio-picker";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { buildVideoPrompt } from "@/lib/ai/prompts/video-generate";
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  VideoIcon,
  MessageCircle,
  Clock,
  Sparkles,
  Copy,
  Check,
} from "lucide-react";

interface Dialogue {
  id: string;
  text: string;
  characterName: string;
}

interface ShotCardProps {
  id: string;
  projectId: string;
  sequence: number;
  prompt: string;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  firstFrame: string | null;
  lastFrame: string | null;
  videoUrl: string | null;
  status: string;
  dialogues: Dialogue[];
  onUpdate: () => void;
  batchGeneratingFrames?: boolean;
  batchGeneratingVideo?: boolean;
  characterDescriptions?: string;
}

const statusVariant: Record<string, "outline" | "success" | "warning" | "destructive"> = {
  pending: "outline",
  generating: "warning",
  completed: "success",
  failed: "destructive",
};

export function ShotCard({
  id,
  projectId,
  sequence,
  prompt,
  startFrameDesc,
  endFrameDesc,
  motionScript,
  cameraDirection,
  duration,
  firstFrame,
  lastFrame,
  videoUrl,
  status,
  dialogues,
  onUpdate,
  batchGeneratingFrames,
  batchGeneratingVideo,
  characterDescriptions,
}: ShotCardProps) {
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [editPrompt, setEditPrompt] = useState(prompt);
  const [editStartFrame, setEditStartFrame] = useState(startFrameDesc ?? "");
  const [editEndFrame, setEditEndFrame] = useState(endFrameDesc ?? "");
  const [editMotionScript, setEditMotionScript] = useState(motionScript ?? "");
  const [editCameraDirection, setEditCameraDirection] = useState(cameraDirection ?? "static");
  const [editDuration, setEditDuration] = useState(duration);
  const [generatingFrames, setGeneratingFrames] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [copied, setCopied] = useState(false);
  const imageGuard = useModelGuard("image");
  const videoGuard = useModelGuard("video");
  const isGeneratingFrames = generatingFrames || (!!batchGeneratingFrames && !firstFrame && !lastFrame);
  const isGeneratingVideo = generatingVideo || (!!batchGeneratingVideo && !!firstFrame && !!lastFrame && !videoUrl);
  const variant = statusVariant[status] || "outline";

  async function patchShot(fields: Record<string, unknown>) {
    await apiFetch(`/api/projects/${projectId}/shots/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  async function handleDurationChange(d: number) {
    setEditDuration(d);
    await patchShot({ duration: d });
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
          payload: { shotId: id },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      console.error("Frame generate error:", err);
      toast.error(t("common.generationFailed"));
    }
    setGeneratingFrames(false);
  }

  async function handleGenerateVideo() {
    if (!videoGuard()) return;
    setGeneratingVideo(true);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_video_generate",
          payload: { shotId: id, ratio: videoRatio },
          modelConfig: getModelConfig(),
        }),
      });
      onUpdate();
    } catch (err) {
      console.error("Video generate error:", err);
      toast.error(t("common.generationFailed"));
    }
    setGeneratingVideo(false);
  }

  function handleCopyPrompt(e: React.MouseEvent) {
    e.stopPropagation();
    const videoPrompt = motionScript
      ? buildVideoPrompt({
          sceneDescription: prompt,
          motionScript,
          cameraDirection,
          duration: editDuration,
          characterDescriptions,
        })
      : prompt;
    navigator.clipboard.writeText(videoPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="group overflow-hidden rounded-2xl border border-[--border-subtle] bg-white transition-all duration-300 hover:border-[--border-hover]">
      {/* Header strip */}
      <div className="flex items-center gap-4 p-4">
        {/* Sequence badge */}
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/8 font-mono text-sm font-bold text-primary">
          {sequence}
        </div>

        {/* Media thumbnails */}
        <div className="flex gap-1.5">
          {[
            { src: firstFrame, icon: ImageIcon, label: t("shot.firstFrame"), type: "image" as const },
            { src: lastFrame, icon: ImageIcon, label: t("shot.lastFrame"), type: "image" as const },
            { src: videoUrl, icon: VideoIcon, label: "Video", type: "video" as const },
          ].map((item, i) => (
            <div
              key={i}
              className={`h-14 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-[--border-subtle] ${item.src ? "cursor-pointer transition-opacity hover:opacity-80" : ""}`}
              onClick={() => item.src && setPreviewSrc(uploadUrl(item.src))}
            >
              {item.src ? (
                item.type === "video" ? (
                  <video className="h-full w-full object-cover" src={uploadUrl(item.src)} />
                ) : (
                  <img src={uploadUrl(item.src)} alt={item.label} className="h-full w-full object-cover" />
                )
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[--surface]">
                  <item.icon className="h-4 w-4 text-[--text-muted]" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-[--text-primary]">{prompt}</p>
          <div className="mt-1.5 flex items-center gap-3">
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
                  handleDurationChange(v);
                }}
                className="w-10 rounded border border-[--border-subtle] bg-white px-1 py-0.5 text-center text-[11px] font-medium text-[--text-primary] outline-none focus:border-primary/50"
              />
              <span className="text-[11px]">s</span>
            </span>
            {dialogues.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-[--text-muted]">
                <MessageCircle className="h-3 w-3" />
                {dialogues.length}
              </span>
            )}
          </div>
        </div>

        {/* Actions + Status + expand */}
        <div className="flex items-center gap-2">
          {!expanded && (
            <>
              <Button
                size="xs"
                variant="outline"
                onClick={(e) => { e.stopPropagation(); handleGenerateFrames(); }}
                disabled={isGeneratingFrames || isGeneratingVideo}
              >
                {isGeneratingFrames ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ImageIcon className="h-3 w-3" />
                )}
                {isGeneratingFrames ? t("common.generating") : t("project.generateFrames")}
              </Button>
              {firstFrame && lastFrame && (
                <Button
                  size="xs"
                  onClick={(e) => { e.stopPropagation(); handleGenerateVideo(); }}
                  disabled={isGeneratingFrames || isGeneratingVideo}
                >
                  {isGeneratingVideo ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {isGeneratingVideo ? t("common.generating") : t("project.generateVideo")}
                </Button>
              )}
            </>
          )}
          <button
            onClick={handleCopyPrompt}
            title={t("shot.copyPrompt")}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <Badge variant={variant} className={status === "generating" ? "animate-status-pulse" : ""}>
            {status}
          </Badge>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-all hover:bg-[--surface] hover:text-[--text-primary]"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Image/Video preview lightbox */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewSrc(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            {previewSrc.match(/\.(mp4|webm|mov)/) ? (
              <video
                src={previewSrc}
                controls
                autoPlay
                className="max-h-[85vh] rounded-xl"
              />
            ) : (
              <img
                src={previewSrc}
                alt="Preview"
                className="max-h-[85vh] rounded-xl"
              />
            )}
            <button
              onClick={() => setPreviewSrc(null)}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-sm font-bold text-[--text-primary] shadow-lg transition-transform hover:scale-110"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="space-y-4 border-t border-[--border-subtle] p-4">
          {/* Scene Description */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
              {t("shot.sceneDescription")}
            </p>
            <Textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              onBlur={() => patchShot({ prompt: editPrompt })}
              rows={2}
              placeholder={t("shot.prompt")}
            />
          </div>

          {/* Start Frame Description */}
          <div className="rounded-xl bg-blue-50/50 p-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-blue-600">
              {t("shot.startFrame")}
            </p>
            <Textarea
              value={editStartFrame}
              onChange={(e) => setEditStartFrame(e.target.value)}
              onBlur={() => patchShot({ startFrameDesc: editStartFrame })}
              rows={2}
              className="rounded-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0"
              placeholder="Start frame description..."
            />
          </div>

          {/* End Frame Description */}
          <div className="rounded-xl bg-amber-50/50 p-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-600">
              {t("shot.endFrame")}
            </p>
            <Textarea
              value={editEndFrame}
              onChange={(e) => setEditEndFrame(e.target.value)}
              onBlur={() => patchShot({ endFrameDesc: editEndFrame })}
              rows={2}
              className="rounded-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0"
              placeholder="End frame description..."
            />
          </div>

          {/* Motion Script */}
          <div className="rounded-xl bg-emerald-50/50 p-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-600">
              {t("shot.motionScript")}
            </p>
            <Textarea
              value={editMotionScript}
              onChange={(e) => setEditMotionScript(e.target.value)}
              onBlur={() => patchShot({ motionScript: editMotionScript })}
              rows={2}
              className="rounded-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0"
              placeholder="Motion script..."
            />
          </div>

          {/* Camera Direction */}
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
              {t("shot.cameraDirection") || "Camera Direction"}
            </p>
            <input
              value={editCameraDirection}
              onChange={(e) => setEditCameraDirection(e.target.value)}
              onBlur={() => patchShot({ cameraDirection: editCameraDirection })}
              className="w-full rounded-xl border border-[--border-subtle] bg-white px-3.5 py-2 text-sm text-[--text-primary] outline-none focus:border-primary/50"
              placeholder="static / pan-left / zoom-in ..."
            />
          </div>

          {dialogues.length > 0 && (
            <div className="space-y-2 rounded-xl bg-[--surface] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
                {t("shot.dialogue")}
              </p>
              {dialogues.map((d) => (
                <p key={d.id} className="text-sm leading-relaxed">
                  <span className="font-semibold text-primary">{d.characterName}</span>
                  <span className="mx-1.5 text-[--text-muted]">&mdash;</span>
                  <span className="text-[--text-secondary]">{d.text}</span>
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <InlineModelPicker capability="image" />
            <Button
              size="sm"
              variant="outline"
              onClick={handleGenerateFrames}
              disabled={isGeneratingFrames || isGeneratingVideo}
            >
              {isGeneratingFrames ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5" />
              )}
              {isGeneratingFrames ? t("common.generating") : t("project.generateFrames")}
            </Button>

            {firstFrame && lastFrame && (
              <>
                <InlineModelPicker capability="video" />
                <VideoRatioPicker value={videoRatio} onChange={setVideoRatio} />
                <div className="flex items-center gap-1.5 rounded-lg border border-[--border-subtle] bg-white px-2.5 py-1">
                  <Clock className="h-3.5 w-3.5 text-[--text-muted]" />
                  <input
                    type="number"
                    min={5}
                    max={15}
                    value={editDuration}
                    onChange={(e) => {
                      const v = Math.min(15, Math.max(5, Number(e.target.value)));
                      handleDurationChange(v);
                    }}
                    className="w-10 bg-transparent text-center text-[11px] font-medium text-[--text-primary] outline-none"
                  />
                  <span className="text-[11px] text-[--text-muted]">s</span>
                </div>
                <Button
                  size="sm"
                  onClick={handleGenerateVideo}
                  disabled={isGeneratingFrames || isGeneratingVideo}
                >
                  {isGeneratingVideo ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {isGeneratingVideo ? t("common.generating") : t("project.generateVideo")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
