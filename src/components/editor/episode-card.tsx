"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { MoreHorizontal, Pencil, Trash2, Film, Clock, Play, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Episode } from "@/stores/episode-store";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";

interface EpisodeCardProps {
  episode: Episode;
  projectId: string;
  onEdit: (episode: Episode) => void;
  onDelete: (episode: Episode) => void;
  onPlayVideo?: (episode: Episode) => void;
  selectionMode?: boolean;
  selected?: boolean;
  selectable?: boolean;
  onToggleSelect?: (episode: Episode) => void;
}

export function EpisodeCard({
  episode, projectId, onEdit, onDelete, onPlayVideo,
  selectionMode, selected, selectable, onToggleSelect,
}: EpisodeCardProps) {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const te = useTranslations("episode");
  const tc = useTranslations("common");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const hasVideo = !!episode.finalVideoUrl;
  const isProcessing = episode.status === "processing";
  const previewImages = useMemo(() => episode.previewImages ?? [], [episode.previewImages]);
  const hasPreview = previewImages.length > 0;

  // Carousel state for preview images
  const [carouselIdx, setCarouselIdx] = useState(0);
  useEffect(() => {
    if (!hasPreview || previewImages.length <= 1 || hasVideo) return;
    const timer = setInterval(() => {
      setCarouselIdx((i) => (i + 1) % previewImages.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [hasPreview, previewImages.length, hasVideo]);

  const keywordList = episode.keywords
    ? episode.keywords.split(/[,，]/).map((k) => k.trim()).filter(Boolean)
    : [];

  const handlePlayClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onPlayVideo?.(episode);
  }, [episode, onPlayVideo]);

  const detailHref = `/${locale}/project/${projectId}/episodes/${episode.id}/script`;

  const epLabel = `EP.${String(episode.sequence).padStart(2, "0")}`;

  /* Selection overlay */
  const selectionOverlay = selectionMode ? (
    <div className="absolute inset-0 z-20 flex items-start justify-start p-3">
      <div className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${
        selected
          ? "border-primary bg-primary text-white"
          : selectable
            ? "border-white/80 bg-white/60 backdrop-blur-sm"
            : "border-gray-300 bg-gray-200"
      }`}>
        {selected && <Check className="h-3 w-3" />}
      </div>
      {!selectable && (
        <span className="ml-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm">
          无视频
        </span>
      )}
    </div>
  ) : null;

  /* Carousel / preview thumbnail for non-video states */
  const previewCarousel = (
    <div className="relative aspect-video w-full overflow-hidden bg-[--surface]">
      {previewImages.map((src, i) => (
        <img
          key={src}
          src={uploadUrl(src)}
          alt={`${epLabel} preview ${i + 1}`}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
          style={{ opacity: i === carouselIdx ? 1 : 0 }}
        />
      ))}
      {/* Dots indicator */}
      {previewImages.length > 1 && (
        <div className="absolute bottom-2 left-1/2 z-[1] flex -translate-x-1/2 gap-1">
          {previewImages.map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === carouselIdx ? "w-3 bg-white" : "w-1 bg-white/50"
              }`}
            />
          ))}
        </div>
      )}
      {/* Selection overlay */}
      {selectionOverlay}
      {/* EP label */}
      <span className="absolute left-2 top-2 rounded-[5px] bg-white/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[--text-secondary] backdrop-blur-sm">
        {epLabel}
      </span>
      {/* Status badge */}
      {isProcessing ? (
        <span className="absolute right-2 top-2 z-[2] flex items-center gap-1 rounded-[5px] bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 backdrop-blur-sm">
          <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-amber-500" />
          {t("projectStatus.processing")}
        </span>
      ) : (
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-[5px] bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-[--text-muted] backdrop-blur-sm">
          <span className="h-[5px] w-[5px] rounded-full bg-[#d4d4d4]" />
          {t("projectStatus.draft")}
        </span>
      )}
    </div>
  );

  const thumbnailContent = hasVideo ? (
    /* Completed with video */
    <div className="relative aspect-video w-full overflow-hidden bg-[--surface]">
      <video
        src={uploadUrl(episode.finalVideoUrl!)}
        className="h-full w-full object-cover transition-transform duration-400 group-hover:scale-[1.04]"
        muted
        preload="metadata"
      />
      {/* Selection overlay */}
      {selectionOverlay}
      {/* Play overlay */}
      {!selectionMode && (
        <button
          onClick={handlePlayClick}
          className="absolute inset-0 flex items-center justify-center bg-black/15 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/92 shadow-[0_3px_12px_rgba(0,0,0,0.12)] transition-transform duration-200 group-hover:scale-110">
            <Play className="ml-0.5 h-4 w-4 fill-primary text-primary" />
          </div>
        </button>
      )}
      {/* EP label */}
      <span className="absolute left-2 top-2 rounded-[5px] bg-white/88 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[--text-secondary] backdrop-blur-sm">
        {epLabel}
      </span>
    </div>
  ) : hasPreview ? (
    previewCarousel
  ) : isProcessing ? (
    /* Processing: shimmer animation */
    <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-1.5 overflow-hidden bg-gradient-to-br from-[--surface] to-[#eeece8]">
      {/* Shimmer effect */}
      <div className="absolute inset-0 animate-[shimmer-slide_2.5s_infinite] bg-gradient-to-r from-transparent via-primary/[0.04] to-transparent" />
      {/* Selection overlay */}
      {selectionOverlay}
      {/* EP label */}
      <span className="absolute left-2 top-2 rounded-[5px] bg-white/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[--text-muted]">
        {epLabel}
      </span>
      {/* Status badge */}
      <span className="absolute right-2 top-2 z-[2] flex items-center gap-1 rounded-[5px] bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
        <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-amber-500" />
        {t("projectStatus.processing")}
      </span>
      <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-black/[0.04]">
        <Clock className="h-[18px] w-[18px] text-[--text-muted] opacity-50" />
      </div>
      <span className="text-[11px] text-[--text-muted] opacity-60">{te("videoGenerating")}</span>
    </div>
  ) : (
    /* Draft: static placeholder */
    <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-[--surface] to-[#eeece8]">
      {/* Selection overlay */}
      {selectionOverlay}
      {/* EP label */}
      <span className="absolute left-2 top-2 rounded-[5px] bg-white/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[--text-muted]">
        {epLabel}
      </span>
      {/* Status badge */}
      <span className="absolute right-2 top-2 flex items-center gap-1 rounded-[5px] bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
        <span className="h-[5px] w-[5px] rounded-full bg-[#d4d4d4]" />
        {t("projectStatus.draft")}
      </span>
      <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-black/[0.04]">
        <Film className="h-[18px] w-[18px] text-[--text-muted] opacity-50" />
      </div>
      <span className="text-[11px] text-[--text-muted] opacity-60">{te("videoPending")}</span>
    </div>
  );

  const bodyContent = (
    <>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[--text-primary] transition-colors group-hover:text-primary">
          {episode.title}
        </h3>
        {hasVideo && (
          <span className="flex flex-shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-600">
            <span className="h-[5px] w-[5px] rounded-full bg-emerald-500" />
            {t("projectStatus.completed")}
          </span>
        )}
      </div>

      <p className="line-clamp-2 text-xs leading-relaxed text-[--text-muted]">
        {episode.description || te("noDescription")}
      </p>

      {keywordList.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {keywordList.slice(0, 5).map((kw) => (
            <span
              key={kw}
              className="rounded bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary"
            >
              {kw}
            </span>
          ))}
          {keywordList.length > 5 && (
            <span className="text-[10px] text-[--text-muted]">+{keywordList.length - 5}</span>
          )}
        </div>
      )}
    </>
  );

  const actionsMenu = (
    <div ref={menuRef} className="absolute right-2 top-2 z-10">
      <Button
        variant="ghost"
        size="icon-sm"
        className="h-7 w-7 rounded-lg bg-white/80 text-[--text-muted] opacity-0 shadow-sm backdrop-blur-sm transition-all group-hover:opacity-100 hover:bg-white hover:text-[--text-primary]"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen(!menuOpen);
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-xl border border-[--border-subtle] bg-white py-1 shadow-lg">
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[--text-secondary] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen(false);
              onEdit(episode);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            {te("edit")}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 transition-colors hover:bg-red-50"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen(false);
              onDelete(episode);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {tc("delete")}
          </button>
        </div>
      )}
    </div>
  );

  /* No video → entire card is a link to detail page (or div in selection mode) */
  if (!hasVideo) {
    if (selectionMode) {
      return (
        <div
          role="button"
          onClick={() => selectable && onToggleSelect?.(episode)}
          className="group relative flex flex-col overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:border-primary hover:shadow-[0_6px_24px_rgba(232,85,58,0.08)] hover:-translate-y-0.5"
        >
          {thumbnailContent}
          <div className="flex flex-1 flex-col p-3.5 pt-3">
            {bodyContent}
          </div>
        </div>
      );
    }

    return (
      <Link
        href={detailHref}
        className="group relative flex flex-col overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:border-primary hover:shadow-[0_6px_24px_rgba(232,85,58,0.08)] hover:-translate-y-0.5"
      >
        {thumbnailContent}
        <div className="flex flex-1 flex-col p-3.5 pt-3">
          {bodyContent}
        </div>
        {actionsMenu}
      </Link>
    );
  }

  /* Has video → thumbnail plays video, body links to detail */
  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:border-primary hover:shadow-[0_6px_24px_rgba(232,85,58,0.08)] hover:-translate-y-0.5"
      onClick={selectionMode ? () => selectable && onToggleSelect?.(episode) : undefined}
    >
      {thumbnailContent}

      {selectionMode ? (
        <div className="flex flex-1 flex-col p-3.5 pt-3">
          {bodyContent}
        </div>
      ) : (
        <Link
          href={detailHref}
          className="flex flex-1 flex-col p-3.5 pt-3"
        >
          {bodyContent}
        </Link>
      )}

      {/* Actions menu — hidden in selection mode */}
      {!selectionMode && actionsMenu}
    </div>
  );
}
