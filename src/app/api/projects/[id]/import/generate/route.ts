import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, characters, episodeCharacters, characterRelations } from "@/lib/db/schema";
import { eq, and, max } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog } from "@/lib/import-utils";
import { findCharacterIdByName, pruneStaleImportDraftAssets, syncImportAssets } from "@/lib/story-assets";
import { requireConfirmedScriptVersion } from "@/lib/confirmed-script-version";
import { lockAssetLibraryVersion, requireLockedAssetLibraryVersion } from "@/lib/industrial-pipeline";

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
  visualConstraints?: string;
  frequency?: number;
  confirmed?: boolean;
  assetId?: string;
  role?: string;
  roleKey?: string;
  episodes?: string[];
  prompt?: string;
  negativePrompt?: string;
  variants?: unknown[];
  imageUrl?: string;
  history?: unknown[];
  mainImageName?: string;
  tags?: string[];
  faceTemplate?: unknown;
  promptMetadata?: unknown;
  styleSpec?: unknown;
  visualSchema?: unknown;
}

interface AssetData {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
  visualConstraints?: string;
  confirmed?: boolean;
  assetId?: string;
  category?: string;
  role?: string;
  roleKey?: string;
  episodes?: string[];
  prompt?: string;
  negativePrompt?: string;
  variants?: unknown[];
  imageUrl?: string;
  history?: unknown[];
  mainImageName?: string;
  tags?: string[];
  faceTemplate?: unknown;
  promptMetadata?: unknown;
  styleSpec?: unknown;
  visualSchema?: unknown;
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
    items?: AssetData[];
    environments?: AssetData[];
    voices?: AssetData[];
    confirmedScriptVersionId?: string;
    assetLibraryVersionId?: string;
    relationships?: Array<{
      characterA: string;
      characterB: string;
      relationType: string;
      description?: string;
    }>;
  };

  let confirmedVersion: Awaited<ReturnType<typeof requireConfirmedScriptVersion>>;
  try {
    confirmedVersion = await requireConfirmedScriptVersion(projectId, body.confirmedScriptVersionId);
  } catch (error) {
    if (error instanceof Error && error.name === "ConfirmedScriptVersionRequiredError") {
      return NextResponse.json({
        error: "Import generation requires a confirmed_script_version",
        code: "needs_confirmed_script_version",
      }, { status: 409 });
    }
    throw error;
  }

  await addImportLog(
    projectId, 5, "running",
    `开始创建 ${body.episodes.length} 集、${body.characters.length} 个角色、${body.items?.length || 0} 个物品、${body.environments?.length || 0} 个环境、${body.voices?.length || 0} 个音色`,
    { confirmedScriptVersionId: confirmedVersion.id }
  );

  // 1. Create all characters (main + guest), build name→id map
  const charIdByName = new Map<string, string>();
  for (const char of body.characters) {
    const charId = genId();
    await db.insert(characters).values({
      id: charId,
      projectId,
      name: char.name,
      description: char.description,
      visualHint: char.visualHint ?? "",
      scope: char.scope,
      episodeId: null, // all characters are project-level now
    });
    charIdByName.set(char.name.toLowerCase().trim(), charId);
  }

  // 1b. Create character relationships
  if (body.relationships?.length) {
    for (const rel of body.relationships) {
      const aId = charIdByName.get(rel.characterA.toLowerCase().trim());
      const bId = charIdByName.get(rel.characterB.toLowerCase().trim());
      if (aId && bId && aId !== bId) {
        try {
          await db.insert(characterRelations).values({
            id: genId(),
            projectId,
            characterAId: aId,
            characterBId: bId,
            relationType: rel.relationType || "neutral",
            description: rel.description || "",
          });
        } catch {
          // skip duplicates
        }
      }
    }
  }

  await addImportLog(
    projectId, 5, "running",
    `已创建 ${body.characters.length} 个角色${body.relationships?.length ? `和 ${body.relationships.length} 个关系` : ""}`
  );

  const persistedAssetRows = await syncImportAssets(
    projectId,
    {
      characters: body.characters,
      items: body.items || [],
      environments: body.environments || [],
    },
    { characterIdByName: await findCharacterIdByName(projectId) }
  );
  const persistedAssetIds = new Set(persistedAssetRows.map((asset) => asset.id));
  const prunedAssetCount = await pruneStaleImportDraftAssets(projectId, persistedAssetIds);

  await addImportLog(
    projectId, 5, "running",
    `已写入资产库：人物 ${body.characters.length}、道具 ${body.items?.length || 0}、场景 ${body.environments?.length || 0}${prunedAssetCount ? `，清理旧草稿资产 ${prunedAssetCount} 个` : ""}`
  );

  let assetLibraryVersion: Awaited<ReturnType<typeof lockAssetLibraryVersion>>;
  if (body.assetLibraryVersionId) {
    try {
      assetLibraryVersion = await requireLockedAssetLibraryVersion(projectId, body.assetLibraryVersionId);
      if (assetLibraryVersion.confirmedScriptVersionId !== confirmedVersion.id) {
        throw new Error("Locked asset library does not belong to the confirmed script version");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Locked asset library is required";
      await addImportLog(projectId, 5, "error", `资产库版本不可用：${message}`, {
        confirmedScriptVersionId: confirmedVersion.id,
        assetLibraryVersionId: body.assetLibraryVersionId,
      });
      return NextResponse.json({ error: message }, { status: 409 });
    }

    await addImportLog(
      projectId, 5, "running",
      `复用已锁定资产库版本：${assetLibraryVersion.id}`,
      {
        assetLibraryVersionId: assetLibraryVersion.id,
        confirmedScriptVersionId: confirmedVersion.id,
      }
    );
  } else {
    try {
      assetLibraryVersion = await lockAssetLibraryVersion({
        projectId,
        confirmedScriptVersionId: confirmedVersion.id,
        assetIds: persistedAssetRows.map((asset) => asset.id),
        reviewSummary: {
          source: "import_generate",
          assetCount: persistedAssetRows.length,
          prunedAssetCount,
          characterCount: body.characters.length,
          itemCount: body.items?.length || 0,
          environmentCount: body.environments?.length || 0,
          voiceCount: body.voices?.length || 0,
        },
        userId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to lock asset library";
      await addImportLog(projectId, 5, "error", `资产库锁定失败：${message}`, {
        confirmedScriptVersionId: confirmedVersion.id,
        assetCount: persistedAssetRows.length,
      });
      return NextResponse.json({ error: message }, { status: 409 });
    }

    await addImportLog(
      projectId, 5, "running",
      `已锁定资产库版本：${assetLibraryVersion.id}`,
      {
        assetLibraryVersionId: assetLibraryVersion.id,
        confirmedScriptVersionId: confirmedVersion.id,
      }
    );
  }

  // 2. Create episodes
  const [seqResult] = await db
    .select({ maxSeq: max(episodes.sequence) })
    .from(episodes)
    .where(eq(episodes.projectId, projectId));

  let seq = (seqResult?.maxSeq ?? 0) + 1;

  const created = [];
  for (const ep of body.episodes) {
    const [row] = await db
      .insert(episodes)
      .values({
        id: genId(),
        projectId,
        title: ep.title,
        description: ep.description || "",
        keywords: ep.keywords || "",
        idea: ep.idea || "",
        sequence: seq++,
      })
      .returning();
    created.push(row);
  }

  // 3. Create episode_characters relations
  let relationCount = 0;
  for (let i = 0; i < body.episodes.length; i++) {
    const epData = body.episodes[i];
    const episodeId = created[i]?.id;
    if (!episodeId || !epData.characters) continue;

    for (const charName of epData.characters) {
      const charId = charIdByName.get(charName.toLowerCase().trim());
      if (!charId) continue;
      await db.insert(episodeCharacters).values({
        id: genId(),
        episodeId,
        characterId: charId,
      });
      relationCount++;
    }
  }

  await addImportLog(
    projectId, 5, "done",
    `导入完成！创建了 ${body.characters.length} 个角色和 ${created.length} 集（${relationCount} 个角色分配）`,
    {
      episodeCount: created.length,
      characterCount: body.characters.length,
      itemCount: body.items?.length || 0,
      environmentCount: body.environments?.length || 0,
      voiceCount: body.voices?.length || 0,
      assetCount: persistedAssetRows.length,
      prunedAssetCount,
      confirmedScriptVersionId: confirmedVersion.id,
      assetLibraryVersionId: assetLibraryVersion.id,
      items: body.items || [],
      environments: body.environments || [],
      voices: body.voices || [],
      assetIds: persistedAssetRows.map((asset) => ({
        id: asset.id,
        type: asset.type,
        name: asset.name,
      })),
    }
  );

  return NextResponse.json({
    episodes: created,
    characterCount: body.characters.length,
    itemCount: body.items?.length || 0,
    environmentCount: body.environments?.length || 0,
    voiceCount: body.voices?.length || 0,
    assetCount: persistedAssetRows.length,
    prunedAssetCount,
    confirmedScriptVersionId: confirmedVersion.id,
    assetLibraryVersionId: assetLibraryVersion.id,
    assetLibraryVersion,
  }, { status: 201 });
}

