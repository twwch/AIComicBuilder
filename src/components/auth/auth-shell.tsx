"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, UserPlus } from "lucide-react";
import { LogoIcon } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api-fetch";

type AuthMode = "login" | "register";

export function AuthShell({ initialMode }: { initialMode: AuthMode }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      await apiFetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      router.push(`/${locale}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t("unknownError"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#fff1ec,transparent_32%),linear-gradient(180deg,#fff,#fff8f4_45%,#fff)] px-4 py-10">
      <div className="w-full max-w-md rounded-[28px] border border-[--border-subtle] bg-white/95 p-8 shadow-[0_20px_60px_rgba(18,18,18,0.08)]">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/20">
            <LogoIcon size={20} />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold text-[--text-primary]">
              {mode === "login" ? t("loginTitle") : t("registerTitle")}
            </h1>
            <p className="text-sm text-[--text-secondary]">
              {mode === "login" ? t("loginSubtitle") : t("registerSubtitle")}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  void submit();
                }
              }}
            />
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          ) : null}

          <Button
            className="w-full"
            disabled={submitting || !email.trim() || !password.trim()}
            onClick={() => void submit()}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === "login" ? (
              <LogIn className="h-4 w-4" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {mode === "login" ? t("loginAction") : t("registerAction")}
          </Button>

          <button
            type="button"
            className="w-full text-sm text-[--text-secondary] transition hover:text-[--text-primary]"
            onClick={() => {
              setError("");
              setMode(mode === "login" ? "register" : "login");
            }}
          >
            {mode === "login" ? t("switchToRegister") : t("switchToLogin")}
          </button>
        </div>
      </div>
    </div>
  );
}
