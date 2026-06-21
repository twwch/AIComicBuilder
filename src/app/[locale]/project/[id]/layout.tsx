"use client";

import { useEffect, use } from "react";
import { useProjectStore } from "@/stores/project-store";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowLeft, Loader2, Settings, Wand2 } from "lucide-react";
import { LogoIcon } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("common");
  const locale = useLocale();
  const { project, loading, fetchProject, loadedProjectKey } = useProjectStore();

  useEffect(() => {
    if (loadedProjectKey?.startsWith(`${id}:`)) return;
    fetchProject(id, undefined, undefined, true);
  }, [id, fetchProject, loadedProjectKey]);

  if (loading || !project) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-[--text-muted]">{t("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-[--border-subtle] bg-white/80 backdrop-blur-xl px-4 lg:px-6">
        <div className="flex items-center gap-3">
          <Link
            href={`/${locale}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-all hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="h-4 w-px bg-[--border-subtle]" />
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[--primary]/10 text-[--primary]">
              <LogoIcon size={14} />
            </div>
            <h1 className="font-display text-sm font-semibold text-[--text-primary]">
              {project.title}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/${locale}/settings/prompts?scope=project&projectId=${id}`}
            title="项目提示词"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-all hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <Wand2 className="h-4 w-4" />
          </Link>
          <Link
            href={`/${locale}/settings`}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-all hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      {/* Content */}
      {children}
    </div>
  );
}
