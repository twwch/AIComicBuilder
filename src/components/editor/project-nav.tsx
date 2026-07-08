"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { FileText, Users, Film, Play, ArrowLeft } from "lucide-react";

interface ProjectNavProps {
  projectId: string;
  episodeId: string;
}

const icons = [FileText, Users, Film, Play];

export function ProjectNav({ projectId, episodeId }: ProjectNavProps) {
  const t = useTranslations("project");
  const tEpisode = useTranslations("episode");
  const locale = useLocale();
  const pathname = usePathname();

  const basePath = `/${locale}/project/${projectId}/episodes/${episodeId}`;

  const tabs = [
    { key: "script", href: `${basePath}/script`, num: 1 },
    { key: "characters", href: `${basePath}/characters`, num: 2 },
    { key: "storyboard", href: `${basePath}/storyboard`, num: 3 },
    { key: "preview", href: `${basePath}/preview`, num: 4 },
  ] as const;

  return (
    <>
      {/* Desktop sidebar — stays fixed relative to the header (h-14),
          doesn't scroll with the main content on the right. */}
      <nav className="hidden w-60 flex-shrink-0 border-r border-[--border-subtle] bg-[#070A10]/88 backdrop-blur-xl lg:block self-start sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
        <div className="flex flex-col gap-1 p-3 pt-4">
          <Link
            href={`/${locale}/project/${projectId}/episodes`}
            className="flex items-center gap-2 px-3 py-2 text-xs text-[--text-muted] hover:text-[--text-primary]"
          >
            <ArrowLeft className="h-3 w-3" />
            {tEpisode("backToList")}
          </Link>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
            Workflow
          </p>
          {tabs.map((tab, i) => {
            const isActive = pathname === tab.href;
            const Icon = icons[i];
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "border border-primary/35 bg-primary/12 text-primary shadow-[0_0_24px_rgba(47,107,255,0.16)]"
                    : "text-[--text-secondary] hover:bg-[--surface] hover:text-[--text-primary]"
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                )}
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold transition-all duration-200",
                    isActive
                      ? "bg-gradient-to-br from-[--brand-cyan] via-[--brand-blue] to-[--brand-violet] text-white shadow-sm shadow-primary/25"
                      : "bg-[--surface] text-[--text-muted] group-hover:bg-primary/10 group-hover:text-primary"
                  )}
                >
                  {tab.num}
                </span>
                <Icon className="h-4 w-4" />
                <span>{t(tab.key)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[--border-subtle] bg-[#070A10]/92 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-around py-1.5">
          {tabs.map((tab, i) => {
            const isActive = pathname === tab.href;
            const Icon = icons[i];
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-4 py-1.5 text-[11px] font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-[--text-muted] active:text-[--text-secondary]"
                )}
              >
                <div className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                  isActive && "bg-primary/8"
                )}>
                  <Icon className="h-4 w-4" />
                </div>
                <span>{t(tab.key)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
