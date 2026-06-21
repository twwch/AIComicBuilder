import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, characters, episodeCharacters, characterRelations } from "@/lib/db/schema";
import { eq, and, max } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog } from "@/lib/import-utils";

export const maxDuration = 60;

interface EpisodeData {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  characters?: string[];
}

interface CharacterData {
  name: string;
  scope: "main" | "guest";
  description: string;
  visualHint?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    episodes: EpisodeData[];
    characters: CharacterData[];
    relationships?: Array<{
      characterA: string;
      characterB: string;
      relationType: string;
      description?: string;
    }>;
  };

  await addImportLog(
    projectId, 4, "running",
    `开始创建 ${body.episodes.length} 集和 ${body.characters.length} 个角色`
  );

  // Pre-compute sequence number for new episodes (read outside transaction)
  const [seqResult] = await db
    .select({ maxSeq: max(episodes.sequence) })
    .from(episodes)
    .where(eq(episodes.projectId, projectId));
  let seq = (seqResult?.maxSeq ?? 0) + 1;

  // Wrap all insert operations in a transaction so partial failures roll back
  const created: (typeof episodes.$inferSelect)[] = [];
  let relationCount = 0;
  const charIdByName = new Map<string, string>();

await db.transaction(async (tx) => {
    // 1. Create all characters
    const charRows = body.characters.map((char) => {
      const charId = genId();
      charIdByName.set(char.name.toLowerCase().trim(), charId);
      return {
        id: charId,
        projectId,
        name: char.name,
        description: char.description,
        visualHint: char.visualHint ?? "",
        scope: char.scope,
        episodeId: null,
      };
    });
    await tx.insert(characters).values(charRows);

    // 2. Create character relationships
    if (body.relationships?.length) {
      const relRows = body.relationships
        .map((rel) => {
          const aId = charIdByName.get(rel.characterA.toLowerCase().trim());
          const bId = charIdByName.get(rel.characterB.toLowerCase().trim());
          if (aId && bId && aId !== bId) {
            return {
              id: genId(),
              projectId,
              characterAId: aId,
              characterBId: bId,
              relationType: rel.relationType || "neutral",
              description: rel.description || "",
            };
          }
          return null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (relRows.length > 0) {
        try {
          await tx.insert(characterRelations).values(relRows);
        } catch {
          // skip duplicates
        }
      }
    }

    // 3. Create episodes
    const epRows = body.episodes.map((ep) => ({
      id: genId(),
      projectId,
      title: ep.title,
      description: ep.description || "",
      keywords: ep.keywords || "",
      idea: ep.idea || "",
      sequence: seq++,
    }));
    created.push(...(await tx.insert(episodes).values(epRows).returning()));

    // 4. Create episode_characters relations
    const ecRows = body.episodes.flatMap((epData, i) => {
      const episodeId = created[i]?.id;
      if (!episodeId || !epData.characters) return [];
      return epData.characters
        .map((charName) => {
          const charId = charIdByName.get(charName.toLowerCase().trim());
          if (!charId) return null;
          relationCount++;
          return { id: genId(), episodeId, characterId: charId };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    });
    if (ecRows.length > 0) {
      await tx.insert(episodeCharacters).values(ecRows);
    }
  });

  await addImportLog(
    projectId, 4, "running",
    `已创建 ${body.characters.length} 个角色${body.relationships?.length ? `和 ${body.relationships.length} 个关系` : ""}`
  );
  await addImportLog(
    projectId, 4, "done",
    `导入完成！创建了 ${body.characters.length} 个角色和 ${created.length} 集（${relationCount} 个角色分配）`,
    { episodeCount: created.length, characterCount: body.characters.length }
  );

  return NextResponse.json({
    episodes: created,
    characterCount: body.characters.length,
  }, { status: 201 });
}
