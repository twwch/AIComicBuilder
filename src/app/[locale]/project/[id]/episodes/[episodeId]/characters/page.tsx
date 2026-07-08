"use client";

import { useState } from "react";
import { useProjectStore } from "@/stores/project-store";
import { useModelStore } from "@/stores/model-store";
import { CharacterCard } from "@/components/editor/character-card";
import { CharacterRelations } from "@/components/editor/character-relations";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { Users, Sparkles, Loader2 } from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { apiFetch } from "@/lib/api-fetch";
import { useModelGuard } from "@/hooks/use-model-guard";
import { PromptEditButton } from "@/components/prompt-templates/prompt-edit-button";
import { AgentPicker } from "@/components/agent-picker";
import { toast } from "sonner";

export default function EpisodeCharactersPage() {
  const t = useTranslations();
  const { project, fetchProject } = useProjectStore();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [extracting, setExtracting] = useState(false);
  const textGuard = useModelGuard("text");

  if (!project) return null;

  async function handleExtractCharacters() {
    if (!project) return;
    if (!textGuard()) return;
    setExtracting(true);

    try {
      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "character_extract",
          modelConfig: getModelConfig(),
          episodeId: useProjectStore.getState().currentEpisodeId,
        }),
      });

      if (!response.ok) {
        throw new Error("Character extract failed");
      }

      await response.json();
    } catch (err) {
      console.error("Character extract error:", err);
      toast.error(t("common.generationFailed"));
    }

    setExtracting(false);
    fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
  }

  return (
    <div className="animate-page-in space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("project.characters")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {project.characters.length} characters
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AgentPicker projectId={project.id} category="character_extract" />
          <InlineModelPicker capability="text" />
          <Button
            onClick={handleExtractCharacters}
            disabled={extracting}
            variant="default"
            size="sm"
          >
            {extracting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {extracting ? t("common.generating") : t("project.extractCharacters")}
          </Button>
          <PromptEditButton promptKeys="character_extract" projectId={project.id} />
        </div>
      </div>

      {project.characters.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Users className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("project.characters")}
          </h3>
          <p className="mt-2 max-w-sm text-center text-sm text-[--text-secondary]">
            {t("character.noCharacters")}
          </p>
        </div>
      ) : (
        <>
        {project.characters.length >= 2 && (
          <div className="mb-4">
            <CharacterRelations
              projectId={project.id}
              characters={project.characters.map((c) => ({ id: c.id, name: c.name }))}
            />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {project.characters.map((char) => (
            <CharacterCard
              key={char.id}
              id={char.id}
              projectId={project.id}
              name={char.name}
              description={char.description}
              visualHint={char.visualHint ?? null}
              referenceImage={char.referenceImage}
              referenceImageHistory={char.referenceImageHistory}
              onUpdate={() => fetchProject(project.id, useProjectStore.getState().currentEpisodeId!)}
              scope={char.scope}
              onPromote={
                char.scope === "guest"
                  ? async () => {
                      await apiFetch(
                        `/api/projects/${project.id}/characters/${char.id}`,
                        {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ scope: "main", episodeId: null }),
                        }
                      );
                      fetchProject(project.id, useProjectStore.getState().currentEpisodeId!);
                    }
                  : undefined
              }
            />
          ))}
        </div>
        </>
      )}
    </div>
  );
}
