import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoIcon } from "@/components/logo";
import Link from "next/link";
import { Settings, Wand2 } from "lucide-react";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("common");

  return (
    <div className="flex min-h-screen flex-col bg-frame-grid">
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-[--border-subtle] bg-[#070A10]/88 px-4 backdrop-blur-xl lg:px-6">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-[--brand-cyan] via-[--brand-blue] to-[--brand-violet] text-white shadow-[0_0_18px_rgba(47,107,255,0.35)]">
            <LogoIcon size={14} />
          </div>
          <span className="frame-gradient-text font-display text-sm font-extrabold">
            {t("appName")}
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/prompts"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
            title={t("promptTemplates")}
          >
            <Wand2 className="h-4 w-4" />
          </Link>
          <Link
            href="/settings"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-[--surface] hover:text-[--text-primary]"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="flex-1 bg-transparent p-6 lg:p-8">{children}</main>
    </div>
  );
}
