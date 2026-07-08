import { db } from "@/lib/db";
import { importStates, projects } from "@/lib/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { ProjectCard } from "@/components/project-card";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { Clapperboard } from "lucide-react";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const locale = await getLocale();
  const cookieStore = await cookies();
  const userId = cookieStore.get("ai_comic_uid")?.value ?? "";

  const allProjects = userId
    ? await db
        .select()
        .from(projects)
        .where(eq(projects.userId, userId))
        .orderBy(desc(projects.createdAt))
    : [];
  const projectIds = allProjects.map((project) => project.id);
  const importDraftProjectIds = projectIds.length
    ? new Set(
        (
          await db
            .select({
              projectId: importStates.projectId,
              currentStep: importStates.currentStep,
              stepStatus: importStates.stepStatus,
            })
            .from(importStates)
            .where(inArray(importStates.projectId, projectIds))
        )
          .filter((state) => {
            const stepStatus = state.stepStatus as Partial<Record<string, string>> | null;
            return state.currentStep > 0 && stepStatus?.[5] !== "done";
          })
          .map((state) => state.projectId),
      )
    : new Set<string>();

  return (
    <div className="animate-page-in space-y-6">
      {/* Page header — same pattern as detail pages */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[--brand-cyan] via-[--brand-blue] to-[--brand-violet] shadow-[0_0_22px_rgba(47,107,255,0.34)]">
            <Clapperboard className="h-4 w-4 text-white" />
          </div>
          <div>
            <h2 className="frame-gradient-text font-display text-xl font-extrabold tracking-tight">
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
        <div className="frame-panel flex flex-col items-center justify-center rounded-lg border-dashed py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-gradient-to-br from-[--brand-cyan] via-[--brand-blue] to-[--brand-violet] shadow-[0_0_32px_rgba(47,107,255,0.35)]">
            <Clapperboard className="h-7 w-7 text-white" />
          </div>
          <h3 className="frame-gradient-text font-display text-lg font-extrabold">
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
              href={
                project.status !== "completed" && importDraftProjectIds.has(project.id)
                  ? `/${locale}/project/${project.id}/import`
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
