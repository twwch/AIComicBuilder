"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Edit, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

// ── Types ─────────────────────────────────────────────────

interface PromptSlot {
  key: string;
  nameKey: string;
  descriptionKey: string;
  defaultContent: string;
  editable: boolean;
}

interface RegistryEntry {
  key: string;
  nameKey: string;
  descriptionKey: string;
  category: string;
  slots: PromptSlot[];
}

interface ProjectPromptTemplate {
  id: string;
  promptKey: string;
  slotKey: string | null;
  scope: string;
  projectId: string;
  content: string;
}

// ── Category icon/emoji map ───────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
  script: "📝",
  character: "👤",
  shot: "🎬",
  frame: "🖼️",
  video: "🎥",
};

/** Strip "promptTemplates." prefix from registry nameKeys since t() is already scoped */
function tKey(nameKey: string): string {
  return nameKey.replace(/^promptTemplates\./, "");
}

// ── Toggle Switch ─────────────────────────────────────────

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}

function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <div
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-visible:outline-none ${
          checked ? "bg-primary" : "bg-[--border-subtle]"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
      <span className="text-sm font-medium text-[--text-primary]">{label}</span>
    </label>
  );
}

// ── Main component ────────────────────────────────────────

interface ProjectPromptCardsProps {
  projectId: string;
}

export function ProjectPromptCards({ projectId }: ProjectPromptCardsProps) {
  const locale = useLocale();
  const t = useTranslations("promptTemplates");

  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [overrides, setOverrides] = useState<ProjectPromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  // Fetch registry + project overrides + project settings on mount
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [regResp, overResp, projResp] = await Promise.all([
        apiFetch("/api/prompt-templates/registry"),
        apiFetch(`/api/projects/${projectId}/prompt-templates`),
        apiFetch(`/api/projects/${projectId}`),
      ]);
      const regData: RegistryEntry[] = await regResp.json();
      const overData: ProjectPromptTemplate[] = await overResp.json();
      const projData = await projResp.json();
      setRegistry(regData);
      setOverrides(overData);
      setEnabled(!!projData.useProjectPrompts);
    } catch {
      toast.error("Load failed");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute per-prompt stats
  function getPromptStats(entry: RegistryEntry) {
    const promptOverrides = overrides.filter(
      (o) => o.promptKey === entry.key
    );
    const hasOverride = promptOverrides.length > 0;
    const editableSlots = entry.slots.filter((s) => s.editable);
    const modifiedSlotKeys = new Set(promptOverrides.map((o) => o.slotKey));
    const modifiedCount = editableSlots.filter((s) =>
      modifiedSlotKeys.has(s.key)
    ).length;
    return { hasOverride, totalSlots: editableSlots.length, modifiedCount };
  }

  // Toggle: persist via PATCH /api/projects/:id
  const handleToggle = async (value: boolean) => {
    try {
      await apiFetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useProjectPrompts: value ? 1 : 0 }),
      });
      setEnabled(value);
      if (!value && overrides.length > 0) {
        // Turning off — also delete all project overrides
        const promptKeys = [...new Set(overrides.map((o) => o.promptKey))];
        await Promise.all(
          promptKeys.map((pk) =>
            apiFetch(`/api/projects/${projectId}/prompt-templates/${pk}`, {
              method: "DELETE",
            })
          )
        );
        setOverrides([]);
        toast.success(t("editor.resetSuccess"));
      }
    } catch {
      toast.error("Save failed");
    }
  };

  // Delete all project-level overrides for a promptKey
  async function handleUseGlobal(promptKey: string) {
    setDeletingKey(promptKey);
    try {
      const resp = await apiFetch(
        `/api/projects/${projectId}/prompt-templates/${promptKey}`,
        { method: "DELETE" }
      );
      if (!resp.ok && resp.status !== 204) {
        throw new Error("Delete failed");
      }
      const overResp = await apiFetch(
        `/api/projects/${projectId}/prompt-templates`
      );
      const overData: ProjectPromptTemplate[] = await overResp.json();
      setOverrides(overData);
      toast.success(t("editor.resetSuccess"));
    } catch {
      toast.error("Failed");
    } finally {
      setDeletingKey(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-[--text-muted]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Toggle header */}
      <div className="flex items-center justify-between rounded-2xl border border-[--border-subtle] bg-white p-4">
        <div className="flex flex-col gap-0.5">
          <ToggleSwitch
            checked={enabled}
            onChange={handleToggle}
            label={t("project.useProjectPrompts")}
          />
          <p className="ml-12 text-xs text-[--text-muted]">
            {t("project.useProjectPromptsDesc")}
          </p>
        </div>
        {enabled && overrides.length > 0 && (
          <Badge variant="default" className="shrink-0">
            {t("editor.overridden")} ({overrides.length})
          </Badge>
        )}
      </div>

      {/* Card grid */}
      {enabled && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {registry.map((entry) => {
            const { hasOverride, totalSlots, modifiedCount } =
              getPromptStats(entry);
            const emoji = CATEGORY_EMOJI[entry.category] ?? "💬";
            const isDeleting = deletingKey === entry.key;
            const editUrl = `/${locale}/settings/prompts?scope=project&projectId=${projectId}&prompt=${entry.key}`;

            return (
              <div
                key={entry.key}
                className="flex flex-col gap-3 rounded-2xl border border-[--border-subtle] bg-white p-4 transition-shadow hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base ${
                      hasOverride ? "bg-primary/10" : "bg-[--surface]"
                    }`}
                  >
                    {emoji}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[--text-primary]">
                        {t(tKey(entry.nameKey) as Parameters<typeof t>[0])}
                      </span>
                      {hasOverride ? (
                        <Badge variant="success" className="shrink-0 text-[10px] px-1.5 py-0">
                          {t("editor.overridden")}
                        </Badge>
                      ) : (
                        <Badge className="shrink-0 text-[10px] px-1.5 py-0 bg-[--surface] text-[--text-muted]">
                          {t("editor.usingGlobal")}
                        </Badge>
                      )}
                    </div>
                    <span className="truncate font-mono text-[10px] text-[--text-muted]">
                      {entry.key}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-[--text-secondary]">
                  {t("editor.slotsCount", { count: totalSlots })}
                  {hasOverride && modifiedCount > 0
                    ? `, ${t("project.modifiedCount", { count: modifiedCount })}`
                    : ""}
                </p>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => { window.location.href = editUrl; }}
                  >
                    <Edit className="h-3.5 w-3.5" />
                    {t("editor.edit")}
                  </Button>
                  {hasOverride && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1 text-[--text-muted] hover:text-destructive"
                      disabled={isDeleting}
                      onClick={() => handleUseGlobal(entry.key)}
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      {t("project.useGlobal")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
