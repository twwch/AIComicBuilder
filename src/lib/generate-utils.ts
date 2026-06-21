import { NextResponse } from "next/server";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { characters, storyboardVersions, episodeCharacters, agentBindings, agents, episodes, projects } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { DEFAULT_ASPECT_RATIO, DEFAULT_CHARACTER_IMAGE_SIZE } from "@/lib/config/defaults";
import { callAgent, validateAgentOutput, type AgentCategory } from "@/lib/ai/agent-caller";
import path from "path";

export interface ModelConfig {
  text?: ProviderConfig | null;
  image?: ProviderConfig | null;
  video?: ProviderConfig | null;
}

export interface StoryboardEditReference {
  role: string;
  path: string;
  label?: string;
}

export async function resolveGenerationMode(projectId: string, episodeId?: string | null): Promise<string> {
  if (episodeId) {
    const [ep] = await db.select({ mode: episodes.generationMode }).from(episodes).where(eq(episodes.id, episodeId));
    if (ep?.mode) return ep.mode;
  }
  const [proj] = await db.select({ mode: projects.generationMode }).from(projects).where(eq(projects.id, projectId));
  return proj?.mode ?? "4grid";
}

/** Wrap agent call + validation, returning user-friendly error response on failure */
export async function callAndValidateAgent(
  agent: { platform: string; appId: string; apiKey: string },
  category: AgentCategory,
  prompt: string,
): Promise<{ text: string } | NextResponse> {
  try {
    const rawText = await callAgent(
      { platform: agent.platform as "bailian" | "dify" | "coze", appId: agent.appId, apiKey: agent.apiKey },
      prompt,
    );
    if (category !== "keyframe_prompts" && category !== "video_prompts") {
      validateAgentOutput(category, rawText);
    }
    return { text: rawText };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Agent ${category}] Error:`, message);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

/** Map user-facing ratio string to ImageOptions fields */
export function ratioToImageOpts(ratio?: string): { aspectRatio?: string; size?: string } {
  switch (ratio) {
    case "16:9":  return { aspectRatio: "16:9", size: "2560x1440" };
    case "9:16":  return { aspectRatio: "9:16", size: "1440x2560" };
    case "1:1":   return { aspectRatio: "1:1",  size: "2048x2048" };
    default:      return { aspectRatio: DEFAULT_ASPECT_RATIO, size: DEFAULT_CHARACTER_IMAGE_SIZE };
  }
}

/** Fetch characters linked to an episode via episode_characters, or all project characters if no episode. */
export async function getEpisodeCharacters(projectId: string, epId?: string | null) {
  if (epId) {
    const linkedIds = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, epId));
    if (linkedIds.length > 0) {
      return db.select().from(characters).where(inArray(characters.id, linkedIds.map((r) => r.characterId)));
    }
    return [] as typeof characters.$inferSelect[];
  }
  return db.select().from(characters).where(eq(characters.projectId, projectId));
}

/**
 * Check if a character is visible on-screen by looking for their name
 * in the videoScript or startFrameDesc fields.
 */
export function isCharacterOnScreen(
  characterName: string,
  videoScript: string,
  startFrameDesc: string | null | undefined
): boolean {
  const text = `${videoScript} ${startFrameDesc ?? ""}`;
  return text.includes(characterName);
}

/**
 * Build character mapping prompt prefix for image generation.
 * Includes character name, height, body type, description, and strict
 * proportion enforcement when multiple characters are present.
 */
export function buildCharMappingPrefix(chars: Array<typeof characters.$inferSelect>): string {
  if (chars.length === 0) return "";
  const charMapping = chars.map((c, i) => `图片${i + 1}=${c.name}`).join("，");
  const charDescriptions = chars
    .map((c) => {
      const heightInfo = c.heightCm ? `身高约${c.heightCm}cm` : "";
      const bodyInfo = c.bodyType ? `${c.bodyType}体型` : "";
      const physicalTags = [heightInfo, bodyInfo].filter(Boolean).join("，");
      return `${c.name}${physicalTags ? `（${physicalTags}）` : ""}: ${c.description || ""}`;
    })
    .join("\n");
  const heightHint = chars.length > 1
    ? `\n\n【角色比例严格要求】画面中角色的相对身高/体型必须严格遵循上述身高数据。儿童必须明显小于成人，体型矮小、头身比例符合实际年龄，绝不可画成与成人同等大小。`
    : "";
  return `角色映射：${charMapping}\n\n角色描述：\n${charDescriptions}${heightHint}\n\n严格按照参考图的角色外观（面部、服装、发型）和相对比例生成。\n\n场景描述：`;
}

export async function getVersionedUploadDir(versionId: string | null | undefined): Promise<string> {
  if (!versionId) return process.env.UPLOAD_DIR || "./uploads";
  const [version] = await db
    .select({ label: storyboardVersions.label, projectId: storyboardVersions.projectId })
    .from(storyboardVersions)
    .where(eq(storyboardVersions.id, versionId));
  if (!version) return process.env.UPLOAD_DIR || "./uploads";
  return path.join(process.env.UPLOAD_DIR || "./uploads", "projects", version.projectId, version.label);
}

export function extractErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  try {
    const parsed = JSON.parse(err.message) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {}
  return err.message;
}

export function summarizeProviderConfig(config?: ProviderConfig | null) {
  if (!config) return null;
  return {
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    modelId: config.modelId,
    hasApiKey: Boolean(config.apiKey),
    hasSecretKey: Boolean(config.secretKey),
  };
}

export function logDetailedError(scope: string, err: unknown) {
  if (err instanceof Error) {
    console.error(scope, {
      name: err.name,
      message: err.message,
      cause: err.cause,
      stack: err.stack,
    });
    return;
  }
  console.error(scope, err);
}

export function isComfyUIVideoModel(config?: ProviderConfig | null): boolean {
  return config?.protocol === "comfyui";
}

export function clampComfyUIDuration(duration: number, modelId?: string | null): number {
  const maxDur = modelId?.startsWith("ltx-") ? 30 : 10;
  return Math.max(5, Math.min(maxDur, duration));
}

export function shouldUseStrictJsonMode(config?: ProviderConfig | null): boolean {
  if (!config) return false;
  const baseUrl = config.baseUrl.toLowerCase();
  const modelId = config.modelId.toLowerCase();
  if (baseUrl.includes("integrate.api.nvidia.com") && modelId.includes("kimi")) {
    return false;
  }
  return true;
}

export function collectStoryboardEditReferences(payload?: Record<string, unknown>): StoryboardEditReference[] {
  const refs = (payload?.references as Array<Record<string, unknown>> | undefined) ?? [];
  return refs
    .map((r) => ({
      role: typeof r.role === "string" ? r.role : "reference",
      path: typeof r.path === "string" ? r.path : "",
      label: typeof r.label === "string" ? r.label : undefined,
    }))
    .filter((r) => !!r.path);
}

export async function findBoundAgent(projectId: string, category: AgentCategory) {
  const [binding] = await db
    .select({ agentId: agentBindings.agentId })
    .from(agentBindings)
    .where(
      and(
        eq(agentBindings.projectId, projectId),
        eq(agentBindings.category, category),
      ),
    );
  if (!binding?.agentId) {
    console.log(`[findBoundAgent] ${category}: no binding for project ${projectId}`);
    return null;
  }
  const [agent] = await db.select().from(agents).where(eq(agents.id, binding.agentId));
  console.log(`[findBoundAgent] ${category}: found agent "${agent?.name}" (platform=${agent?.platform}, appId=${agent?.appId?.slice(0, 10)}...)`);
  return agent ?? null;
}
