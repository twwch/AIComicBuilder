"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useModelStore, type ModelRef } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { apiFetch } from "@/lib/api-fetch";
import { uploadUrl } from "@/lib/utils/upload-url";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Sparkles, Loader2, Users } from "lucide-react";
import Link from "next/link";

type ReferenceLayout = "single" | "three-view" | "four-view";

const LAYOUT_OPTIONS: Array<{ value: ReferenceLayout; label: string; hint: string }> = [
  { value: "single", label: "单图", hint: "单角色全身立绘" },
  { value: "three-view", label: "三视图", hint: "正面/侧面/背面" },
  { value: "four-view", label: "四视图", hint: "正面/3-4/侧面/背面" },
];

interface Character {
  id: string;
  name: string;
  referenceImage: string | null;
  referenceImageSingle?: string | null;
  referenceLayout?: ReferenceLayout | null;
}

interface CharactersInlinePanelProps {
  characters: Character[];
  projectId: string;
  generationMode: "keyframe" | "reference" | "4grid";
  onUpdate: () => void;
}

export function CharactersInlinePanel({
  characters,
  projectId,
  generationMode,
  onUpdate,
}: CharactersInlinePanelProps) {
  const t = useTranslations("project");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const providers = useModelStore((s) => s.providers);
  const defaultImageModel = useModelStore((s) => s.defaultImageModel);
  const imageGuard = useModelGuard("image");

  const [imageModelRef, setImageModelRef] = useState<ModelRef | null>(() => defaultImageModel);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [layoutMenuFor, setLayoutMenuFor] = useState<string | null>(null);
  const layoutButtonRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const storageKey = `charPanel:${projectId}`;
  const anyMissingRef = characters.some((c) => !c.referenceImage);

  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (layoutMenuFor === null) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("[data-layout-menu]")) return;
      setLayoutMenuFor(null);
    }
    function onScroll() { setLayoutMenuFor(null); }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScroll);
    };
  }, [layoutMenuFor]);

  useEffect(() => {
    // Auto-expand rule: condition takes precedence over localStorage at mount time
    if (generationMode === "reference" && anyMissingRef) {
      setOpen(true);
      return;
    }
    const stored = localStorage.getItem(storageKey);
    setOpen(stored === "true");
  }, []); // only on mount

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  }

  function resolveImageRef(ref: ModelRef | null) {
    if (!ref) return null;
    const provider = providers.find((p) => p.id === ref.providerId);
    if (!provider) return null;
    return {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      secretKey: provider.secretKey,
      modelId: ref.modelId,
    };
  }

  async function handleGenerate(characterId: string, layout: ReferenceLayout = "four-view") {
    if (!imageGuard()) return;
    setGeneratingId(characterId);
    setLayoutMenuFor(null);
    try {
      await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_character_image",
          payload: { characterId, referenceLayout: layout },
          modelConfig: { ...getModelConfig(), image: resolveImageRef(imageModelRef) },
        }),
      });
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("generationFailed"));
    }
    setGeneratingId(null);
  }

  if (characters.length === 0) return null;

  const needsAttention = generationMode === "reference" && anyMissingRef;

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
          {/* Model picker */}
          <div className="mb-3">
            <InlineModelPicker capability="image" value={imageModelRef} onChange={setImageModelRef} />
          </div>

          {/* Character grid */}
          <div className="flex flex-wrap gap-2">
            {characters.map((char) => {
              const isGenerating = generatingId === char.id;
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
                    ) : isGenerating ? (
                      <div className="flex h-full w-full items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      </div>
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
                  {/* Generate button (only when no image) */}
                  {!char.referenceImage && (
                    <div
                      ref={(el) => { if (el) layoutButtonRefs.current.set(char.id, el); else layoutButtonRefs.current.delete(char.id); }}
                      data-layout-menu
                    >
                      <button
                        onClick={() => {
                          if (isGenerating || !!generatingId) return;
                          setLayoutMenuFor(layoutMenuFor === char.id ? null : char.id);
                        }}
                        disabled={isGenerating || !!generatingId}
                        className="flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                      >
                        {isGenerating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sparkles className="h-2.5 w-2.5" />}
                        Gen
                        <ChevronDown className="h-2.5 w-2.5 opacity-60" />
                      </button>
                      {layoutMenuFor === char.id && (() => {
                        const el = layoutButtonRefs.current.get(char.id);
                        if (!el) return null;
                        const r = el.getBoundingClientRect();
                        const spaceBelow = window.innerHeight - r.bottom;
                        const openUp = spaceBelow < 140;
                        return (
                          <div
                            className="fixed z-50 rounded-md border border-[--border-subtle] bg-white p-1 shadow-lg"
                            style={{ left: Math.max(8, r.left + r.width / 2 - 64), top: openUp ? undefined : r.bottom + 4, bottom: openUp ? window.innerHeight - r.top + 4 : undefined }}
                            data-layout-menu
                          >
                            {LAYOUT_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => handleGenerate(char.id, opt.value)}
                                className="flex w-full flex-col items-start rounded px-2 py-1 text-left text-[10px] text-[--text-secondary] transition-colors hover:bg-primary/10 hover:text-primary"
                              >
                                <span className="font-medium">{opt.label}</span>
                                <span className="text-[9px] text-[--text-muted]">{opt.hint}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
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
