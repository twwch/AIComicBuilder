import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog } from "@/lib/import-utils";
import { requireConfirmedScriptVersion } from "@/lib/confirmed-script-version";
import { listProjectAssets, pruneStaleImportDraftAssets, syncImportAssets } from "@/lib/story-assets";
import {
  analyzeScriptAssets,
  type AssetAgentAsset,
  type AssetAgentProject,
  type StoryAssetAnalysis,
} from "@/lib/asset-agent/analyze-script-assets";
import { shouldRebuildAssetDisplayPrompt } from "@/lib/asset-prompt-builder";

export const maxDuration = 300;

interface ImportedAsset {
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
  variants?: AssetAgentAsset["variants"];
  imageUrl?: string;
  history?: AssetAgentAsset["history"];
  mainImageName?: string;
  tags?: string[];
  promptMetadata?: AssetAgentAsset["promptMetadata"];
  styleSpec?: unknown;
  visualSchema?: unknown;
}

interface ImportedCharacter extends ImportedAsset {
  scope: "main" | "guest";
  faceTemplate?: AssetAgentAsset["faceTemplate"];
}

type PersistedAsset = Awaited<ReturnType<typeof listProjectAssets>>[number];

function asRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asRecord(parsed);
    } catch {
      return {};
    }
  }
  return {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function storyMetaOnlyAnalysis(analysis?: StoryAssetAnalysis | null): StoryAssetAnalysis | null {
  if (!analysis?.storyMeta) return null;
  return { storyMeta: analysis.storyMeta };
}

function sourceAssetId(asset: PersistedAsset) {
  return String(asRecord(asset.metadata).sourceAssetId || "");
}

function findPersistedAsset(
  persistedAssets: PersistedAsset[],
  type: "character" | "scene" | "prop",
  draft: ImportedAsset,
) {
  const sourceId = String(draft.assetId || "");
  const draftName = draft.name.toLowerCase().trim();
  return persistedAssets.find((asset) => asset.type === type && sourceId && sourceAssetId(asset) === sourceId)
    ?? persistedAssets.find((asset) => asset.type === type && asset.name.toLowerCase().trim() === draftName);
}

function mapPersistedVariant(variant: Record<string, unknown>) {
  const metadata = asRecord(variant.metadata);
  const changedTraits = asRecord(variant.changedTraits);
  return {
    id: String(variant.id || ""),
    name: String(variant.name || "资产变体"),
    variantType: String(variant.variantType || ""),
    description: String(variant.state || variant.visualConstraints || ""),
    prompt: String(changedTraits.prompt || variant.visualConstraints || variant.state || ""),
    imageUrl: String(variant.referenceImage || ""),
    history: Array.isArray(metadata.history) ? metadata.history as Array<Record<string, unknown>> : [],
    editInstruction: String(changedTraits.editInstruction || ""),
    visualSchema: metadata.visualSchema ?? null,
  };
}

function mapPersistedVariants(asset: PersistedAsset) {
  const variants = Array.isArray(asset.variants) ? asset.variants : [];
  return variants
    .filter((variant) => {
      const record = variant as Record<string, unknown>;
      const variantType = String(record.variantType || "");
      return variantType !== "default" && variantType !== "base";
    })
    .map((variant) => mapPersistedVariant(variant as Record<string, unknown>));
}

function hydrateAssetFromLibrary<T extends ImportedAsset>(
  draft: T,
  type: "character" | "scene" | "prop",
  persistedAssets: PersistedAsset[],
): T {
  const persisted = findPersistedAsset(persistedAssets, type, draft);
  if (!persisted) return draft;

  const metadata = asRecord(persisted.metadata);
  const variants = mapPersistedVariants(persisted);
  const persistedPrompt = String(metadata.prompt || "");
  const usePersistedPrompt = Boolean(persistedPrompt && !shouldRebuildAssetDisplayPrompt(persistedPrompt));
  const persistedPromptMetadata = asRecord(metadata.promptMetadata).compilerIR
    ? metadata.promptMetadata as AssetAgentAsset["promptMetadata"]
    : null;
  return {
    ...draft,
    name: persisted.name || draft.name,
    frequency: Number(metadata.frequency ?? draft.frequency ?? persisted.importance ?? 1),
    description: persisted.description || draft.description,
    visualHint: String(metadata.visualHint || draft.visualHint || persisted.name),
    visualConstraints: persisted.visualConstraints || draft.visualConstraints,
    confirmed: Boolean(persisted.confirmed),
    assetId: persisted.id,
    category: String(metadata.category || draft.category || type),
    role: String(metadata.role || draft.role || ""),
    roleKey: String(metadata.roleKey || draft.roleKey || ""),
    episodes: asStringArray(metadata.episodes).length ? asStringArray(metadata.episodes) : draft.episodes,
    prompt: usePersistedPrompt ? persistedPrompt : draft.prompt || "",
    negativePrompt: persisted.negativeConstraints || draft.negativePrompt,
    variants: variants.length ? variants : draft.variants,
    imageUrl: persisted.referenceImage || draft.imageUrl,
    history: Array.isArray(metadata.imageHistory) ? metadata.imageHistory as Array<Record<string, unknown>> : draft.history,
    mainImageName: String(metadata.mainImageName || draft.mainImageName || persisted.name),
    tags: asStringArray(metadata.tags).length ? asStringArray(metadata.tags) : draft.tags,
    promptMetadata: usePersistedPrompt && persistedPromptMetadata ? persistedPromptMetadata : draft.promptMetadata,
    styleSpec: metadata.styleSpec ?? draft.styleSpec ?? null,
    visualSchema: metadata.visualSchema ?? draft.visualSchema ?? null,
  };
}

function toVisualHint(asset: AssetAgentAsset) {
  return asset.mainImageName || asset.tags[0] || asset.role || asset.name;
}

function isMainRole(asset: AssetAgentAsset) {
  return asset.roleKey === "maleLead" || asset.roleKey === "femaleLead" || /主角|男主|女主/.test(asset.role || "");
}

function mapCharacter(asset: AssetAgentAsset): ImportedCharacter {
  return {
    name: asset.name,
    frequency: asset.appearances || asset.score || 1,
    description: asset.description,
    visualHint: toVisualHint(asset),
    visualConstraints: asset.visualConstraints,
    scope: isMainRole(asset) ? "main" : "guest",
    confirmed: asset.confirmed,
    assetId: asset.id,
    category: asset.category,
    role: asset.role,
    roleKey: asset.roleKey,
    episodes: asset.episodes,
    prompt: asset.prompt,
    negativePrompt: asset.negativePrompt,
    variants: asset.variants,
    imageUrl: asset.imageUrl,
    history: asset.history,
    mainImageName: asset.mainImageName,
    tags: asset.tags,
    faceTemplate: asset.faceTemplate,
    promptMetadata: asset.promptMetadata,
    styleSpec: asset.styleSpec,
  };
}

function mapAsset(asset: AssetAgentAsset): ImportedAsset {
  return {
    name: asset.name,
    frequency: asset.appearances || asset.score || 1,
    description: asset.description,
    visualHint: toVisualHint(asset),
    visualConstraints: asset.visualConstraints,
    confirmed: asset.confirmed,
    assetId: asset.id,
    category: asset.category,
    role: asset.role,
    roleKey: asset.roleKey,
    episodes: asset.episodes,
    prompt: asset.prompt,
    negativePrompt: asset.negativePrompt,
    variants: asset.variants,
    imageUrl: asset.imageUrl,
    history: asset.history,
    mainImageName: asset.mainImageName,
    tags: asset.tags,
    promptMetadata: asset.promptMetadata,
    styleSpec: asset.styleSpec,
  };
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
    text?: string;
    storyAnalysis?: StoryAssetAnalysis | null;
    confirmedScriptVersionId?: string;
  };

  let confirmedVersion: Awaited<ReturnType<typeof requireConfirmedScriptVersion>>;
  try {
    confirmedVersion = await requireConfirmedScriptVersion(projectId, body.confirmedScriptVersionId);
  } catch (error) {
    if (error instanceof Error && error.name === "ConfirmedScriptVersionRequiredError") {
      return NextResponse.json({
        error: "Asset extraction requires a confirmed_script_version",
        code: "needs_confirmed_script_version",
      }, { status: 409 });
    }
    throw error;
  }

  const scriptForAssetExtraction = confirmedVersion.content.trim();

  if (!scriptForAssetExtraction) {
    return NextResponse.json({ error: "Confirmed script text is empty" }, { status: 400 });
  }

  await addImportLog(
    projectId,
    3,
    "running",
    "开始资产设定：使用资产 Agent 提取角色、物品、场景和音色"
  );

  let assetProject: AssetAgentProject;
  try {
    assetProject = analyzeScriptAssets({
      title: project.title,
      script: scriptForAssetExtraction,
      storyAnalysis: storyMetaOnlyAnalysis(body.storyAnalysis),
      aspectRatio: "16:9",
      targetSize: "1536x1024",
      style: "真人实拍",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Asset agent failed";
    console.error("[ImportAssets] Asset agent failed:", err);
    await addImportLog(projectId, 3, "error", `资产设定失败: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const extractedCharacters = assetProject.assets.characters.map(mapCharacter);
  const extractedItems = assetProject.assets.props.map(mapAsset);
  const extractedEnvironments = assetProject.assets.scenes.map(mapAsset);
  const voices = assetProject.assets.voices.map(mapAsset);
  const relationships: Array<{
    characterA: string;
    characterB: string;
    relationType: string;
    description?: string;
  }> = [];
  const persistedRows = await syncImportAssets(projectId, {
    characters: extractedCharacters,
    items: extractedItems,
    environments: extractedEnvironments,
  });
  const persistedIds = new Set(persistedRows.map((asset) => asset.id));
  const prunedAssetCount = await pruneStaleImportDraftAssets(projectId, persistedIds);
  const persistedAssets = (await listProjectAssets(projectId))
    .filter((asset) => persistedIds.has(asset.id));
  const characters = extractedCharacters.map((asset) =>
    hydrateAssetFromLibrary(asset, "character", persistedAssets)
  );
  const items = extractedItems.map((asset) =>
    hydrateAssetFromLibrary(asset, "prop", persistedAssets)
  );
  const environments = extractedEnvironments.map((asset) =>
    hydrateAssetFromLibrary(asset, "scene", persistedAssets)
  );

  await addImportLog(
    projectId,
    3,
    "done",
    `资产设定完成并写入资产草稿库，共 ${characters.length} 个角色、${items.length} 个物品、${environments.length} 个环境、${voices.length} 个音色`,
    {
      characters,
      relationships,
      items,
      environments,
      voices,
      confirmedScriptVersionId: confirmedVersion.id,
      assetAgent: {
        id: assetProject.id,
        settings: assetProject.settings,
        summary: assetProject.summary,
        stages: assetProject.stages,
      },
      persistedAssetIds: [...persistedIds],
      prunedAssetCount,
    }
  );

  return NextResponse.json({
    characters,
    relationships,
    items,
    environments,
    voices,
    confirmedScriptVersionId: confirmedVersion.id,
    persistedAssets,
    prunedAssetCount,
    assetAgent: {
      id: assetProject.id,
      settings: assetProject.settings,
      summary: assetProject.summary,
      stages: assetProject.stages,
    },
  });
}
