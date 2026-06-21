"use client";

import { useTranslations } from "next-intl";
import { useProjectStore } from "@/stores/project-store";
import { apiFetch } from "@/lib/api-fetch";
import { Film, ImageIcon, LayoutGrid } from "lucide-react";
import { toast } from "sonner";

type GenerationMode = "keyframe" | "reference" | "4grid";

const MODE_COLORS: Record<GenerationMode, { active: string; text: string; ring: string }> = {
  keyframe: { active: "bg-white text-primary shadow ring-1 ring-primary/20", text: "text-primary", ring: "ring-primary/20" },
  reference: { active: "bg-white text-violet-600 shadow ring-1 ring-violet-200", text: "text-violet-600", ring: "ring-violet-200" },
  "4grid": { active: "bg-white text-emerald-600 shadow ring-1 ring-emerald-200", text: "text-emerald-600", ring: "ring-emerald-200" },
};

export function GenerationModeTab() {
  const t = useTranslations("project");
  const { project, setProject } = useProjectStore();

  if (!project) return null;

  const mode = (project.generationMode || "keyframe") as GenerationMode;

  async function switchMode(newMode: GenerationMode) {
    if (!project || newMode === mode) return;

    const previous = project;
    setProject({ ...project, generationMode: newMode });

    try {
      const episodeId = useProjectStore.getState().currentEpisodeId;
      const url = episodeId
        ? `/api/projects/${project.id}/episodes/${episodeId}`
        : `/api/projects/${project.id}`;
      await apiFetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationMode: newMode }),
      });
    } catch (err) {
      setProject(previous);
      toast.error(err instanceof Error ? err.message : "Failed to switch mode");
    }
  }

  return (
    <div className="inline-flex gap-1.5 rounded-xl border border-[--border-subtle] bg-[--surface] p-1.5">
      <button
        onClick={() => switchMode("keyframe")}
        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 ${
          mode === "keyframe"
            ? MODE_COLORS.keyframe.active
            : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
        }`}
      >
        <Film className={`h-4 w-4 ${mode === "keyframe" ? MODE_COLORS.keyframe.text : ""}`} />
        {t("generationModeKeyframe")}
      </button>
      <button
        onClick={() => switchMode("reference")}
        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 ${
          mode === "reference"
            ? MODE_COLORS.reference.active
            : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
        }`}
      >
        <ImageIcon className={`h-4 w-4 ${mode === "reference" ? MODE_COLORS.reference.text : ""}`} />
        {t("generationModeReference")}
      </button>
      <button
        onClick={() => switchMode("4grid")}
        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 ${
          mode === "4grid"
            ? MODE_COLORS["4grid"].active
            : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
        }`}
      >
        <LayoutGrid className={`h-4 w-4 ${mode === "4grid" ? MODE_COLORS["4grid"].text : ""}`} />
        {t("generationMode4Grid")}
      </button>
    </div>
  );
}
