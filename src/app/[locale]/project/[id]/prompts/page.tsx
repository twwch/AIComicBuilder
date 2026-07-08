"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wand2 } from "lucide-react";
import { ProjectPromptCards } from "@/components/prompt-templates/project-prompt-cards";
import { useTranslations } from "next-intl";

export default function ProjectPromptsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const t = useTranslations("promptTemplates");

  return (
    <div className="flex-1 overflow-y-auto bg-frame-grid p-6">
      {/* Page header */}
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[--brand-cyan] via-[--brand-blue] to-[--brand-violet] shadow-[0_0_22px_rgba(47,107,255,0.34)]">
            <Wand2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="frame-gradient-text font-display text-xl font-extrabold tracking-tight">
              {t("title")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {t("project.useProjectPromptsDesc")}
            </p>
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="mx-auto max-w-5xl">
        <ProjectPromptCards projectId={projectId} />
      </div>
    </div>
  );
}
