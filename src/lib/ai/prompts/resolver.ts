import { db } from "@/lib/db";
import { promptTemplates } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getPromptDefinition, getDefaultSlotContents } from "./registry";

interface ResolveOptions {
  userId: string;
  projectId?: string;
}

/**
 * Resolve a prompt's system content by merging:
 *   project-level overrides > global overrides > code defaults
 */
export async function resolvePrompt(
  promptKey: string,
  options: ResolveOptions,
  params?: Record<string, unknown>
): Promise<string> {
  const def = getPromptDefinition(promptKey);
  if (!def) {
    throw new Error(`Unknown prompt key: ${promptKey}`);
  }

  const slotContents = getDefaultSlotContents(promptKey) ?? {};

  // Check for full-prompt override first (advanced mode, slotKey = null)
  const fullOverrides = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, options.userId),
        eq(promptTemplates.promptKey, promptKey),
        isNull(promptTemplates.slotKey)
      )
    );

  // Find project-level full override, then global
  const projectFull = fullOverrides.find(
    (o) => o.scope === "project" && o.projectId === options.projectId
  );
  const globalFull = fullOverrides.find((o) => o.scope === "global");

  if (options.projectId && projectFull) {
    return projectFull.content;
  }
  if (globalFull) {
    return globalFull.content;
  }

  // No full override — resolve slot by slot
  const slotOverrides = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, options.userId),
        eq(promptTemplates.promptKey, promptKey)
      )
    );

  for (const slotKey of Object.keys(slotContents)) {
    // Project-level slot override
    if (options.projectId) {
      const projectSlot = slotOverrides.find(
        (o) =>
          o.slotKey === slotKey &&
          o.scope === "project" &&
          o.projectId === options.projectId
      );
      if (projectSlot) {
        slotContents[slotKey] = projectSlot.content;
        continue;
      }
    }
    // Global slot override
    const globalSlot = slotOverrides.find(
      (o) => o.slotKey === slotKey && o.scope === "global"
    );
    if (globalSlot) {
      slotContents[slotKey] = globalSlot.content;
    }
  }

  return def.buildFullPrompt(slotContents, params);
}

/**
 * Resolve slot contents without building the full prompt.
 * Used for prompts that need dynamic parameters (frame, video, etc.)
 */
export async function resolveSlotContents(
  promptKey: string,
  options: ResolveOptions
): Promise<Record<string, string>> {
  const def = getPromptDefinition(promptKey);
  if (!def) {
    throw new Error(`Unknown prompt key: ${promptKey}`);
  }

  const slotContents = getDefaultSlotContents(promptKey) ?? {};

  const overrides = await db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, options.userId),
        eq(promptTemplates.promptKey, promptKey)
      )
    );

  for (const slotKey of Object.keys(slotContents)) {
    if (options.projectId) {
      const projectSlot = overrides.find(
        (o) =>
          o.slotKey === slotKey &&
          o.scope === "project" &&
          o.projectId === options.projectId
      );
      if (projectSlot) {
        slotContents[slotKey] = projectSlot.content;
        continue;
      }
    }
    const globalSlot = overrides.find(
      (o) => o.slotKey === slotKey && o.scope === "global"
    );
    if (globalSlot) {
      slotContents[slotKey] = globalSlot.content;
    }
  }

  return slotContents;
}
