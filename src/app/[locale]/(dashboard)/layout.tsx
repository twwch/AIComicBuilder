import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoIcon } from "@/components/logo";
import { LogoutButton } from "@/components/auth/logout-button";
import Link from "next/link";
import { Settings, Wand2 } from "lucide-react";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("common");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-[--border-subtle] bg-white/80 backdrop-blur-xl px-4 lg:px-6">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[--primary]/10 text-[--primary]">
            <LogoIcon size={14} />
          </div>
          <span className="font-display text-sm font-semibold text-[--text-primary]">
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
          <LogoutButton />
          <LanguageSwitcher />
        </div>
      </header>
      <main className="flex-1 bg-[--surface] p-6 lg:p-8">{children}</main>
    </div>
  );
}
