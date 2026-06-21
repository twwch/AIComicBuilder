"use client";

import { useEffect, useState, useMemo, useCallback, use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { CharacterCard } from "@/components/editor/character-card";
import { CharacterRelations } from "@/components/editor/character-relations";
import Link from "next/link";
import { toast } from "sonner";

interface Character {
  id: string;
  projectId: string;
  name: string;
  description: string;
  visualHint: string | null;
  referenceImage: string | null;
  referenceImageHistory: string | null;
  scope: string;
  episodeId: string | null;
}

interface Episode {
  id: string;
  title: string;
  sequence: number;
}

export default function CharactersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const locale = useLocale();
  const t = useTranslations();
  const tc = useTranslations("common");
  const tChar = useTranslations("character");

  const [characters, setCharacters] = useState<Character[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [chars, eps] = await Promise.all([
      apiFetch(`/api/projects/${projectId}/characters`).then((r) => r.json()),
      apiFetch(`/api/projects/${projectId}/episodes`).then((r) => r.json()),
    ]);
    setCharacters(chars);
    setEpisodes(eps);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const mainCharacters = useMemo(
    () => characters.filter((c) => c.scope === "main"),
    [characters]
  );

  const guestByEpisode = useMemo(() => {
    const map = new Map<string, Character[]>();
    for (const c of characters) {
      if (c.scope === "guest" && c.episodeId) {
        const list = map.get(c.episodeId) || [];
        list.push(c);
        map.set(c.episodeId, list);
      }
    }
    return map;
  }, [characters]);

  const episodeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ep of episodes) {
      map.set(ep.id, ep.title);
    }
    return map;
  }, [episodes]);

  const guestCount = useMemo(
    () => characters.filter((c) => c.scope === "guest").length,
    [characters]
  );

  async function handlePromote(characterId: string) {
    await apiFetch(`/api/projects/${projectId}/characters/${characterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "main" }),
    });
    fetchData();
  }

  async function handleDelete(characterId: string, name: string) {
    if (!confirm(tChar("deleteConfirm", { name }))) return;
    await apiFetch(`/api/projects/${projectId}/characters/${characterId}`, {
      method: "DELETE",
    });
    toast.success(tc("delete"));
    fetchData();
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-[--text-muted]">{tc("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[--surface] p-6 pb-24 lg:pb-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/${locale}/project/${projectId}/episodes`}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/8 transition-colors hover:bg-primary/15"
          >
            <ArrowLeft className="h-5 w-5 text-primary" />
          </Link>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {tChar("management")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {characters.length} {t("episode.count")}
            </p>
          </div>
        </div>
      </div>

      {/* Main Characters Section */}
      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {tChar("mainSection")}
          </h3>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-100 px-1.5 text-[11px] font-semibold text-blue-700">
            {mainCharacters.length}
          </span>
        </div>
        {mainCharacters.length === 0 ? (
          <div className="flex min-h-[120px] items-center justify-center rounded-2xl border border-dashed border-[--border-subtle] bg-white/50 p-6">
            <p className="text-sm text-[--text-muted]">{tChar("noMain")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 xl:grid-cols-4">
            {mainCharacters.map((char) => (
              <CharacterCard
                key={char.id}
                id={char.id}
                projectId={projectId}
                name={char.name}
                description={char.description}
                visualHint={char.visualHint}
                referenceImage={char.referenceImage}
                referenceImageHistory={char.referenceImageHistory}
                scope={char.scope}
                onUpdate={fetchData}
                onDelete={() => handleDelete(char.id, char.name)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Character Relations */}
      {characters.length >= 2 && (
        <section className="mb-8">
          <CharacterRelations
            projectId={projectId}
            characters={characters.map((c) => ({ id: c.id, name: c.name }))}
          />
        </section>
      )}

      {/* Guest Characters Section */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {tChar("guestSection")}
          </h3>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-purple-100 px-1.5 text-[11px] font-semibold text-purple-700">
            {guestCount}
          </span>
        </div>
        {guestCount === 0 ? (
          <div className="flex min-h-[120px] items-center justify-center rounded-2xl border border-dashed border-[--border-subtle] bg-white/50 p-6">
            <p className="text-sm text-[--text-muted]">{tChar("noGuest")}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {episodes
              .filter((ep) => guestByEpisode.has(ep.id))
              .map((ep) => (
                <div key={ep.id}>
                  <h4 className="mb-3 text-sm font-medium text-[--text-secondary]">
                    EP.{String(ep.sequence).padStart(2, "0")} —{" "}
                    {episodeNameMap.get(ep.id)}
                  </h4>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 xl:grid-cols-4">
                    {guestByEpisode.get(ep.id)!.map((char) => (
                      <CharacterCard
                        key={char.id}
                        id={char.id}
                        projectId={projectId}
                        name={char.name}
                        description={char.description}
                        visualHint={char.visualHint}
                        referenceImage={char.referenceImage}
                        referenceImageHistory={char.referenceImageHistory}
                        scope={char.scope}
                        episodeName={`EP.${String(ep.sequence).padStart(2, "0")} ${ep.title}`}
                        onUpdate={fetchData}
                        onPromote={() => handlePromote(char.id)}
                        onDelete={() => handleDelete(char.id, char.name)}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
