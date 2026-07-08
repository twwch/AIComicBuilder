"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import { Images, Loader2, ArrowUpCircle, Trash2, ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";

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
  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description);
  const [editVisualHint, setEditVisualHint] = useState(visualHint ?? "");

  // Sync local state when props change (e.g. after re-extraction)
  useEffect(() => { setEditName(name); }, [name]);
  useEffect(() => { setEditDesc(description); }, [description]);
  useEffect(() => { setEditVisualHint(visualHint ?? ""); }, [visualHint]);
  const [switchingImage, setSwitchingImage] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const isLoadingImage = !!batchGenerating && !referenceImage;

  function getImageHistory() {
    let history: string[] = [];
    try {
      history = JSON.parse(referenceImageHistory || "[]");
    } catch {}
    if (referenceImage && !history.includes(referenceImage)) {
      history = [referenceImage, ...history];
    }
    return [...new Set(history.filter(Boolean))];
  }

  const imageHistory = getImageHistory();
  const currentImageIndex = referenceImage ? imageHistory.indexOf(referenceImage) : -1;

  async function switchToImage(newPath: string) {
    setSwitchingImage(true);
    try {
      await apiFetch(`/api/projects/${projectId}/characters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceImage: newPath }),
      });
      onUpdate();
    } catch (err) {
      console.error("Character image switch error:", err);
      toast.error(t("common.uploadFailed"));
    }
    setSwitchingImage(false);
  }

  async function handleSave() {
    await apiFetch(`/api/projects/${projectId}/characters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDesc, visualHint: editVisualHint }),
    });
    onUpdate();
  }

  async function handleSwitchImage() {
    if (imageHistory.length < 2) return;
    const nextIndex = currentImageIndex >= 0
      ? (currentImageIndex + 1) % imageHistory.length
      : 0;
    await switchToImage(imageHistory[nextIndex]);
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
        {referenceImage ? (() => {
          const showArrows = imageHistory.length > 1;
          const currentIdx = currentImageIndex >= 0 ? currentImageIndex : 0;
          return (
            <div className="relative w-full aspect-video overflow-hidden rounded-xl cursor-pointer group" onClick={() => setLightbox(true)}>
              <img
                src={uploadUrl(referenceImage)}
                alt={name}
                className="w-full h-full object-cover"
              />
              {showArrows && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = (currentIdx - 1 + imageHistory.length) % imageHistory.length;
                      switchToImage(imageHistory[next]);
                    }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = (currentIdx + 1) % imageHistory.length;
                      switchToImage(imageHistory[next]);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white">
                    {currentIdx + 1}/{imageHistory.length}
                  </span>
                </>
              )}
            </div>
          );
        })() : isLoadingImage ? (
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
            <div className="flex gap-2">
              <Button
                onClick={handleSwitchImage}
                disabled={switchingImage || imageHistory.length < 2}
                className="flex-1"
                size="sm"
                title={imageHistory.length < 2 ? t("character.noSwitchableImages") : t("character.switchImage")}
              >
                {switchingImage ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Images className="h-3.5 w-3.5" />
                )}
                {switchingImage ? t("common.loading") : t("character.switchImage")}
              </Button>
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
            </div>
          </div>
      </div>

      {referenceImage && (
        <Dialog open={lightbox} onOpenChange={setLightbox}>
          <DialogContent className="!max-w-[90vw] !w-[90vw] border-0 bg-transparent p-0 shadow-none" showCloseButton={false}>
            <DialogTitle className="sr-only">{name}</DialogTitle>
            <div className="relative inline-block w-full">
              <img
                src={uploadUrl(referenceImage)}
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
