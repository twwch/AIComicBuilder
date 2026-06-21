import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { ProjectCard } from "@/components/project-card";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { Clapperboard } from "lucide-react";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const cookieStore = await cookies();
  const uidCookie = cookieStore.get("ai_comic_uid")?.value ?? "";
  const authCookie = cookieStore.get("ai_comic_auth")?.value ?? "";
  const authUid = authCookie.match(/^([a-f0-9]{32})\./i)?.[1] ?? "";
  const cookieUid = /^[a-f0-9]{32}$/i.test(uidCookie) ? uidCookie : "";
  const userId = authUid || cookieUid;

  const allProjects = userId
    ? await db
        .select()
        .from(projects)
        .where(eq(projects.userId, userId))
        .orderBy(desc(projects.createdAt))
    : [];

  return (
    <div className="animate-page-in space-y-6">
      {/* Page header — same pattern as detail pages */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Clapperboard className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("title")}
            </h2>
            {allProjects.length > 0 && (
              <p className="text-xs text-[--text-muted]">
                {allProjects.length}{" "}
                {allProjects.length === 1 ? "project" : "projects"}
              </p>
            )}
          </div>
        </div>
        <CreateProjectDialog />
      </div>

      {allProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Clapperboard className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-display text-lg font-semibold text-[--text-primary]">
            {t("title")}
          </h3>
          <p className="mt-2 max-w-sm text-center text-sm text-[--text-secondary]">
            {t("noProjects")}
          </p>
          <div className="mt-6">
            <CreateProjectDialog />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allProjects.map((project) => (
            <ProjectCard
              key={project.id}
              id={project.id}
              title={project.title}
              status={project.status}
              createdAt={project.createdAt.toISOString()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
