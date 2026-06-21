"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface NewVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
  nextVersionNum: number;
  generating?: boolean;
}

export function NewVersionDialog({
  open,
  onOpenChange,
  onSubmit,
  nextVersionNum,
  generating = false,
}: NewVersionDialogProps) {
  const t = useTranslations("project");
  const tc = useTranslations("common");
  const now = new Date();
  const dateStr =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0");
  const defaultName = `${dateStr}-V${nextVersionNum}`;

  const [name, setName] = useState(defaultName);
  const [base, setBase] = useState<"fresh" | "copy">("fresh");
  const [copyText, setCopyText] = useState(true);
  const [copyFrames, setCopyFrames] = useState(false);
  const [copyPrompts, setCopyPrompts] = useState(false);
  const [copyVideos, setCopyVideos] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setBase("fresh");
      setCopyText(true);
      setCopyFrames(false);
      setCopyPrompts(false);
      setCopyVideos(false);
    }
  }, [open, nextVersionNum]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || generating) return;
    await onSubmit(name.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newVersion") || "New Version"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Version name */}
          <div>
            <Label className="mb-1.5 block">{t("versionName") || "Version Name"}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("versionNamePlaceholder") || "e.g. V2"}
            />
          </div>

          {/* Based on */}
          <div>
            <Label className="mb-1.5 block">{t("basedOn") || "Based On"}</Label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="base"
                  checked={base === "fresh"}
                  onChange={() => setBase("fresh")}
                  className="h-4 w-4 text-primary accent-primary"
                />
                <span className="text-sm text-[--text-secondary]">
                  {t("startFresh") || "Start from scratch (re-generate from script)"}
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="base"
                  checked={base === "copy"}
                  onChange={() => setBase("copy")}
                  className="h-4 w-4 text-primary accent-primary"
                />
                <span className="text-sm text-[--text-secondary]">
                  {t("copyFromCurrent") || "Copy from current version"}
                </span>
              </label>
            </div>
          </div>

          {/* Copy options (only visible when copying) */}
          {base === "copy" && (
            <div>
              <Label className="mb-1.5 block">{t("copyContents") || "Content to copy"}</Label>
              <div className="flex flex-col gap-1.5 pl-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyText}
                    onChange={(e) => setCopyText(e.target.checked)}
                    className="h-4 w-4 rounded border-[--border-subtle] text-primary accent-primary"
                  />
                  <span className="text-sm text-[--text-secondary]">{t("shotText") || "Shot text & descriptions"}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyFrames}
                    onChange={(e) => setCopyFrames(e.target.checked)}
                    className="h-4 w-4 rounded border-[--border-subtle] text-primary accent-primary"
                  />
                  <span className="text-sm text-[--text-secondary]">{t("shotFrames") || "Frame images"}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyPrompts}
                    onChange={(e) => setCopyPrompts(e.target.checked)}
                    className="h-4 w-4 rounded border-[--border-subtle] text-primary accent-primary"
                  />
                  <span className="text-sm text-[--text-secondary]">{t("shotVideoPrompts") || "Video prompts"}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyVideos}
                    onChange={(e) => setCopyVideos(e.target.checked)}
                    className="h-4 w-4 rounded border-[--border-subtle] text-primary accent-primary"
                  />
                  <span className="text-sm text-[--text-secondary]">{t("shotVideos") || "Videos"}</span>
                </label>
              </div>
              <p className="mt-1.5 text-xs text-[--text-muted]">
                {t("copyNote") || "Note: re-generating shots from script will override copied content"}
              </p>
            </div>
          )}

          <DialogFooter showCloseButton={false}>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={generating}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || generating}>
              {generating ? tc("generating") : t("createVersion") || "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
