"use client";

import { useEffect, use } from "react";
import { useProjectStore } from "@/stores/project-store";
import { ProjectNav } from "@/components/editor/project-nav";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

export default function EpisodeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string; episodeId: string }>;
}) {
  const { id, episodeId } = use(params);
  const t = useTranslations("common");
  const { project, loading, fetchProject, loadedProjectKey } = useProjectStore();

  useEffect(() => {
    if (loadedProjectKey?.startsWith(`${id}:${episodeId}:`)) return;
    fetchProject(id, episodeId, undefined, true);
  }, [id, episodeId, fetchProject, loadedProjectKey]);

  if (loading || !project) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="ml-2 text-sm text-[--text-muted]">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1">
      <ProjectNav projectId={id} episodeId={episodeId} />
      <main className="flex-1 bg-[--surface] p-6 pb-24 lg:pb-6 min-w-0">
        {children}
      </main>
    </div>
  );
}
