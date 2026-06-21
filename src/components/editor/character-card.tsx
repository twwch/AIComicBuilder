"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import { useModelStore, type ModelRef } from "@/stores/model-store";
import { Sparkles, Loader2, Copy, Check, ArrowUpCircle, Trash2, ChevronLeft, ChevronRight, Upload, ChevronDown } from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { apiFetch } from "@/lib/api-fetch";
import { useModelGuard } from "@/hooks/use-model-guard";
import { toast } from "sonner";
import { buildCharacterTurnaroundPrompt } from "@/lib/ai/prompts/character-image";

type ReferenceLayout = "single" | "three-view" | "four-view";

const LAYOUT_OPTIONS: Array<{ value: ReferenceLayout; label: string; hint: string }> = [
  { value: "single", label: "单图", hint: "单角色全身立绘" },
  { value: "three-view", label: "三视图", hint: "正面/侧面/背面" },
  { value: "four-view", label: "四视图", hint: "正面/3-4/侧面/背面" },
];

interface CharacterCardProps {
  id: string;
  projectId: string;
  name: string;
  description: string;
  visualHint: string | null;
  referenceImage: string | null;
  referenceImageHistory?: string | null;
  onUpdate: () => void;
  batchGenerating?: boolean;
  scope?: string;
  onPromote?: () => void;
  onDelete?: () => void;
  episodeName?: string;
}

