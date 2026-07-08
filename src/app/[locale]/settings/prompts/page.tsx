"use client";

import { PromptEditor } from "@/components/prompt-templates/prompt-editor";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function PromptSettingsPage() {
  const t = useTranslations("promptTemplates");
  const router = useRouter();
  const searchParams = useSearchParams();

  const scope = (searchParams.get("scope") as "global" | "project") || "global";
  const projectId = searchParams.get("projectId") || undefined;
  const initialPromptKey = searchParams.get("prompt") || undefined;
  const isProject = scope === "project" && !!projectId;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-frame-grid">
      {/* Header */}
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-[--border-subtle] bg-[#070A10]/88 px-4 backdrop-blur-xl lg:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-[--brand-cyan] via-[--brand-blue] to-[--brand-violet] text-white shadow-[0_0_18px_rgba(47,107,255,0.35)]">
              <Wand2 className="h-3.5 w-3.5" />
            </div>
            <div className="flex items-center gap-2">
              <span className="frame-gradient-text font-display text-sm font-extrabold">
                {t("title")}
              </span>
              {isProject ? (
                <Badge variant="default" className="text-[10px]">
                  {t("project.useProjectPrompts")}
                </Badge>
              ) : (
                <span className="text-xs text-[--text-muted]">
                  {t("subtitle")}
                </span>
              )}
            </div>
          </div>
        </div>
        <LanguageSwitcher />
      </header>

      <main className="flex flex-1 flex-col overflow-hidden bg-transparent p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col overflow-hidden animate-page-in">
          <PromptEditor
            scope={scope}
            projectId={projectId}
            initialPromptKey={initialPromptKey}
          />
        </div>
      </main>
    </div>
  );
}
