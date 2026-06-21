"use client";

import { useEffect, useState } from "react";
import { usePromptTemplateStore } from "@/stores/prompt-template-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { Save, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";

interface AdvancedEditorProps {
  scope?: "global" | "project";
  projectId?: string;
}

export function AdvancedEditor({ scope = "global", projectId }: AdvancedEditorProps) {
  const isProject = scope === "project" && !!projectId;
  const templatesBasePath = isProject
    ? `/api/projects/${projectId}/prompt-templates`
    : "/api/prompt-templates";
  const t = useTranslations("promptTemplates");
  const {
    selectedPromptKey,
    registry,
    fullTextContent,
    setFullTextContent,
    getSlotContent,
    clearEdits,
    setServerOverrides,
  } = usePromptTemplateStore();

  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showWarnings, setShowWarnings] = useState(false);

  const prompt = registry.find((r) => r.key === selectedPromptKey);

  // Initialize full text from assembled slots when switching to advanced mode
  useEffect(() => {
    if (!prompt || !selectedPromptKey) return;

    const loadFullText = async () => {
      try {
        const slots: Record<string, string> = {};
        for (const slot of prompt.slots) {
          slots[slot.key] = getSlotContent(selectedPromptKey, slot.key);
        }
        const resp = await apiFetch("/api/prompt-templates/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ promptKey: selectedPromptKey, slots }),
        });
        const data = await resp.json();
        setFullTextContent(data.fullPrompt ?? "");
      } catch {
        // ignore
      }
    };

    if (!fullTextContent) {
      loadFullText();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPromptKey]);

  if (!prompt || !selectedPromptKey) return null;

  const handleValidateAndSave = async () => {
    setSaving(true);
    try {
      // Validate first
      const validateResp = await apiFetch("/api/prompt-templates/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptKey: selectedPromptKey,
          content: fullTextContent,
        }),
      });
      const validateData = await validateResp.json();

      if (!validateData.valid) {
        setWarnings(validateData.warnings);
        setShowWarnings(true);
        setSaving(false);
        return;
      }

      await doSave();
    } catch {
      toast.error("Validation failed");
      setSaving(false);
    }
  };

  const doSave = async () => {
    try {
      await apiFetch(`${templatesBasePath}/${selectedPromptKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "full",
          content: fullTextContent,
        }),
      });

      // Refresh overrides
      const resp = await apiFetch(templatesBasePath);
      const data = await resp.json();
      setServerOverrides(data);
      clearEdits(selectedPromptKey);
      setShowWarnings(false);
      toast.success(t("editor.savedSuccess"));
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      await apiFetch(`${templatesBasePath}/${selectedPromptKey}`, {
        method: "DELETE",
      });
      // Refresh
      const resp = await apiFetch(templatesBasePath);
      const data = await resp.json();
      setServerOverrides(data);
      clearEdits(selectedPromptKey);
      setFullTextContent("");
      toast.success(t("editor.resetSuccess"));
    } catch {
      toast.error("Reset failed");
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
      {/* Warning banner */}
      {showWarnings && warnings.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="mb-1 text-sm font-semibold text-amber-800">
            {t("editor.structureChanged")}
          </div>
          <div className="mb-2 text-xs text-amber-700">
            {t("editor.structureChangedDesc")}
          </div>
          <ul className="mb-3 list-inside list-disc text-xs text-amber-700">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setSaving(true);
                doSave();
              }}
            >
              {t("editor.saveAnyway")}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setShowWarnings(false);
                setFullTextContent("");
              }}
            >
              {t("editor.restoreSection")}
            </Button>
          </div>
        </div>
      )}

      {/* Editor area */}
      <div className="flex items-center justify-between">
        <Badge variant="warning">{t("editor.advancedMode")}</Badge>
        <div className="flex gap-2">
          <Button size="xs" variant="ghost" onClick={handleReset}>
            <RotateCcw className="h-3 w-3" />
            {t("editor.resetDefault")}
          </Button>
          <Button
            size="xs"
            onClick={handleValidateAndSave}
            disabled={saving || !fullTextContent}
          >
            <Save className="h-3 w-3" />
            {t("editor.save")}
          </Button>
        </div>
      </div>

      <textarea
        value={fullTextContent}
        onChange={(e) => setFullTextContent(e.target.value)}
        className="flex-1 resize-none overflow-y-auto rounded-xl border border-[--border-subtle] bg-white px-3.5 py-3 font-mono text-[11px] leading-relaxed text-[--text-primary] outline-none transition-all duration-200 placeholder:text-[--text-muted] hover:border-[--border-hover] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15"
        placeholder={t("editor.advancedMode")}
      />
    </div>
  );
}