export function CharacterCard({
  id,
  projectId,
  name,
  description,
  visualHint,
  referenceImage,
  referenceImageHistory,
  onUpdate,
  batchGenerating,
  scope,
  onPromote,
  onDelete,
  episodeName,
}: CharacterCardProps) {
  const t = useTranslations();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const providers = useModelStore((s) => s.providers);
  const defaultImageModel = useModelStore((s) => s.defaultImageModel);
  const [imageModelRef, setImageModelRef] = useState<ModelRef | null>(() => defaultImageModel);
  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description);
  const [editVisualHint, setEditVisualHint] = useState(visualHint ?? "");

  // Sync local state when props change (e.g. after re-extraction)
  useEffect(() => { setEditName(name); }, [name]);
  useEffect(() => { setEditDesc(description); }, [description]);
  useEffect(() => { setEditVisualHint(visualHint ?? ""); }, [visualHint]);
  useEffect(() => { setLocalImage(null); }, [referenceImage]);
  const [generating, setGenerating] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [layoutMenu, setLayoutMenu] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const layoutButtonRef = useRef<HTMLDivElement>(null);
  const imageGuard = useModelGuard("image");
  const isGenerating = generating || (!!batchGenerating && !referenceImage);
  const [generationKey, setGenerationKey] = useState(0);
  const [localImage, setLocalImage] = useState<string | null>(null);
  const displayImage = localImage ?? referenceImage;

  useEffect(() => {
    if (!layoutMenu) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("[data-layout-menu]")) return;
      setLayoutMenu(false);
    }
    function onScroll() { setLayoutMenu(false); }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScroll);
    };
  }, [layoutMenu]);

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

  async function handleSave() {
    await apiFetch(`/api/projects/${projectId}/characters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDesc, visualHint: editVisualHint }),
    });
    onUpdate();
  }

  async function handleGenerateImage(layout: ReferenceLayout = "four-view") {
    if (!imageGuard()) return;
    setGenerating(true);
    setLayoutMenu(false);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "single_character_image",
          payload: { characterId: id, referenceLayout: layout },
          modelConfig: { ...getModelConfig(), image: resolveImageRef(imageModelRef) },
        }),
      });
      await response.json();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Character image error:", msg);
      toast.error(msg.includes("余额") || msg.includes("quota") || msg.includes("insufficient") ? msg : t("common.generationFailed"));
    }
    setGenerating(false);
    setGenerationKey((k) => k + 1);
    onUpdate();
  }

  async function handleUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiFetch(`/api/projects/${projectId}/characters/${id}/upload`, {
        method: "POST",
        body: form,
      });
      onUpdate();
    } catch (err) {
      console.error("Character image upload error:", err);
      toast.error(t("common.uploadFailed"));
    }
    setUploading(false);
  }

  return (
    <div className="group overflow-hidden rounded-2xl border border-[--border-subtle] bg-white transition-all duration-300 hover:border-[--border-hover] hover:shadow-lg hover:shadow-black/5">
      {/* Avatar area */}
      <div className="relative flex items-center justify-center bg-gradient-to-b from-[--surface] to-white p-8">
        {onDelete && (
          <button
            onClick={onDelete}
            className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-red-500/80 text-white opacity-0 transition-all hover:bg-red-600 group-hover:opacity-100"
            title={t("common.delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {referenceImage || localImage ? (() => {
          let history: string[] = [];
          try { history = JSON.parse(referenceImageHistory || "[]"); } catch {}
          if (history.length === 0 && referenceImage) history = [referenceImage];
          const currentIdx = history.indexOf(displayImage ?? "");
          const showArrows = history.length > 1;
          async function switchTo(newPath: string) {
            setLocalImage(newPath);
            setGenerationKey((k) => k + 1);
            await apiFetch(`/api/projects/${projectId}/characters/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ referenceImage: newPath }),
            });
            setGenerationKey((k) => k + 1);
            onUpdate();
          }
          return (
            <div className="relative w-full aspect-video overflow-hidden rounded-xl cursor-pointer group" onClick={() => setLightbox(true)}>
              <img
                src={`${uploadUrl(displayImage ?? "")}?t=${generationKey}`}
                alt={name}
                className="w-full h-full object-cover"
              />
              {showArrows && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = (currentIdx - 1 + history.length) % history.length;
                      switchTo(history[next]);
                    }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = (currentIdx + 1) % history.length;
                      switchTo(history[next]);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white">
                    {currentIdx + 1}/{history.length}
                  </span>
                </>
              )}
            </div>
          );
        })() : isGenerating ? (
          <div className="w-full aspect-video rounded-xl animate-shimmer" />
        ) : (
          <div className="flex w-full aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-accent/10 text-3xl font-bold text-primary">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Scope badge */}
      {scope && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              scope === "main"
                ? "bg-blue-100 text-blue-700"
                : "bg-purple-100 text-purple-700"
            }`}
          >
            {scope === "main" ? t("episode.mainCharacter") : t("episode.guestCharacter")}
          </span>
          {episodeName && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {episodeName}
            </span>
          )}
          {scope === "guest" && onPromote && (
            <button
              onClick={onPromote}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <ArrowUpCircle className="h-3 w-3" />
              {t("episode.promoteToMain")}
            </button>
          )}
        </div>
      )}

      {/* Info */}
      <div className="space-y-3 p-4">
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleSave}
          className="h-9 font-display font-semibold text-base"
        />
        <Textarea
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          onBlur={handleSave}
          placeholder={t("character.description")}
          className="h-32 resize-none text-sm"
        />
        <Input
          value={editVisualHint}
          onChange={(e) => setEditVisualHint(e.target.value)}
          onBlur={handleSave}
          placeholder={t("character.visualHint")}
          className="h-8 text-xs text-muted-foreground"
        />
        <div className="space-y-2">
            <InlineModelPicker capability="image" value={imageModelRef} onChange={setImageModelRef} />
            <div className="flex gap-2">
              <div ref={layoutButtonRef} className="flex-1" data-layout-menu>
                <Button
                  onClick={() => setLayoutMenu((v) => !v)}
                  disabled={isGenerating}
                  className="w-full"
                  size="sm"
                >
                  {isGenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {isGenerating ? t("common.generating") : t("character.generateImage")}
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
                {layoutMenu && layoutButtonRef.current && (() => {
                  const r = layoutButtonRef.current.getBoundingClientRect();
                  const spaceBelow = window.innerHeight - r.bottom;
                  const openUp = spaceBelow < 160;
                  return (
                    <div
                      className="fixed z-50 rounded-md border border-[--border-subtle] bg-white p-1 shadow-lg"
                      style={{ left: r.left, width: r.width, top: openUp ? undefined : r.bottom + 4, bottom: openUp ? window.innerHeight - r.top + 4 : undefined }}
                      data-layout-menu
                    >
                      {LAYOUT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => handleGenerateImage(opt.value)}
                          className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-[11px] text-[--text-secondary] transition-colors hover:bg-primary/10 hover:text-primary"
                        >
                          <span className="font-medium">{opt.label}</span>
                          <span className="text-[10px] text-[--text-muted]">{opt.hint}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 px-2.5"
                title={t("character.uploadImage")}
                disabled={uploading}
                onClick={() => uploadInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 px-2.5"
                title="Copy image prompt"
                onClick={async () => {
                  const prompt = buildCharacterTurnaroundPrompt(editDesc || editName, editName);
                  await navigator.clipboard.writeText(prompt);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
      </div>

      {referenceImage && (
        <Dialog open={lightbox} onOpenChange={setLightbox}>
          <DialogContent className="!max-w-[90vw] !w-[90vw] border-0 bg-transparent p-0 shadow-none" showCloseButton={false}>
            <DialogTitle className="sr-only">{name}</DialogTitle>
            <div className="relative inline-block w-full">
              <img
                src={`${uploadUrl(displayImage ?? "")}?t=${generationKey}`}
                alt={name}
                className="w-full max-h-[85vh] object-contain rounded-xl"
              />
              <button
                onClick={() => setLightbox(false)}
                className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <span className="text-sm leading-none">✕</span>
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Hidden file input for image upload */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUploadImage}
      />
    </div>
  );
}
