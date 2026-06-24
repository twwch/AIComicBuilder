"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";

export function LogoutButton() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("auth");

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push(`/${locale}/login`);
    router.refresh();
  }

  return (
    <Button variant="ghost" size="icon-sm" onClick={() => void logout()}>
      <LogOut className="h-4 w-4" />
      <span className="sr-only">{t("logout")}</span>
    </Button>
  );
}
