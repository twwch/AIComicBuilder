"use client";

import { useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Upload, FileText, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { toast } from "sonner";

const ACCEPTED = ".txt,.docx,.pdf,.md,.markdown";
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

interface IntakeJobStatus {
  status: "queued" | "running" | "awaiting_review" | "confirmed" | "failed" | "cancelled";
  progress: number;
  current_stage: string;
  candidate_text?: string;
  error_message?: string;
}

interface UploadScriptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onComplete: () => void;
}

export function UploadScriptDialog({
  open,
  onOpenChange,
  projectId,
  onComplete,
}: UploadScriptDialogProps) {
  const t = useTranslations("uploadScript");
  const tc = useTranslations("common");
  const textGuard = useModelGuard("text");
  const getModelConfig = useModelStore((s) => s.getModelConfig);

  const [file, setFile] = useState<File | null>(null);
  const [targetMinutes, setTargetMinutes] = useState(10);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [intakeJobId, setIntakeJobId] = useState("");
  const [intakeStatus, setIntakeStatus] = useState<IntakeJobStatus | null>(null);
  const [candidateText, setCandidateText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef(false);

  const handleFile = useCallback((f: File) => {
    if (f.size > MAX_SIZE) {
      toast.error(t("fileTooLarge"));
      return;
    }
    setFile(f);
  }, [t]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  async function handleSubmit() {
    if (!file || uploading) return;
    if (!textGuard()) return;

    setUploading(true);
    setCandidateText("");
    setIntakeStatus(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("targetMinutes", String(targetMinutes));
      form.append("modelConfig", JSON.stringify(getModelConfig()));
      form.append("allowAiOverwrite", "true");

      const res = await apiFetch(
        `/api/projects/${projectId}/script/intake/start`,
        { method: "POST", body: form }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      const data = await res.json();
      setIntakeJobId(data.jobId);
      toast.success(t("queued"));
      await pollIntakeJob(data.jobId);
    } catch (err) {
      console.error("Upload script error:", err);
      toast.error(
        err instanceof Error ? err.message : tc("generationFailed")
      );
    } finally {
      setUploading(false);
    }
  }

  async function pollIntakeJob(jobId: string) {
    pollingRef.current = true;
    while (pollingRef.current) {
      const res = await apiFetch(`/api/projects/${projectId}/script/intake/jobs/${jobId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load intake job");
      }
      const status = await res.json() as IntakeJobStatus;
      setIntakeStatus(status);

      if (status.status === "failed") {
        throw new Error(status.error_message || "Script intake failed");
      }
      if (status.status === "awaiting_review") {
        setCandidateText(status.candidate_text || "");
        toast.success(t("reviewReady"));
        return;
      }
      if (status.status === "confirmed") {
        toast.success(t("confirmed"));
        onOpenChange(false);
        onComplete();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  async function handleConfirm() {
    if (!intakeJobId || confirming) return;
    setConfirming(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/script/intake/jobs/${intakeJobId}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: candidateText }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Confirm failed");
      }
      toast.success(t("confirmed"));
      onOpenChange(false);
      onComplete();
    } catch (err) {
      console.error("Confirm script intake error:", err);
      toast.error(err instanceof Error ? err.message : tc("generationFailed"));
    } finally {
      setConfirming(false);
    }
  }

  function resetState() {
    setFile(null);
    setTargetMinutes(10);
    setUploading(false);
    setConfirming(false);
    setDragOver(false);
    setIntakeJobId("");
    setIntakeStatus(null);
    setCandidateText("");
    pollingRef.current = false;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetState();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* Drop zone */}
          <div
            className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : file
                  ? "border-emerald-300 bg-emerald-50/50"
                  : "border-[--border-subtle] bg-[--surface]"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />

            {file ? (
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-emerald-500" />
                <div>
                  <p className="text-sm font-medium text-[--text-primary]">
                    {file.name}
                  </p>
                  <p className="text-xs text-[--text-muted]">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  className="ml-2 flex h-6 w-6 items-center justify-center rounded-full text-[--text-muted] hover:bg-black/5 hover:text-[--text-primary]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="mb-2 h-8 w-8 text-[--text-muted]" />
                <p className="text-sm font-medium text-[--text-primary]">
                  {t("dropHint")}
                </p>
                <p className="mt-1 text-xs text-[--text-muted]">
                  {t("supportedFormats")}
                </p>
              </>
            )}
          </div>

          {intakeStatus && (
            <div className="rounded-lg border border-[--border-subtle] bg-[--surface] p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-[--text-muted]">
                <span>{intakeStatus.current_stage}</span>
                <span>{intakeStatus.progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, intakeStatus.progress))}%` }}
                />
              </div>
            </div>
          )}

          {candidateText && (
            <textarea
              value={candidateText}
              onChange={(e) => setCandidateText(e.target.value)}
              className="min-h-[240px] w-full resize-y rounded-lg border border-[--border-subtle] bg-[--surface] p-3 text-sm text-[--text-primary] outline-none focus:border-primary"
            />
          )}

          {/* Duration slider */}
          {!candidateText && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-[--text-primary]">
                {t("episodeDuration")}
              </label>
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-sm font-semibold text-primary">
                {targetMinutes} {t("minutes")}
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={20}
              step={1}
              value={targetMinutes}
              onChange={(e) => setTargetMinutes(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="mt-1 flex justify-between text-[10px] text-[--text-muted]">
              <span>2 {t("minutes")}</span>
              <span>20 {t("minutes")}</span>
            </div>
          </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {tc("cancel")}
          </DialogClose>
          {candidateText ? (
            <Button onClick={handleConfirm} disabled={confirming || !candidateText.trim()}>
              {confirming ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  {t("confirming")}
                </>
              ) : (
                t("confirm")
              )}
            </Button>
          ) : (
          <Button onClick={handleSubmit} disabled={!file || uploading}>
            {uploading ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                {t("processing")}
              </>
            ) : (
              <>
                <Upload className="mr-1.5 h-4 w-4" />
                {t("upload")}
              </>
            )}
          </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
