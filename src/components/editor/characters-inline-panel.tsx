"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import Link from "next/link";

interface Character {
  id: string;
  name: string;
  referenceImage: string | null;
}

interface CharactersInlinePanelProps {
  characters: Character[];
  projectId: string;
  generationMode: "keyframe" | "reference";
}

export function CharactersInlinePanel({
  characters,
  projectId,
  generationMode,
}: CharactersInlinePanelProps) {
  const t = useTranslations("project");
  const locale = useLocale();

  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const anyMissingRef = characters.some((c) => !c.referenceImage);
  const needsAttention = generationMode === "reference" && anyMissingRef;

  const [open, setOpen] = useState(needsAttention);

  function toggle() {
    setOpen((prev) => !prev);
  }

  if (characters.length === 0) return null;

  return (
    <div className={`rounded-xl border transition-colors ${
      needsAttention && open
        ? "border-amber-300 bg-amber-50/60"
        : "border-[--border-subtle] bg-[--surface]/50"
    }`}>
      {/* Header toggle */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={toggle}
      >
        <Users className="h-3.5 w-3.5 text-[--text-muted]" />
        <span className="flex-1 text-[13px] font-medium text-[--text-secondary]">
          {t("charactersPanel")}
        </span>
        {needsAttention && (
          <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {characters.filter((c) => !c.referenceImage).length}
          </span>
        )}
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-[--text-muted]" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-[--text-muted]" />
        )}
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-[--border-subtle] px-3 pb-3 pt-2.5">
          {/* Character grid */}
          <div className="flex flex-wrap gap-2">
            {characters.map((char) => {
              return (
                <div key={char.id} className="flex flex-col items-center gap-1">
                  {/* Thumbnail */}
                  <div
                    className={`relative h-20 w-20 overflow-hidden rounded-lg border border-[--border-subtle] bg-[--surface] ${char.referenceImage ? "cursor-zoom-in" : ""}`}
                    onClick={() => char.referenceImage && setPreviewSrc(uploadUrl(char.referenceImage))}
                  >
                    {char.referenceImage ? (
                      <img
                        src={uploadUrl(char.referenceImage)}
                        alt={char.name}
                        className="h-full w-full object-cover transition-opacity hover:opacity-80"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-lg font-bold text-primary">
                        {char.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {/* Status badge */}
                    <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                      char.referenceImage ? "bg-emerald-500" : "bg-amber-500"
                    }`} />
                  </div>
                  {/* Name */}
                  <span className="max-w-[80px] truncate text-[11px] text-[--text-muted]">{char.name}</span>
                </div>
              );
            })}
          </div>

          {/* Footer link */}
          <div className="mt-3 flex justify-end">
            <Link
              href={`/${locale}/project/${projectId}/characters`}
              className="text-[11px] text-[--text-muted] underline underline-offset-2 hover:text-[--text-secondary] transition-colors"
            >
              {t("charactersPanelEdit")} →
            </Link>
          </div>
        </div>
      )}

      {/* Preview lightbox */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewSrc(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <img src={previewSrc} alt="Preview" className="max-h-[85vh] rounded-xl" />
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
