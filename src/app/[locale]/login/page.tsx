import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { getCurrentUser } from "@/lib/auth/session";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getCurrentUser();
  if (user) {
    redirect(`/${locale}`);
  }

  return <AuthShell initialMode="login" />;
}
