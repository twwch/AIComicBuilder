import { db } from "@/lib/db";
import { shots, characters, episodeCharacters, scenes } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  loadShotLegacyView,
  type ShotAssetType,
} from "@/lib/shot-asset-utils";

export interface ReadinessEntry {
  shotId: string;
  sequence: number;
  status: "ready" | "blocked" | "completed" | "unknown";
  missing: string[];
  warnings: string[];
}

const KEYFRAME_TYPES: ShotAssetType[] = ["first_frame", "last_frame"];

export async function getShotReadiness(
  shot: typeof shots.$inferSelect,
  projectId: string,
  episodeId?: string | null
): Promise<ReadinessEntry> {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!shot.prompt || shot.prompt.trim() === "") {
    missing.push("shot_prompt");
  }

  const legacy = await loadShotLegacyView(shot.id);

  const hasKeyframePrompt = (type: ShotAssetType): boolean => {
    const asset = legacy.startFrameDesc && type === "first_frame"
      ? { prompt: legacy.startFrameDesc }
      : legacy.endFrameDesc && type === "last_frame"
        ? { prompt: legacy.endFrameDesc }
        : null;
    return !!asset;
  };

  const hasFirstFrame = hasKeyframePrompt("first_frame");
  const hasLastFrame = hasKeyframePrompt("last_frame");

  if (!hasFirstFrame) missing.push("first_frame_prompt");
  if (!hasLastFrame) missing.push("last_frame_prompt");

  if (shot.sceneId) {
    const scene = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(eq(scenes.id, shot.sceneId))
      .limit(1);
    if (scene.length === 0) {
      warnings.push("scene_not_found");
    }
  }

  if (shot.costumeOverrides) {
    try {
      const parsed = JSON.parse(shot.costumeOverrides);
      if (typeof parsed === "object" && parsed !== null) {
        for (const [charName, costume] of Object.entries(parsed)) {
          if (!costume || (typeof costume === "string" && costume.trim() === "")) {
            warnings.push(`empty_costume:${charName}`);
          }
        }
      }
    } catch {
      warnings.push("invalid_costume_overrides_json");
    }
  }

  let charRows: typeof characters.$inferSelect[];
  if (episodeId) {
    const linkedIds = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    charRows = linkedIds.length > 0
      ? await db.select().from(characters).where(inArray(characters.id, linkedIds.map((r) => r.characterId)))
      : await db.select().from(characters).where(eq(characters.projectId, projectId));
  } else {
    charRows = await db.select().from(characters).where(eq(characters.projectId, projectId));
  }

  for (const c of charRows) {
    if (!c.referenceImage) {
      warnings.push(`no_ref_image:${c.name || c.id}`);
    }
  }

  const status: ReadinessEntry["status"] =
    missing.length > 0 ? "blocked"
    : shot.status === "completed" ? "completed"
    : "ready";

  return { shotId: shot.id, sequence: shot.sequence, status, missing, warnings };
}

export async function getProjectReadiness(projectId: string, episodeId?: string): Promise<ReadinessEntry[]> {
  const allShots = await db
    .select()
    .from(shots)
    .where(eq(shots.projectId, projectId))
    .orderBy(shots.sequence);

  if (allShots.length === 0) return [];

  return Promise.all(
    allShots.map((s) => getShotReadiness(s, projectId, episodeId ?? s.episodeId))
  );
}

export function readinessSummary(entries: ReadinessEntry[]): {
  total: number;
  ready: number;
  blocked: number;
  completed: number;
  commonMissing: string[];
  suggestions: string[];
} {
  const counts = { total: entries.length, ready: 0, blocked: 0, completed: 0 };
  const missingCount = new Map<string, number>();

  for (const e of entries) {
    if (e.status === "ready") counts.ready++;
    else if (e.status === "blocked") counts.blocked++;
    else if (e.status === "completed") counts.completed++;
    for (const m of e.missing) {
      missingCount.set(m, (missingCount.get(m) ?? 0) + 1);
    }
  }

  const sorted = [...missingCount.entries()].sort((a, b) => b[1] - a[1]);
  const commonMissing = sorted.map(([k]) => k);

  const suggestions: string[] = [];
  if (commonMissing.includes("shot_prompt")) {
    suggestions.push("Fill in shot descriptions (prompt field) for blocked shots.");
  }
  if (commonMissing.includes("first_frame_prompt") || commonMissing.includes("last_frame_prompt")) {
    suggestions.push("Generate keyframe prompts first via the keyframe pipeline.");
  }
  if (counts.blocked > 0) {
    suggestions.push(`${counts.blocked} shot(s) are blocked — resolve missing items above before batch frame generation.`);
  }

  return { ...counts, commonMissing, suggestions };
}
