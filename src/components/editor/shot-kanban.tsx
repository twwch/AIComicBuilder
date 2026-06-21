"use client";

import { useTranslations } from "next-intl";
import { Loader2, ImageIcon, VideoIcon, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadUrl } from "@/lib/utils/upload-url";
import {
  type Shot,
  getFirstFrameUrl,
  getLastFrameUrl,
  getSceneRefFrameUrl,
  getKeyframeVideoUrl,
  getReferenceVideoUrl,
  getPanelUrl,
  hasAllPanels,
} from "@/stores/project-store";

type KanbanShot = Shot;

interface ShotKanbanProps {
  shots: KanbanShot[];
  generationMode: "keyframe" | "reference" | "4grid";
  anyGenerating: boolean;
  onOpenDrawer: (id: string) => void;
  onBatchFrames: () => void;
  onBatchSceneFrames: () => void;
  onBatchVideoPrompts: () => void;
  onBatchVideos: () => void;
  onBatchReferenceVideos: () => void;
  generatingFrames: boolean;
  generatingSceneFrames: boolean;
  generatingVideoPrompts: boolean;
  generatingVideos: boolean;
}

interface KanbanColumn {
  key: string;
  labelKey: string;
  color: string;
  headerBg: string;
  shots: KanbanShot[];
  batchAction?: () => void;
  isGenerating?: boolean;
  icon: React.ReactNode;
}

function classifyShot(shot: KanbanShot, mode: "keyframe" | "reference" | "4grid") {
  const hasFrame = mode === "reference"
    ? !!getSceneRefFrameUrl(shot)
    : mode === "4grid"
      ? hasAllPanels(shot)
      : !!(getFirstFrameUrl(shot) && getLastFrameUrl(shot));
  const hasVideoPrompt = !!shot.videoPrompt;
  const hasVideo = !!(mode === "reference" ? getReferenceVideoUrl(shot) : getKeyframeVideoUrl(shot));
  if (!hasFrame) return "frames";
  if (!hasVideoPrompt) return "prompt";
  if (!hasVideo) return "video";
  return "done";
}

export function ShotKanban({
  shots,
  generationMode,
  anyGenerating,
  onOpenDrawer,
  onBatchFrames,
  onBatchSceneFrames,
  onBatchVideoPrompts,
  onBatchVideos,
  onBatchReferenceVideos,
  generatingFrames,
  generatingSceneFrames,
  generatingVideoPrompts,
  generatingVideos,
}: ShotKanbanProps) {
  const t = useTranslations("project");
  const tCommon = useTranslations("common");

  const frameShots = shots.filter((s) => classifyShot(s, generationMode) === "frames");
  const promptShots = shots.filter((s) => classifyShot(s, generationMode) === "prompt");
  const videoShots = shots.filter((s) => classifyShot(s, generationMode) === "video");
  const doneShots = shots.filter((s) => classifyShot(s, generationMode) === "done");

  const framesGenerating = generationMode === "reference" ? generatingSceneFrames : generatingFrames;
  const framesAction = generationMode === "reference" ? onBatchSceneFrames : onBatchFrames;
  const videosAction = generationMode === "reference" ? onBatchReferenceVideos : onBatchVideos;

  const columns: KanbanColumn[] = [
    {
      key: "frames",
      labelKey: "kanbanNeedsFrames",
      color: "text-amber-700",
      headerBg: "bg-amber-50 border-amber-200",
      shots: frameShots,
      batchAction: framesAction,
      isGenerating: framesGenerating,
      icon: <ImageIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "prompt",
      labelKey: "kanbanNeedsPrompt",
      color: "text-violet-700",
      headerBg: "bg-violet-50 border-violet-200",
      shots: promptShots,
      batchAction: onBatchVideoPrompts,
      isGenerating: generatingVideoPrompts,
      icon: <Sparkles className="h-3.5 w-3.5" />,
    },
    {
      key: "video",
      labelKey: "kanbanNeedsVideo",
      color: "text-pink-700",
      headerBg: "bg-pink-50 border-pink-200",
      shots: videoShots,
      batchAction: videosAction,
      isGenerating: generatingVideos,
      icon: <VideoIcon className="h-3.5 w-3.5" />,
    },
    {
      key: "done",
      labelKey: "kanbanDone",
      color: "text-emerald-700",
      headerBg: "bg-emerald-50 border-emerald-200",
      shots: doneShots,
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {columns.map((col) => (
        <div key={col.key} className="flex flex-col rounded-2xl border border-[--border-subtle] bg-white overflow-hidden">
          {/* Column header */}
          <div className={`flex items-center gap-2 border-b px-3 py-2 ${col.headerBg}`}>
            <span className={col.color}>{col.icon}</span>
            <span className={`flex-1 text-[12px] font-semibold ${col.color}`}>
              {t(col.labelKey as Parameters<typeof t>[0])}
            </span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${col.headerBg} ${col.color} border`}>
              {col.shots.length}
            </span>
          </div>

          {/* Batch button */}
          {col.batchAction && col.shots.length > 0 && (
            <div className="border-b border-[--border-subtle] px-2 py-2">
              <Button
                size="xs"
                variant="outline"
                className="w-full"
                onClick={col.batchAction}
                disabled={anyGenerating}
              >
                {col.isGenerating
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : col.icon
                }
                {col.isGenerating
                  ? tCommon("generating")
                  : t("kanbanBatchGenerate", { count: col.shots.length } as never)
                }
              </Button>
            </div>
          )}

          {/* Shot mini-cards */}
          <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
            {col.shots.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-[11px] text-[--text-muted]">
                —
              </div>
            ) : (
              col.shots.map((shot) => {
                const thumb = generationMode === "4grid"
                  ? getPanelUrl(shot, 1) || getPanelUrl(shot, 2) || getPanelUrl(shot, 3) || getPanelUrl(shot, 4)
                  : getFirstFrameUrl(shot) || getSceneRefFrameUrl(shot) || getLastFrameUrl(shot);
                return (
                  <div
                    key={shot.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-[--border-subtle] bg-white px-2 py-1.5 transition-colors hover:border-primary/30 hover:bg-primary/2"
                    onClick={() => onOpenDrawer(shot.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenDrawer(shot.id); } }}
                  >
                    {/* Thumbnail */}
                    <div className="h-8 w-11 flex-shrink-0 overflow-hidden rounded-md border border-[--border-subtle] bg-[--surface]">
                      {thumb ? (
                        <img src={uploadUrl(thumb)} alt={`Shot ${shot.sequence}`} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon className="h-3 w-3 text-[--text-muted]" />
                        </div>
                      )}
                    </div>
                    {/* Text */}
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-mono font-bold text-primary">#{shot.sequence}</div>
                      <div className="truncate text-[11px] text-[--text-secondary]">{shot.prompt}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
