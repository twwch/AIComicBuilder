"use client";

import { useCallback, useEffect, useState, use, useMemo, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Film,
  ImageIcon,
  Layers,
  Loader2,
  Merge,
  MoreHorizontal,
  Plus,
  Copy,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { uploadUrl } from "@/lib/utils/upload-url";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EpisodeDialog } from "@/components/editor/episode-dialog";
import { useEpisodeStore, type Episode } from "@/stores/episode-store";
import { useModelStore, type ModelRef } from "@/stores/model-store";
import { apiFetch } from "@/lib/api-fetch";
import { buildStoryboardPromptPreviewFromText, looksLikeRawStoryboardText } from "@/lib/storyboard";
import Link from "next/link";

function stripEpisodePrefix(title: string) {
  return title
    .replace(
      /^\s*(第\s*[0-9０-９一二三四五六七八九十百千万两〇零]+\s*[集话話回]|EP\.?\s*\d+|Episode\s+\d+)\s*[:：.\-、,，]?\s*/i,
      ""
    )
    .trim();
}

function formatEpisodeChipLabel(episode: Episode) {
  const title = stripEpisodePrefix(episode.title?.trim() || "");
  return `E${episode.sequence}${title ? ` ${title}` : ""}`;
}

type ShotAssetType =
  | "first_frame"
  | "last_frame"
  | "reference"
  | "keyframe_video"
  | "reference_video";

interface ShotAsset {
  id: string;
  type: ShotAssetType;
  sequenceInType: number;
  isActive: number;
  prompt: string;
  fileUrl: string | null;
  status: "pending" | "generating" | "completed" | "failed";
  characters: string[] | null;
  meta?: { sceneName?: string } | null;
}

interface EpisodeCharacter {
  id: string;
  name: string;
  description: string;
  visualHint?: string | null;
  referenceImage: string | null;
  scope?: string;
}

interface EpisodeShot {
  id: string;
  sequence: number;
  prompt: string;
  videoPrompt: string | null;
  videoScript: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  versionId?: string | null;
  sceneId?: string | null;
  compositionGuide?: string | null;
  status: string;
  dialogues?: Array<{ characterName: string; text: string; sequence: number }>;
  assets?: ShotAsset[];
}

interface EpisodeDetail {
  id: string;
  episodeId: string;
  title: string;
  idea?: string | null;
  script?: string | null;
  description?: string | null;
  keywords?: string | null;
  generationMode: "keyframe" | "reference";
  characters: EpisodeCharacter[];
  shots: EpisodeShot[];
  versions?: Array<{ id: string; label: string; versionNum: number; createdAt: number }>;
}

interface StoryboardScene {
  id: string;
  name: string;
  shots: EpisodeShot[];
}

interface DraftScene {
  id: string;
  name: string;
  prompt: string;
  environment: string[];
  props: string[];
}

interface StoredDraftScenes {
  version: number;
  sourceSignature: string;
  scenes: DraftScene[];
}

type AssetCategory = "characters" | "environments" | "items";

interface LibraryAsset {
  id: string;
  name: string;
  category: AssetCategory;
  subtitle: string;
  imageUrl?: string | null;
  description?: string | null;
  visualHint?: string | null;
}

interface ImportAssetLike {
  name?: string;
  description?: string;
  visualHint?: string;
  assetId?: string;
  category?: string;
  role?: string;
  scope?: string;
  imageUrl?: string;
  referenceImage?: string | null;
  variants?: Array<{ imageUrl?: string; referenceImage?: string | null; name?: string; state?: string; visualConstraints?: string }>;
  faceTemplate?: { url?: string | null } | null;
}

interface StoryLibraryAssetLike {
  id: string;
  type: "character" | "scene" | "prop";
  name: string;
  description?: string | null;
  visualConstraints?: string | null;
  referenceImage?: string | null;
  variants?: Array<{
    id: string;
    name: string;
    state?: string | null;
    visualConstraints?: string | null;
    referenceImage?: string | null;
  }>;
  detail?: Record<string, unknown> | null;
}

type SceneAssetSelections = Record<string, Partial<Record<AssetCategory, string[]>>>;

function getActiveAsset(shot: EpisodeShot, type: ShotAssetType, sequenceInType = 0) {
  return (shot.assets || []).find(
    (asset) => asset.isActive === 1 && asset.type === type && asset.sequenceInType === sequenceInType
  );
}

function getActiveAssets(shot: EpisodeShot, type: ShotAssetType) {
  return (shot.assets || [])
    .filter((asset) => asset.isActive === 1 && asset.type === type)
    .sort((a, b) => a.sequenceInType - b.sequenceInType);
}

function getSceneReferenceName(shot: EpisodeShot) {
  const refName = getActiveAssets(shot, "reference").find((asset) => asset.meta?.sceneName)?.meta?.sceneName;
  if (refName) return refName;
  const prompt = `${shot.prompt || ""} ${shot.videoScript || ""}`;
  const match = prompt.match(/(?:场景|地点|环境)[：:]\s*([^，。,.\n]{2,18})/);
  return match?.[1]?.trim() || `场景 ${shot.sceneId ? shot.sceneId.slice(-4) : Math.ceil(shot.sequence / 3)}`;
}

function groupShotsByScene(shots: EpisodeShot[]): StoryboardScene[] {
  const groups = new Map<string, StoryboardScene>();
  for (const shot of shots) {
    const sceneName = getSceneReferenceName(shot);
    const id = shot.sceneId || sceneName || `scene-${Math.ceil(shot.sequence / 3)}`;
    const existing = groups.get(id);
    if (existing) {
      existing.shots.push(shot);
    } else {
      groups.set(id, { id, name: sceneName, shots: [shot] });
    }
  }
  return Array.from(groups.values());
}

function compactText(value: string | null | undefined, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function storyboardPromptFromShot(shot: EpisodeShot, sceneName?: string) {
  const source = shot.videoPrompt || shot.prompt || shot.videoScript || shot.motionScript || "";
  if (
    /Storyboard key frame image|Storyboard still|Static frame:/i.test(source) &&
    !looksLikeRawStoryboardText(source)
  ) {
    return source;
  }

  const characterNames = [
    ...(shot.dialogues?.map((dialogue) => dialogue.characterName) ?? []),
    ...((shot.assets ?? []).flatMap((asset) => asset.characters ?? [])),
  ];
  const referenceSceneNames = (shot.assets ?? [])
    .map((asset) => asset.meta?.sceneName)
    .filter((name): name is string => Boolean(name));

  return buildStoryboardPromptPreviewFromText({
    title: sceneName || getSceneReferenceName(shot),
    sourceText: [shot.prompt, shot.motionScript, shot.videoPrompt, shot.videoScript].filter(Boolean).join(" "),
    characterNames,
    sceneNames: referenceSceneNames.length ? referenceSceneNames : sceneName ? [sceneName] : [],
    propNames: [],
  });
}

function uniqueCharacters(characters: EpisodeCharacter[]) {
  const seen = new Set<string>();
  return characters.filter((character) => {
    const key = character.id || character.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueTextItems(items: string[], max = 8) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const value = item.replace(/[【】\[\]（）()，,。.:：;；]/g, "").trim();
    if (!value || value.length < 2 || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

function uniqueLibraryAssets(assets: LibraryAsset[]) {
  const byKey = new Map<string, LibraryAsset>();
  for (const asset of assets) {
    const key = `${asset.category}:${asset.name}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, asset);
      continue;
    }

    // Prefer the newest/library-backed item when it has an image. This keeps
    // generated asset images visible even if project characters still lack
    // referenceImage.
    const shouldReplace =
      (!existing.imageUrl && Boolean(asset.imageUrl)) ||
      (!existing.description && Boolean(asset.description)) ||
      (!existing.visualHint && Boolean(asset.visualHint));
    if (shouldReplace) byKey.set(key, { ...existing, ...asset });
  }
  return Array.from(byKey.values());
}

function assetImageUrl(asset: ImportAssetLike) {
  return asset.imageUrl ||
    asset.referenceImage ||
    asset.faceTemplate?.url ||
    asset.variants?.find((variant) => variant.imageUrl || variant.referenceImage)?.imageUrl ||
    asset.variants?.find((variant) => variant.imageUrl || variant.referenceImage)?.referenceImage ||
    null;
}

function importAssetsToLibraryAssets(
  category: AssetCategory,
  assets: ImportAssetLike[] | undefined,
  subtitle: string
) {
  return uniqueLibraryAssets(
    (Array.isArray(assets) ? assets : [])
      .filter((asset) => asset.name?.trim())
      .map((asset, index) => ({
        id: `${category}:${asset.assetId || asset.name}:${index}`,
        name: asset.name!.trim(),
        category,
        subtitle: asset.role || asset.scope || asset.category || subtitle,
        imageUrl: assetImageUrl(asset),
        description: asset.description,
        visualHint: asset.visualHint,
      }))
  );
}

function storyAssetsToLibraryAssets(assets: StoryLibraryAssetLike[] | undefined) {
  return uniqueLibraryAssets(
    (Array.isArray(assets) ? assets : []).map((asset) => {
      const variantImage = asset.variants?.find((variant) => variant.referenceImage)?.referenceImage;
      const variantText = asset.variants?.find((variant) => variant.state || variant.visualConstraints);
      const category: AssetCategory =
        asset.type === "character" ? "characters" : asset.type === "scene" ? "environments" : "items";
      return {
        id: `${category}:${asset.id}`,
        name: asset.name,
        category,
        subtitle: asset.type === "character" ? "资产库角色" : asset.type === "scene" ? "资产库场景" : "资产库物品",
        imageUrl: asset.referenceImage || variantImage || null,
        description: asset.description || variantText?.state || null,
        visualHint: asset.visualConstraints || variantText?.visualConstraints || null,
      };
    })
  );
}

function characterToLibraryAsset(character: EpisodeCharacter): LibraryAsset {
  return {
    id: `characters:${character.id || character.name}`,
    name: character.name,
    category: "characters",
    subtitle: character.referenceImage ? (character.scope === "guest" ? "客串角色" : "角色参考") : "待补图",
    imageUrl: character.referenceImage,
    description: character.description,
    visualHint: character.visualHint,
  };
}

function virtualAsset(sceneId: string, category: AssetCategory, name: string, subtitle: string): LibraryAsset {
  return {
    id: `virtual:${sceneId}:${category}:${name}`,
    name,
    category,
    subtitle,
  };
}

function getSceneAssetOptions(
  scene: DraftScene,
  category: AssetCategory,
  pools: Record<AssetCategory, LibraryAsset[]>
) {
  if (category === "characters") return pools.characters;
  if (category === "environments") {
    const virtuals = (scene.environment.length ? scene.environment : [scene.name]).map((name) =>
      virtualAsset(scene.id, "environments", name, "场景")
    );
    return uniqueLibraryAssets([...pools.environments, ...virtuals]);
  }
  const virtuals = scene.props.map((name) => virtualAsset(scene.id, "items", name, "物品"));
  return uniqueLibraryAssets([...pools.items, ...virtuals]);
}

function inferDefaultAssetIds(scene: DraftScene, assets: LibraryAsset[], category: AssetCategory) {
  const text = `${scene.name} ${scene.prompt}`;
  const rankedAssets = category === "characters"
    ? [...assets].sort((a, b) => Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)))
    : assets;
  const matched = rankedAssets.filter((asset) => text.includes(asset.name));
  if (matched.length) return matched.slice(0, 8).map((asset) => asset.id);
  if (category === "characters") return rankedAssets.slice(0, 6).map((asset) => asset.id);
  return [];
}

function getVideoDurationOptions(modelId?: string | null) {
  const model = (modelId || "").toLowerCase();
  if (model.includes("minimax")) return [6, 10];
  if (model.includes("kling") || model.includes("wan")) return [5, 10, 15];
  if (model.includes("seedance-1-0")) return [5];
  if (model.includes("veo")) return [8];
  if (model.includes("vidu")) return [4, 8, 12, 16];
  return [5, 8, 10, 12];
}

function getVideoResolutionOptions(modelId?: string | null) {
  const model = (modelId || "").toLowerCase();
  if (model.includes("minimax")) return ["768P"];
  if (model.includes("wan")) return ["720P"];
  if (model.includes("seedance") || model.includes("kling") || model.includes("vidu")) return ["720p", "1080p"];
  return ["720p"];
}

function modelRefKey(ref: ModelRef | null) {
  return ref ? `${ref.providerId}:${ref.modelId}` : "";
}

function splitSceneNameParts(name: string) {
  return uniqueTextItems(
    name
      .replace(/^场景\s*\d+\s*[:：-]?/i, "")
      .split(/[\/|｜、，,]/)
      .map((part) => part.trim())
  );
}

function inferPropsFromText(text: string) {
  const candidates = [
    "汽车",
    "车轮",
    "轮胎",
    "雨刷器",
    "挡风玻璃",
    "玻璃",
    "水坑",
    "手机",
    "伞",
    "剑",
    "刀",
    "门",
    "窗",
    "桌",
    "椅",
    "信件",
  ];
  return uniqueTextItems(candidates.filter((item) => text.includes(item)), 6);
}

function draftSourceSignature(source: string, episodeSequence?: number) {
  const normalized = source.replace(/\s+/g, " ").trim();
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return `${episodeSequence || 0}:${normalized.length}:${hash.toString(36)}`;
}

function containsOtherEpisodeMarker(value: string, episodeSequence?: number) {
  if (!episodeSequence) return false;
  const text = String(value || "");
  for (const match of text.matchAll(/第\s*(\d+)\s*集/g)) {
    if (Number(match[1]) !== episodeSequence) return true;
  }
  for (const match of text.matchAll(/(?:^|[^\d])(\d+)\s*[-－—]\s*\d+\s+/g)) {
    if (Number(match[1]) !== episodeSequence) return true;
  }
  return false;
}

function isDraftSceneListCompatible(
  scenes: unknown,
  parsedScenes: DraftScene[],
  episodeSequence?: number
): scenes is DraftScene[] {
  if (!Array.isArray(scenes)) return false;
  const validScenes = scenes.every(
    (scene) =>
      scene &&
      typeof scene === "object" &&
      typeof (scene as DraftScene).id === "string" &&
      typeof (scene as DraftScene).name === "string" &&
      typeof (scene as DraftScene).prompt === "string" &&
      Array.isArray((scene as DraftScene).environment) &&
      Array.isArray((scene as DraftScene).props)
  );
  if (!validScenes) return false;
  if (
    parsedScenes.length > 0 &&
    scenes.length > Math.max(parsedScenes.length + 3, parsedScenes.length * 2)
  ) {
    return false;
  }
  return !scenes.some((scene) =>
    containsOtherEpisodeMarker(`${scene.name}\n${scene.prompt}`, episodeSequence)
  );
}

function normalizeSceneHeadingTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  const bracketed = normalized.match(/^【\s*([^】]+)\s*】$/);
  return bracketed ? bracketed[1].replace(/\s+/g, " ").trim() : normalized;
}

function sceneHeadingInfo(title: string) {
  const normalized = normalizeSceneHeadingTitle(title);
  const numbered = normalized.match(/^(?:第\s*(\d+)\s*集\s*)?(\d+)\s*[-－—]\s*(\d+)\s+(.+)$/);
  if (numbered) {
    return {
      episodeNumber: Number(numbered[1] || numbered[2]),
      sceneKey: `${Number(numbered[2])}-${Number(numbered[3])}`,
      name: numbered[4].trim(),
    };
  }

  const scene = normalized.match(/^(场景\s*\d+)\s*[:：-]?\s*(.+)$/i);
  if (scene) {
    return {
      episodeNumber: null,
      sceneKey: scene[1].replace(/\s+/g, ""),
      name: scene[2].trim(),
    };
  }

  return {
    episodeNumber: null,
    sceneKey: normalized,
    name: normalized,
  };
}

function isSceneHeading(title: string) {
  const normalized = normalizeSceneHeadingTitle(title);
  return /(?:第\s*\d+\s*集\s*)?\d+\s*[-－—]\s*\d+\s+/.test(normalized) || /场景\s*\d+/i.test(normalized);
}

function parseDraftScenes(source: string | null | undefined, episodeSequence?: number): DraftScene[] {
  const text = String(source || "").trim();
  if (!text) return [];

  const candidates: Array<{
    index: number;
    end: number;
    title: string;
    episodeNumber: number | null;
    sceneKey: string;
  }> = [];

  for (const match of text.matchAll(/【\s*([^】]+)\s*】/g)) {
    const title = normalizeSceneHeadingTitle(match[1]);
    if (!isSceneHeading(title)) continue;
    const info = sceneHeadingInfo(title);
    candidates.push({
      index: match.index || 0,
      end: (match.index || 0) + match[0].length,
      title,
      episodeNumber: info.episodeNumber,
      sceneKey: info.sceneKey,
    });
  }

  const linePattern = /[^\r\n]+/g;
  for (const match of text.matchAll(linePattern)) {
    const title = normalizeSceneHeadingTitle(match[0]);
    if (!isSceneHeading(title)) continue;
    const info = sceneHeadingInfo(title);
    candidates.push({
      index: match.index || 0,
      end: (match.index || 0) + match[0].length,
      title,
      episodeNumber: info.episodeNumber,
      sceneKey: info.sceneKey,
    });
  }

  const headings = candidates
    .sort((a, b) => a.index - b.index)
    .reduce<typeof candidates>((items, candidate) => {
      const previous = items[items.length - 1];
      if (
        previous &&
        previous.sceneKey === candidate.sceneKey &&
        candidate.index <= previous.end + 120
      ) {
        previous.end = Math.max(previous.end, candidate.end);
        previous.title = candidate.title;
        return items;
      }
      items.push({ ...candidate });
      return items;
    }, []);

  const filtered = headings.filter((candidate) => {
    if (!episodeSequence || !candidate.episodeNumber) return true;
    return candidate.episodeNumber === episodeSequence;
  });

  if (filtered.length === 0) {
    return [
      {
        id: "draft-scene-1",
        name: "场景草稿",
        prompt: text,
        environment: [],
        props: inferPropsFromText(text),
      },
    ];
  }

  return filtered.map((heading, index) => {
    const headingIndex = headings.findIndex((item) => item === heading);
    const end = headings[headingIndex + 1]?.index ?? text.length;
    const info = sceneHeadingInfo(heading.title);
    const name = info.name || heading.title;
    const prompt = `${heading.title}\n\n${text.slice(heading.end, end)}`.trim();
    return {
      id: `draft-scene-${index + 1}`,
      name,
      prompt,
      environment: splitSceneNameParts(name),
      props: inferPropsFromText(prompt),
    };
  });
}

function createEmptyDraftScene(index: number): DraftScene {
  return {
    id: `draft-scene-manual-${Date.now()}-${index}`,
    name: "场景草稿",
    prompt: "",
    environment: [],
    props: [],
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ReferenceGroup({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-[--text-secondary]">{title}</div>
      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-[--border-subtle] px-3 py-3 text-xs text-[--text-muted]">
          {empty}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">{items}</div>
      )}
    </div>
  );
}

export default function EpisodesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const locale = useLocale();
  const t = useTranslations("episode");
  const tc = useTranslations("common");
  const {
    episodes,
    loading,
    fetchEpisodes,
    createEpisode,
    updateEpisode,
  } = useEpisodeStore();
  const providers = useModelStore((s) => s.providers);
  const defaultVideoModel = useModelStore((s) => s.defaultVideoModel);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingEpisode, setEditingEpisode] = useState<Episode | null>(null);
  const [playingEpisode, setPlayingEpisode] = useState<Episode | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);
  const [episodeListOpen, setEpisodeListOpen] = useState(true);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  const [episodeDetail, setEpisodeDetail] = useState<EpisodeDetail | null>(null);
  const [projectCharacters, setProjectCharacters] = useState<EpisodeCharacter[]>([]);
  const [importCharacterAssets, setImportCharacterAssets] = useState<LibraryAsset[]>([]);
  const [environmentAssets, setEnvironmentAssets] = useState<LibraryAsset[]>([]);
  const [itemAssets, setItemAssets] = useState<LibraryAsset[]>([]);
  const [sceneAssetSelections, setSceneAssetSelections] = useState<SceneAssetSelections>({});
  const [assetPicker, setAssetPicker] = useState<{ sceneId: string; category: AssetCategory } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedSceneIds, setExpandedSceneIds] = useState<Set<string>>(new Set());
  const [columnFractions, setColumnFractions] = useState({ left: 1, middle: 1.35, right: 1 });
  const [savingShotId, setSavingShotId] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [selectedVideoModel, setSelectedVideoModel] = useState<ModelRef | null>(null);
  const [selectedVideoResolution, setSelectedVideoResolution] = useState("720p");
  const [selectedVideoDuration, setSelectedVideoDuration] = useState(5);
  const [draftSceneEdits, setDraftSceneEdits] = useState<DraftScene[] | null>(null);
  const [draftSceneMenuOpen, setDraftSceneMenuOpen] = useState<string | null>(null);
  const [storyboardSceneMenuOpen, setStoryboardSceneMenuOpen] = useState<string | null>(null);
  const [storyboardSceneActionId, setStoryboardSceneActionId] = useState<string | null>(null);
  const [generatingStoryboardSceneId, setGeneratingStoryboardSceneId] = useState<string | null>(null);
  const [generatingStoryboardShotId, setGeneratingStoryboardShotId] = useState<string | null>(null);

  const activeEpisode = useMemo(
    () => episodes.find((episode) => episode.id === activeEpisodeId) || episodes[0],
    [episodes, activeEpisodeId]
  );

  const draftSceneSource = useMemo(
    () =>
      episodeDetail?.script ||
      episodeDetail?.idea ||
      episodeDetail?.description ||
      activeEpisode?.script ||
      activeEpisode?.idea ||
      activeEpisode?.description ||
      "",
    [
      activeEpisode?.description,
      activeEpisode?.idea,
      activeEpisode?.script,
      episodeDetail?.description,
      episodeDetail?.idea,
      episodeDetail?.script,
    ]
  );

  const draftSceneSourceSignature = useMemo(
    () => draftSourceSignature(draftSceneSource, activeEpisode?.sequence),
    [activeEpisode?.sequence, draftSceneSource]
  );

  const draftSceneStorageKey = activeEpisodeId
    ? `episodeDraftScenes:v4:${projectId}:${activeEpisodeId}:${draftSceneSourceSignature}`
    : null;

  useEffect(() => {
    fetchEpisodes(projectId);
  }, [projectId, fetchEpisodes]);

  const applyEpisodeDetail = useCallback((data: EpisodeDetail) => {
    setEpisodeDetail(data);
    setPromptDrafts((prev) => {
      const next = { ...prev };
      for (const shot of data.shots || []) {
        if (!(shot.id in next) || looksLikeRawStoryboardText(next[shot.id])) {
          next[shot.id] = storyboardPromptFromShot(shot);
        }
      }
      return next;
    });
  }, []);

  const loadEpisodeDetail = useCallback(
    async (episodeId: string, options?: { showLoading?: boolean }) => {
      if (options?.showLoading) setDetailLoading(true);
      try {
        const res = await apiFetch(`/api/projects/${projectId}/episodes/${episodeId}`);
        if (!res.ok) throw new Error(await res.text());
        return (await res.json()) as EpisodeDetail;
      } finally {
        if (options?.showLoading) setDetailLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/projects/${projectId}/characters`)
      .then((res) => res.json())
      .then((data: EpisodeCharacter[]) => {
        if (!cancelled) setProjectCharacters(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Project characters load error:", err);
          setProjectCharacters([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch(`/api/projects/${projectId}/import/logs`).then((res) => res.json()),
      apiFetch(`/api/projects/${projectId}/assets`).then((res) => res.json()),
      apiFetch(`/api/projects/${projectId}/import/state`).then((res) => res.json()),
    ])
      .then(([logs, assetData, importState]: [
        Array<{ step: number; status: string; metadata?: unknown }>,
        { assets?: StoryLibraryAssetLike[] },
        {
          characters?: ImportAssetLike[] | null;
          environments?: ImportAssetLike[] | null;
          items?: ImportAssetLike[] | null;
        } | null,
      ]) => {
        if (cancelled) return;
        const assetLog = [...(Array.isArray(logs) ? logs : [])]
          .reverse()
          .find((log) => log.step === 3 && log.status === "done" && log.metadata);
        const metadata = assetLog?.metadata as
          | {
              characters?: ImportAssetLike[];
              environments?: ImportAssetLike[];
              items?: ImportAssetLike[];
            }
          | undefined;
        const storyAssets = Array.isArray(assetData?.assets) ? storyAssetsToLibraryAssets(assetData.assets) : [];
        setImportCharacterAssets(uniqueLibraryAssets([
          ...importAssetsToLibraryAssets("characters", metadata?.characters, "导入角色"),
          ...storyAssets.filter((asset) => asset.category === "characters"),
          ...importAssetsToLibraryAssets("characters", importState?.characters || undefined, "导入角色"),
        ]));
        setEnvironmentAssets(uniqueLibraryAssets([
          ...importAssetsToLibraryAssets("environments", metadata?.environments, "场景"),
          ...storyAssets.filter((asset) => asset.category === "environments"),
          ...importAssetsToLibraryAssets("environments", importState?.environments || undefined, "场景"),
        ]));
        setItemAssets(uniqueLibraryAssets([
          ...importAssetsToLibraryAssets("items", metadata?.items, "物品"),
          ...storyAssets.filter((asset) => asset.category === "items"),
          ...importAssetsToLibraryAssets("items", importState?.items || undefined, "物品"),
        ]));
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Import asset library load error:", err);
          setImportCharacterAssets([]);
          setEnvironmentAssets([]);
          setItemAssets([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (episodes.length === 0) {
      setActiveEpisodeId(null);
      setEpisodeDetail(null);
      return;
    }
    if (!activeEpisodeId || !episodes.some((episode) => episode.id === activeEpisodeId)) {
      setActiveEpisodeId(episodes[0].id);
    }
  }, [episodes, activeEpisodeId]);

  useEffect(() => {
    if (!activeEpisodeId) return;
    let cancelled = false;
    setDetailLoading(true);
    loadEpisodeDetail(activeEpisodeId)
      .then((data) => {
        if (!cancelled) applyEpisodeDetail(data);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Episode detail load error:", err);
          toast.error(err instanceof Error ? err.message : "分集详情加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeEpisodeId, applyEpisodeDetail, loadEpisodeDetail]);

  useEffect(() => {
    setExpandedSceneIds(new Set());
    setPromptDrafts({});
    setSceneAssetSelections({});
    setDraftSceneMenuOpen(null);
    setStoryboardSceneMenuOpen(null);
    setStoryboardSceneActionId(null);
    setGeneratingStoryboardSceneId(null);
    setGeneratingStoryboardShotId(null);
  }, [activeEpisodeId]);

  useEffect(() => {
    if (!draftSceneStorageKey) {
      setDraftSceneEdits(null);
      return;
    }
    try {
      if (activeEpisodeId) {
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
          const key = localStorage.key(index);
          if (
            key &&
            key.startsWith("episodeDraftScenes:") &&
            key.includes(`:${projectId}:${activeEpisodeId}`) &&
            key !== draftSceneStorageKey
          ) {
            localStorage.removeItem(key);
          }
        }
      }
      const raw = localStorage.getItem(draftSceneStorageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      const stored = parsed as Partial<StoredDraftScenes> | null;
      const scenes =
        stored &&
        stored.version === 4 &&
        stored.sourceSignature === draftSceneSourceSignature &&
        Array.isArray(stored.scenes) &&
        !stored.scenes.some((scene) =>
          containsOtherEpisodeMarker(`${scene.name}\n${scene.prompt}`, activeEpisode?.sequence)
        )
          ? stored.scenes
          : null;
      setDraftSceneEdits(scenes);
    } catch {
      setDraftSceneEdits(null);
    }
  }, [activeEpisode?.sequence, activeEpisodeId, draftSceneSourceSignature, draftSceneStorageKey, projectId]);

  useEffect(() => {
    if (!draftSceneStorageKey || draftSceneEdits === null) return;
    const payload: StoredDraftScenes = {
      version: 4,
      sourceSignature: draftSceneSourceSignature,
      scenes: draftSceneEdits,
    };
    localStorage.setItem(draftSceneStorageKey, JSON.stringify(payload));
  }, [draftSceneEdits, draftSceneSourceSignature, draftSceneStorageKey]);

  // Close video modal on Escape
  useEffect(() => {
    if (!playingEpisode) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPlayingEpisode(null);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [playingEpisode]);

  async function handleCreate(data: { title: string; description?: string; keywords?: string }) {
    await createEpisode(projectId, data);
    toast.success(t("created"));
  }

  async function handleEdit(data: { title: string; description?: string; keywords?: string }) {
    if (!editingEpisode) return;
    await updateEpisode(projectId, editingEpisode.id, data);
    setEditingEpisode(null);
  }

  function toggleSelect(episode: Episode) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(episode.id)) next.delete(episode.id);
      else next.add(episode.id);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  async function handleMerge() {
    if (selectedIds.size < 2) {
      toast.error(t("mergeMinTwo"));
      return;
    }
    setMerging(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/merge-episodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeIds: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Merge failed");
      }
      const data = await res.json();
      setMergedVideoUrl(data.videoUrl);
      toast.success(t("mergeSuccess"));
      exitSelectionMode();
    } catch (err) {
      console.error("Merge error:", err);
      toast.error(err instanceof Error ? err.message : t("mergeError"));
    } finally {
      setMerging(false);
    }
  }

  async function saveShotPrompt(shot: EpisodeShot) {
    const nextPrompt = promptDrafts[shot.id] ?? "";
    setSavingShotId(shot.id);
    try {
      await apiFetch(`/api/projects/${projectId}/shots/${shot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPrompt: nextPrompt }),
      });
      setEpisodeDetail((prev) =>
        prev
          ? {
              ...prev,
              shots: prev.shots.map((item) =>
                item.id === shot.id ? { ...item, videoPrompt: nextPrompt } : item
              ),
            }
          : prev
      );
      toast.success(`镜头 ${shot.sequence} 故事板图提示词已保存`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存故事板图提示词失败");
    } finally {
      setSavingShotId(null);
    }
  }

  async function refreshActiveEpisodeDetail() {
    if (!activeEpisodeId) return;
    const data = await loadEpisodeDetail(activeEpisodeId);
    applyEpisodeDetail(data);
  }

  async function generateStoryboardImagesForScene(scene: StoryboardScene) {
    if (scene.shots.length === 0) return;
    setGeneratingStoryboardSceneId(scene.id);
    try {
      const items = scene.shots.map((shot) => ({
        shotId: shot.id,
        prompt: promptDrafts[shot.id] ?? storyboardPromptFromShot(shot, scene.name),
      }));
      const res = await apiFetch(`/api/projects/${projectId}/storyboard/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, overwrite: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成故事板图失败");
      await refreshActiveEpisodeDetail();
      const stats = data.stats || {};
      const failed = Number(stats.failed || 0);
      const succeeded = Number(stats.succeeded || 0);
      const skipped = Number(stats.skipped || 0);
      if (failed > 0) {
        toast.warning(`故事板图生成完成：成功 ${succeeded}，跳过 ${skipped}，失败 ${failed}`);
      } else {
        toast.success(`故事板图生成完成：成功 ${succeeded}，跳过 ${skipped}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成故事板图失败");
    } finally {
      setGeneratingStoryboardSceneId(null);
    }
  }

  async function regenerateStoryboardImageForShot(shot: EpisodeShot, sceneName: string) {
    setGeneratingStoryboardShotId(shot.id);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/storyboard/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shotId: shot.id,
          prompt: promptDrafts[shot.id] ?? storyboardPromptFromShot(shot, sceneName),
          overwrite: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成故事板图失败");
      const first = Array.isArray(data.results) ? data.results[0] : null;
      if (first?.status === "error") throw new Error(first.error || "生成故事板图失败");
      await refreshActiveEpisodeDetail();
      toast.success(`镜头 ${shot.sequence} 故事板图已生成`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成故事板图失败");
    } finally {
      setGeneratingStoryboardShotId(null);
    }
  }

  async function duplicateStoryboardScene(scene: StoryboardScene) {
    if (!activeEpisodeId || scene.shots.length === 0) return;
    setStoryboardSceneActionId(scene.id);
    try {
      const newSceneId = `scene-copy-${Date.now()}-${scene.id}`;
      const orderedShots = [...scene.shots].sort((a, b) => a.sequence - b.sequence);
      for (const shot of orderedShots) {
        const duplicateRes = await apiFetch(`/api/projects/${projectId}/shots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "duplicate", sourceShotId: shot.id }),
        });
        if (!duplicateRes.ok) throw new Error(await duplicateRes.text());
        const created = (await duplicateRes.json()) as EpisodeShot;
        const patchRes = await apiFetch(`/api/projects/${projectId}/shots/${created.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sceneId: newSceneId }),
        });
        if (!patchRes.ok) throw new Error(await patchRes.text());
      }
      await refreshActiveEpisodeDetail();
      toast.success("已复制分镜");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "复制分镜失败");
    } finally {
      setStoryboardSceneActionId(null);
    }
  }

  async function deleteStoryboardScene(scene: StoryboardScene) {
    setStoryboardSceneActionId(scene.id);
    try {
      const orderedShots = [...scene.shots].sort((a, b) => b.sequence - a.sequence);
      for (const shot of orderedShots) {
        const res = await apiFetch(`/api/projects/${projectId}/shots/${shot.id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(await res.text());
      }
      await refreshActiveEpisodeDetail();
      toast.success("已删除分镜");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除分镜失败");
    } finally {
      setStoryboardSceneActionId(null);
    }
  }

  async function addStoryboardScene() {
    if (!activeEpisodeId) return;
    setStoryboardSceneActionId("new");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/shots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          episodeId: activeEpisodeId,
          versionId: episodeDetail?.shots[0]?.versionId ?? null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = (await res.json()) as EpisodeShot;
      const patchRes = await apiFetch(`/api/projects/${projectId}/shots/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId: `scene-manual-${Date.now()}-${created.id}` }),
      });
      if (!patchRes.ok) throw new Error(await patchRes.text());
      await refreshActiveEpisodeDetail();
      toast.success("已添加分镜");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加分镜失败");
    } finally {
      setStoryboardSceneActionId(null);
    }
  }

  function chipClassName(episode: Episode, selected: boolean, selectable: boolean) {
    const base =
      "inline-flex h-9 max-w-[280px] shrink-0 items-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-all";
    if (selectionMode) {
      if (!selectable) {
        return `${base} cursor-not-allowed bg-black/[0.04] text-[--text-muted] opacity-45`;
      }
      return selected
        ? `${base} border border-primary/60 bg-primary/10 text-primary shadow-sm`
        : `${base} bg-black/[0.04] text-[--text-secondary] hover:bg-primary/8 hover:text-primary`;
    }

    if (episode.id === activeEpisodeId) {
      return `${base} border border-primary/60 bg-primary/10 text-primary shadow-sm`;
    }

    return episode.finalVideoUrl
      ? `${base} bg-black/[0.04] text-[--text-secondary] hover:bg-primary/8 hover:text-primary`
      : `${base} bg-primary/8 text-primary hover:bg-primary/12`;
  }

  function renderEpisodeChip(episode: Episode) {
    const selected = selectedIds.has(episode.id);
    const selectable = !!episode.finalVideoUrl;
    const label = formatEpisodeChipLabel(episode);
    const content = (
      <>
        <span className="truncate">{label}</span>
        {selectionMode && selected ? (
          <Check className="h-4 w-4 shrink-0" />
        ) : episode.finalVideoUrl ? (
          <Check className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : null}
      </>
    );

    if (selectionMode) {
      return (
        <button
          key={episode.id}
          type="button"
          disabled={!selectable}
          onClick={() => selectable && toggleSelect(episode)}
          className={chipClassName(episode, selected, selectable)}
          title={label}
        >
          {content}
        </button>
      );
    }

    return (
      <button
        key={episode.id}
        type="button"
        onClick={() => setActiveEpisodeId(episode.id)}
        className={chipClassName(episode, false, selectable)}
        title={label}
      >
        {content}
      </button>
    );
  }

  function toggleScene(sceneId: string) {
    setExpandedSceneIds((prev) => {
      const next = new Set(prev);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  }

  const storyboardScenes = useMemo(
    () => groupShotsByScene(episodeDetail?.shots || []),
    [episodeDetail?.shots]
  );

  const draftScenes = useMemo(() => {
    return parseDraftScenes(draftSceneSource, activeEpisode?.sequence);
  }, [activeEpisode?.sequence, draftSceneSource]);

  const usableDraftSceneEdits = useMemo(
    () =>
      isDraftSceneListCompatible(draftSceneEdits, draftScenes, activeEpisode?.sequence)
        ? draftSceneEdits
        : null,
    [activeEpisode?.sequence, draftSceneEdits, draftScenes]
  );

  useEffect(() => {
    if (
      draftSceneEdits &&
      !isDraftSceneListCompatible(draftSceneEdits, draftScenes, activeEpisode?.sequence)
    ) {
      setDraftSceneEdits(null);
    }
  }, [activeEpisode?.sequence, draftSceneEdits, draftScenes]);

  const characterAssets = useMemo(() => {
    const projectAssets = uniqueCharacters([...(episodeDetail?.characters || []), ...projectCharacters]).map(characterToLibraryAsset);
    return uniqueLibraryAssets([...projectAssets, ...importCharacterAssets]);
  }, [episodeDetail?.characters, importCharacterAssets, projectCharacters]);

  const assetPools = useMemo<Record<AssetCategory, LibraryAsset[]>>(
    () => ({
      characters: characterAssets,
      environments: environmentAssets,
      items: itemAssets,
    }),
    [characterAssets, environmentAssets, itemAssets]
  );

  const fallbackDraftScenes = useMemo<DraftScene[]>(
    () =>
      (usableDraftSceneEdits ?? draftScenes).length
        ? (usableDraftSceneEdits ?? draftScenes)
        : [
            {
              id: "draft-scene-empty",
              name: "场景草稿",
              prompt: "请在这里填写本集第一组故事板镜头描述。只保留静态画面、构图、环境氛围和资产参考。",
              environment: [],
              props: [],
            },
          ],
    [draftScenes, usableDraftSceneEdits]
  );

  const videoModelOptions = useMemo(
    () =>
      providers
        .filter((provider) => provider.capability === "video")
        .flatMap((provider) =>
          provider.models
            .filter((model) => model.checked)
            .map((model) => ({
              key: `${provider.id}:${model.id}`,
              providerId: provider.id,
              providerName: provider.name,
              protocol: provider.protocol,
              modelId: model.id,
              label: model.name || model.id,
            }))
        ),
    [providers]
  );

  const activeVideoModel = useMemo(
    () => videoModelOptions.find((option) => option.key === modelRefKey(selectedVideoModel)) || videoModelOptions[0],
    [selectedVideoModel, videoModelOptions]
  );

  const videoResolutionOptions = useMemo(
    () => getVideoResolutionOptions(activeVideoModel?.modelId),
    [activeVideoModel?.modelId]
  );

  const videoDurationOptions = useMemo(
    () => getVideoDurationOptions(activeVideoModel?.modelId),
    [activeVideoModel?.modelId]
  );

  useEffect(() => {
    if (selectedVideoModel && videoModelOptions.some((option) => option.key === modelRefKey(selectedVideoModel))) return;
    const fallback =
      (defaultVideoModel &&
        videoModelOptions.find((option) => option.key === modelRefKey(defaultVideoModel))) ||
      videoModelOptions[0];
    setSelectedVideoModel(fallback ? { providerId: fallback.providerId, modelId: fallback.modelId } : null);
  }, [defaultVideoModel, selectedVideoModel, videoModelOptions]);

  useEffect(() => {
    if (!videoResolutionOptions.includes(selectedVideoResolution)) {
      setSelectedVideoResolution(videoResolutionOptions[0] || "720p");
    }
  }, [selectedVideoResolution, videoResolutionOptions]);

  useEffect(() => {
    if (!videoDurationOptions.includes(selectedVideoDuration)) {
      setSelectedVideoDuration(videoDurationOptions[0] || 5);
    }
  }, [selectedVideoDuration, videoDurationOptions]);

  useEffect(() => {
    setSceneAssetSelections((prev) => {
      let changed = false;
      const next: SceneAssetSelections = { ...prev };
      for (const scene of fallbackDraftScenes) {
        const characterOptions = getSceneAssetOptions(scene, "characters", assetPools);
        const environmentOptions = getSceneAssetOptions(scene, "environments", assetPools);
        const itemOptions = getSceneAssetOptions(scene, "items", assetPools);
        const current = next[scene.id] || {};
        const defaults = {
          characters: inferDefaultAssetIds(scene, characterOptions, "characters"),
          environments: inferDefaultAssetIds(scene, environmentOptions, "environments"),
          items: inferDefaultAssetIds(scene, itemOptions, "items"),
        };
        const patched = { ...current };
        let sceneChanged = false;
        (["characters", "environments", "items"] as AssetCategory[]).forEach((category) => {
          const optionIds = new Set(
            getSceneAssetOptions(scene, category, assetPools).map((asset) => asset.id)
          );
          const currentSelection = patched[category];
          const hasValidSelection = Array.isArray(currentSelection)
            && currentSelection.some((assetId) => optionIds.has(assetId));
          if ((!hasValidSelection || patched[category] === undefined) && defaults[category].length > 0) {
            patched[category] = defaults[category];
            sceneChanged = true;
          }
        });
        if (sceneChanged) {
          next[scene.id] = patched;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [assetPools, fallbackDraftScenes]);

  const totalShots = episodeDetail?.shots.length || 0;
  const visibleSceneCount = storyboardScenes.length || fallbackDraftScenes.length;
  const shotsWithStoryboardFrames =
    episodeDetail?.shots.filter((shot) =>
      getActiveAsset(shot, "first_frame")?.fileUrl ||
      getActiveAssets(shot, "reference")[0]?.fileUrl ||
      getActiveAsset(shot, "last_frame")?.fileUrl
    ).length || 0;

  function startColumnResize(side: "left" | "right", event: ReactPointerEvent<HTMLButtonElement>) {
    const startX = event.clientX;
    const start = { ...columnFractions };
    event.currentTarget.setPointerCapture(event.pointerId);

    function handleMove(moveEvent: PointerEvent) {
      const delta = (moveEvent.clientX - startX) / 180;
      if (side === "left") {
        setColumnFractions({
          left: clamp(start.left + delta, 0.65, 2.1),
          middle: clamp(start.middle - delta, 0.85, 2.4),
          right: start.right,
        });
      } else {
        setColumnFractions({
          left: start.left,
          middle: clamp(start.middle + delta, 0.85, 2.4),
          right: clamp(start.right - delta, 0.65, 2.1),
        });
      }
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }

  function charactersForScene(scene: StoryboardScene) {
    if (!episodeDetail) return [];
    const availableCharacters = uniqueCharacters([...episodeDetail.characters, ...projectCharacters]);
    const names = new Set<string>();
    for (const shot of scene.shots) {
      shot.dialogues?.forEach((dialogue) => names.add(dialogue.characterName));
      (shot.assets || []).forEach((asset) => asset.characters?.forEach((name) => names.add(name)));
      availableCharacters.forEach((character) => {
        const text = `${shot.prompt || ""} ${shot.videoScript || ""} ${shot.videoPrompt || ""}`;
        if (text.includes(character.name)) names.add(character.name);
      });
    }
    const matched = availableCharacters.filter((character) => names.has(character.name));
    return matched.length ? matched : availableCharacters.slice(0, 6);
  }

  function referenceAssetsForScene(scene: StoryboardScene) {
    const activeRefs = scene.shots.flatMap((shot) =>
      getActiveAssets(shot, "reference").map((asset) => ({ asset, shot }))
    );
    const environment = activeRefs.filter(({ asset }) => asset.meta?.sceneName || asset.fileUrl);
    const props = activeRefs.filter(({ asset }) => !asset.meta?.sceneName && (!asset.characters || asset.characters.length === 0));
    return {
      environment: environment.length ? environment : activeRefs.slice(0, 3),
      props: props.slice(0, 6),
    };
  }

  function renderAssetThumb(label: string, subtitle: string, src?: string | null) {
    return (
      <div className="inline-flex max-w-[180px] items-center gap-1.5 rounded-full border border-[--border-subtle] bg-white px-2 py-1 shadow-sm">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[--surface] text-[10px] font-bold text-primary">
          {src ? (
            <img src={uploadUrl(src)} alt={label} className="h-full w-full object-cover" />
          ) : (
            label.slice(0, 2)
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold leading-tight text-[--text-primary]">{label}</div>
          <div className="truncate text-[10px] leading-tight text-[--text-muted]">{subtitle}</div>
        </div>
      </div>
    );
  }

  function renderAssetPreviewCard(asset: LibraryAsset) {
    return (
      <div className="w-[112px] overflow-hidden rounded-lg border border-[--border-subtle] bg-white shadow-sm transition-colors hover:border-primary/35">
        <div className="flex h-[86px] items-center justify-center bg-[--surface] p-1.5">
          <img
            src={uploadUrl(asset.imageUrl || "")}
            alt={asset.name}
            className="h-full w-full object-contain"
          />
        </div>
        <div className="border-t border-[--border-subtle] px-2 py-1.5">
          <div className="truncate text-[11px] font-semibold leading-tight text-[--text-primary]">{asset.name}</div>
          <div className="mt-0.5 truncate text-[10px] leading-tight text-[--text-muted]">{asset.subtitle}</div>
        </div>
      </div>
    );
  }

  function renderReferenceColumn(scene: StoryboardScene) {
    const sceneRefs = referenceAssetsForScene(scene);
    const characters = charactersForScene(scene);
    const sortedCharacters = [...characters].sort((a, b) => Number(Boolean(b.referenceImage)) - Number(Boolean(a.referenceImage)));
    return (
      <div className="space-y-3">
        <ReferenceGroup title="角色" empty="暂无角色素材">
          {sortedCharacters.map((character) => (
            <Link
              key={character.id}
              href={`/${locale}/project/${projectId}/characters`}
              title={character.name}
            >
              {renderAssetThumb(
                character.name,
                character.referenceImage
                  ? character.scope === "guest" ? "客串角色参考" : "主要角色参考"
                  : "资产库待补图",
                character.referenceImage
              )}
            </Link>
          ))}
        </ReferenceGroup>
        <ReferenceGroup title="环境" empty="暂无环境素材">
          {sceneRefs.environment.map(({ asset, shot }) => (
            <div key={asset.id}>
              {renderAssetThumb(asset.meta?.sceneName || getSceneReferenceName(shot), `镜头 ${shot.sequence}`, asset.fileUrl)}
            </div>
          ))}
        </ReferenceGroup>
        <ReferenceGroup title="物品" empty="暂无物品素材">
          {sceneRefs.props.map(({ asset, shot }) => (
            <div key={asset.id}>
              {renderAssetThumb(asset.prompt ? compactText(asset.prompt, 16) : `参考 ${asset.sequenceInType + 1}`, `镜头 ${shot.sequence}`, asset.fileUrl)}
            </div>
          ))}
        </ReferenceGroup>
      </div>
    );
  }

  function renderPromptColumn(scene: StoryboardScene) {
    return (
      <div className="space-y-3">
        {scene.shots.map((shot) => {
          const original = storyboardPromptFromShot(shot, scene.name);
          const draft = promptDrafts[shot.id] ?? original;
          const dirty = draft !== original;
          return (
            <div key={shot.id} className="rounded-2xl border-2 border-black bg-[#d2d2d0] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="font-mono text-xs font-bold text-black">镜头 {shot.sequence}</div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-black/70 px-2 py-0.5 text-[10px] text-white">静态故事板帧</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={dirty ? "default" : "outline"}
                    disabled={savingShotId === shot.id || !dirty}
                    onClick={() => saveShotPrompt(shot)}
                    className="h-7 rounded-full px-3 text-[11px]"
                  >
                    {savingShotId === shot.id && <Loader2 className="h-3 w-3 animate-spin" />}
                    保存
                  </Button>
                </div>
              </div>
              <textarea
                value={draft}
                onChange={(event) =>
                  setPromptDrafts((prev) => ({ ...prev, [shot.id]: event.target.value }))
                }
                placeholder="这里编辑该镜头的故事板图提示词，只保留静态画面、构图和资产参考。"
                className="min-h-[128px] w-full resize-y rounded-xl border border-black/30 bg-white/70 p-3 font-mono text-xs leading-relaxed text-black outline-none focus:border-primary"
              />
              <div className="mt-2 grid gap-1 text-[10px] text-black/60">
                {shot.videoScript && <div className="line-clamp-2">后续阶段脚本 metadata：{shot.videoScript}</div>}
                {shot.motionScript && <div className="line-clamp-2">动作：{shot.motionScript}</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderResizeHandle(side: "left" | "right", label: string) {
    return (
      <button
        type="button"
        aria-label={label}
        onPointerDown={(event) => startColumnResize(side, event)}
        className="group hidden cursor-col-resize items-stretch justify-center bg-transparent px-0 xl:flex"
      >
        <span className="w-px bg-black/20 transition-colors group-hover:bg-primary/60" />
      </button>
    );
  }

  function renderVideoSettingsBar(sceneDuration?: number) {
    void sceneDuration;
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-black/80 p-2 text-[10px] text-white">
        <span className="rounded-md border border-white/15 bg-white/10 px-2 py-1 font-semibold">故事板图提示词</span>
        <span className="rounded-md border border-white/15 bg-white/10 px-2 py-1">静态关键帧</span>
        <span className="rounded-md border border-white/15 bg-white/10 px-2 py-1">图片比例 16:9</span>
      </div>
    );
  }

  function renderTextChip(label: string, subtitle: string) {
    return (
      <span className="inline-flex max-w-[180px] items-center gap-1.5 rounded-full border border-[--border-subtle] bg-white px-2.5 py-1 text-xs font-semibold text-[--text-primary] shadow-sm">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-[10px] font-normal text-[--text-muted]">{subtitle}</span>
      </span>
    );
  }

  function toggleSceneAsset(sceneId: string, category: AssetCategory, assetId: string, defaultIds: string[]) {
    setSceneAssetSelections((prev) => {
      const current = prev[sceneId]?.[category] ?? defaultIds;
      const selected = current.includes(assetId);
      return {
        ...prev,
        [sceneId]: {
          ...prev[sceneId],
          [category]: selected ? current.filter((id) => id !== assetId) : [...current, assetId],
        },
      };
    });
  }

  function removeSceneAsset(scene: DraftScene, category: AssetCategory, assetId: string) {
    const options = getSceneAssetOptions(scene, category, assetPools);
    const defaultIds = inferDefaultAssetIds(scene, options, category);
    setSceneAssetSelections((prev) => {
      const current = prev[scene.id]?.[category] ?? defaultIds;
      return {
        ...prev,
        [scene.id]: {
          ...prev[scene.id],
          [category]: current.filter((id) => id !== assetId),
        },
      };
    });
  }

  function selectedAssetsForScene(scene: DraftScene, category: AssetCategory) {
    const options = getSceneAssetOptions(scene, category, assetPools);
    const selectedIds = sceneAssetSelections[scene.id]?.[category];
    const defaultIds = selectedIds ?? inferDefaultAssetIds(scene, options, category);
    const byId = new Map(options.map((asset) => [asset.id, asset]));
    const selectedAssets = defaultIds.map((id) => byId.get(id)).filter(Boolean) as LibraryAsset[];
    if (selectedAssets.length > 0 || selectedIds === undefined) return selectedAssets;
    return inferDefaultAssetIds(scene, options, category)
      .map((id) => byId.get(id))
      .filter(Boolean) as LibraryAsset[];
  }

  function renderAssetPicker(scene: DraftScene, category: AssetCategory, options: LibraryAsset[]) {
    const open = assetPicker?.sceneId === scene.id && assetPicker.category === category;
    if (!open) return null;
    const defaultIds = inferDefaultAssetIds(scene, options, category);
    const selected = new Set(sceneAssetSelections[scene.id]?.[category] ?? defaultIds);
    return (
      <div className="rounded-xl border border-black/10 bg-white p-2 shadow-sm">
        {options.length === 0 ? (
          <div className="px-2 py-3 text-xs text-[--text-muted]">素材库暂无可选素材</div>
        ) : (
          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {options.map((asset) => {
              const checked = selected.has(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => toggleSceneAsset(scene.id, category, asset.id, defaultIds)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                    checked ? "bg-primary/10 text-primary" : "hover:bg-black/[0.04]"
                  }`}
                  title={asset.description || asset.visualHint || asset.name}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[--surface] text-[10px] font-bold">
                    {asset.imageUrl ? (
                      <img src={uploadUrl(asset.imageUrl)} alt={asset.name} className="h-full w-full object-cover" />
                    ) : (
                      asset.name.slice(0, 2)
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{asset.name}</span>
                    <span className="block truncate text-[10px] text-[--text-muted]">{asset.subtitle}</span>
                  </span>
                  {checked && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderSelectedAssetChip(scene: DraftScene, category: AssetCategory, asset: LibraryAsset) {
    const hasImage = Boolean(asset.imageUrl);
    const visual = hasImage || category === "characters";
    return (
      <div key={asset.id} className="group relative inline-flex">
        <button
          type="button"
          onClick={() => setAssetPicker({ sceneId: scene.id, category })}
          title={asset.description || asset.visualHint || asset.name}
          className="text-left"
        >
          {hasImage
            ? renderAssetPreviewCard(asset)
            : visual
              ? renderAssetThumb(asset.name, asset.subtitle, asset.imageUrl)
            : renderTextChip(asset.name, asset.subtitle)}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            removeSceneAsset(scene, category, asset.id);
          }}
          aria-label={`取消选择 ${asset.name}`}
          title="取消选择"
          className="absolute -right-1.5 -top-1.5 z-10 flex h-4 w-4 scale-90 items-center justify-center rounded-full border border-[--border-subtle] bg-[--elevated] text-[--text-muted] opacity-0 shadow-sm transition-all hover:border-primary/40 hover:bg-primary hover:text-white group-hover:scale-100 group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  function renderEditableReferenceGroup(
    scene: DraftScene,
    category: AssetCategory,
    title: string,
    empty: string
  ) {
    const options = getSceneAssetOptions(scene, category, assetPools);
    const selectedAssets = selectedAssetsForScene(scene, category);
    const pickerOpen = assetPicker?.sceneId === scene.id && assetPicker.category === category;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-[--text-secondary]">{title}</div>
          <button
            type="button"
            onClick={() =>
              setAssetPicker((prev) =>
                prev?.sceneId === scene.id && prev.category === category ? null : { sceneId: scene.id, category }
              )
            }
            className="inline-flex h-6 items-center gap-1 rounded-full border border-black/10 bg-white px-2 text-[10px] font-semibold text-[--text-secondary] hover:border-primary/40 hover:text-primary"
          >
            <Plus className="h-3 w-3" />
            编辑
          </button>
        </div>
        {selectedAssets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[--border-subtle] px-3 py-3 text-xs text-[--text-muted]">
            {empty}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedAssets.map((asset) => renderSelectedAssetChip(scene, category, asset))}
          </div>
        )}
        {pickerOpen && renderAssetPicker(scene, category, options)}
      </div>
    );
  }

  function renderDraftReferenceColumn(scene: DraftScene) {
    return (
      <div className="space-y-4">
        {renderEditableReferenceGroup(scene, "characters", "角色", "资产库暂无角色图片")}
        {renderEditableReferenceGroup(scene, "environments", "环境", "暂无场景参考图")}
        {renderEditableReferenceGroup(scene, "items", "物品", "暂无物品参考图")}
        <Link
          href={`/${locale}/project/${projectId}/characters`}
          className="inline-flex text-[11px] font-semibold text-primary hover:underline"
        >
          去资产库补图
        </Link>
      </div>
    );
  }

  function updateDraftSceneList(updater: (scenes: DraftScene[]) => DraftScene[]) {
    setDraftSceneEdits((prev) => {
      const base = prev ?? fallbackDraftScenes;
      return updater(base);
    });
  }

  function duplicateDraftScene(sceneIndex: number) {
    updateDraftSceneList((scenes) => {
      const source = scenes[sceneIndex];
      if (!source) return scenes;
      const copy: DraftScene = {
        ...source,
        id: `draft-scene-copy-${Date.now()}-${sceneIndex}`,
        environment: [...source.environment],
        props: [...source.props],
      };
      return [...scenes.slice(0, sceneIndex + 1), copy, ...scenes.slice(sceneIndex + 1)];
    });
  }

  function deleteDraftScene(sceneIndex: number) {
    updateDraftSceneList((scenes) => scenes.filter((_, index) => index !== sceneIndex));
  }

  function addDraftScene() {
    updateDraftSceneList((scenes) => [...scenes, createEmptyDraftScene(scenes.length + 1)]);
  }

  function updateDraftScenePrompt(sceneId: string, prompt: string) {
    updateDraftSceneList((scenes) =>
      scenes.map((scene) => (scene.id === sceneId ? { ...scene, prompt } : scene))
    );
  }

  function storyboardPromptFromDraftScene(scene: DraftScene) {
    if (
      /Storyboard key frame image|Storyboard still|Static frame:/i.test(scene.prompt) &&
      !looksLikeRawStoryboardText(scene.prompt)
    ) {
      return scene.prompt;
    }
    return buildStoryboardPromptPreviewFromText({
      title: scene.name,
      sourceText: scene.prompt || scene.name,
      characterNames: selectedAssetsForScene(scene, "characters").map((asset) => asset.name),
      sceneNames: selectedAssetsForScene(scene, "environments").map((asset) => asset.name),
      propNames: selectedAssetsForScene(scene, "items").map((asset) => asset.name),
    });
  }

  function renderDraftSceneCard(scene: DraftScene, sceneIndex: number) {
    const storyboardPrompt = storyboardPromptFromDraftScene(scene);
    return (
      <article key={scene.id} className="overflow-hidden rounded-xl bg-[#e8e8e6] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-2xl font-bold text-[--text-primary]">
              S{String(sceneIndex + 1).padStart(2, "0")} - {scene.name}
            </h3>
            <p className="mt-1 text-xs text-[--text-muted]">脚本场景草稿 · 等待拆成正式镜头</p>
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setDraftSceneMenuOpen((openId) => (openId === scene.id ? null : scene.id))}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-[--text-secondary] shadow-sm transition-colors hover:bg-white hover:text-primary"
              aria-label="分镜操作"
              title="分镜操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {draftSceneMenuOpen === scene.id && (
              <div className="absolute right-0 top-full z-30 mt-1 min-w-[120px] overflow-hidden rounded-xl border border-[--border-subtle] bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    duplicateDraftScene(sceneIndex);
                    setDraftSceneMenuOpen(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[--text-secondary] hover:bg-[--surface] hover:text-[--text-primary]"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteDraftScene(sceneIndex);
                    setDraftSceneMenuOpen(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </button>
                <button
                  type="button"
                  onClick={() => {
                    addDraftScene();
                    setDraftSceneMenuOpen(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[--text-secondary] hover:bg-[--surface] hover:text-[--text-primary]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加
                </button>
              </div>
            )}
          </div>
        </div>
        <div
          className="grid min-h-[300px] grid-cols-1 gap-3 xl:grid-cols-[var(--storyboard-cols)]"
          style={{
            ["--storyboard-cols" as string]: `${columnFractions.left}fr 8px ${columnFractions.middle}fr 8px ${columnFractions.right}fr`,
          }}
        >
          <section className="min-w-0 bg-[#d2d2d0] p-4">
            {renderDraftReferenceColumn(scene)}
          </section>
          {renderResizeHandle("left", "拖动调整参考素材和提示词宽度")}
          <section className="min-w-0 bg-[#d2d2d0] p-4">
            <textarea
              value={storyboardPrompt}
              onChange={(event) => updateDraftScenePrompt(scene.id, event.target.value)}
              className="mx-auto min-h-[160px] w-full max-w-[88%] resize-y rounded-2xl border-2 border-black bg-white/70 p-4 text-xs leading-relaxed text-black outline-none"
            />
            {renderVideoSettingsBar()}
          </section>
          {renderResizeHandle("right", "拖动调整提示词和故事板图宽度")}
          <section className="min-w-0 bg-[#d2d2d0] p-4">
            <div className="flex min-h-[200px] items-center justify-center text-sm font-semibold text-black/50">
              等待生成故事板图
            </div>
          </section>
        </div>
      </article>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-[--text-muted]">{tc("loading")}</p>
        </div>
      </div>
    );
  }

  const workflowNavItems = [
    { label: "剧情审阅", icon: AlertCircle, href: `/${locale}/project/${projectId}/import` },
    { label: "资产设定", icon: Users, href: `/${locale}/project/${projectId}/import?step=assets` },
    { label: "自动分集", icon: Layers, href: `/${locale}/project/${projectId}/import` },
    { label: "创建分集", icon: Plus, href: `/${locale}/project/${projectId}/import` },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-frame-grid pb-24 lg:pb-6">
      <div className="shrink-0 border-b border-[--border-subtle] bg-[#070A10]/88 px-3 py-2 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          <Link
            href={`/${locale}`}
            className="flex h-10 w-[180px] shrink-0 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-[--text-primary] transition-colors hover:bg-[--surface] hover:text-primary md:w-[220px]"
            title={t("title")}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="truncate">返回项目</span>
          </Link>

          <div className="flex min-w-[760px] flex-1 gap-2">
            {workflowNavItems.map(({ label, icon: Icon, href }) => (
              <Link
                key={label}
                href={href}
                className="relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[--border-subtle] bg-[--surface]/70 px-2.5 text-left text-[--text-primary] transition-all duration-200 hover:border-primary/45 hover:bg-primary/10 hover:text-primary"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/12">
                  <Icon className="h-4 w-4" />
                </div>
                <span className="truncate text-xs font-medium xl:text-sm">{label}</span>
              </Link>
            ))}
            <span className="relative flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-2.5 text-left text-primary shadow-sm">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Layers className="h-4 w-4" />
              </div>
              <span className="truncate text-xs font-semibold xl:text-sm">分集管理</span>
              <div className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-primary" />
            </span>
          </div>
        </div>
      </div>

      {/* Episode chips */}
      {episodes.length === 0 ? (
        <div className="frame-panel flex min-h-[400px] flex-col items-center justify-center rounded-lg border-dashed p-8 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-gradient-to-br from-[--brand-cyan] via-[--brand-blue] to-[--brand-violet] shadow-[0_0_32px_rgba(47,107,255,0.35)]">
            <Layers className="h-7 w-7 text-primary" />
          </div>
          <h3 className="frame-gradient-text font-display text-lg font-extrabold">
            {t("title")}
          </h3>
          <p className="mt-2 max-w-sm text-sm text-[--text-secondary]">
            {t("noEpisodes")}
          </p>
          <div className="mt-6 flex items-center gap-3">
            <Button onClick={() => setCreateOpen(true)} className="rounded-xl">
              <Plus className="mr-1.5 h-4 w-4" />
              {t("create")}
            </Button>
            <Link href={`/${locale}/project/${projectId}/import`}>
              <Button variant="outline" className="rounded-xl">
                <Upload className="mr-1.5 h-4 w-4" />
                {t("uploadScript")}
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <section
            className={`relative z-20 bg-white pb-3 transition-all ${
              episodeListOpen
                ? "rounded-2xl px-3 pt-3 shadow-[0_12px_34px_rgba(15,23,42,0.12)] ring-1 ring-black/5"
                : ""
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="mt-2 shrink-0 text-xl font-bold text-black">
                分集:
              </span>
              <div className="relative min-w-0 flex-1">
                <div
                  className={`flex gap-2.5 ${
                    episodeListOpen
                      ? "max-h-[120px] flex-wrap overflow-y-auto pr-1"
                      : "h-9 flex-nowrap overflow-hidden"
                  }`}
                >
                  {episodes.map((episode) => renderEpisodeChip(episode))}
                </div>
                {!episodeListOpen && (
                  <div className="pointer-events-none absolute bottom-0 right-0 top-0 w-16 bg-gradient-to-r from-transparent to-white" />
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => setEpisodeListOpen((open) => !open)}
                className="h-9 shrink-0 rounded-full border-black/40 px-4 text-xs font-semibold text-black hover:border-primary/50 hover:bg-primary/8"
              >
                {episodeListOpen ? "收起" : `展开全部 ${episodes.length} 集`}
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${episodeListOpen ? "rotate-180" : ""}`}
                />
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (selectionMode) exitSelectionMode();
                  else setSelectionMode(true);
                }}
                className="h-9 shrink-0 rounded-full border-black/40 px-4 text-xs font-semibold text-black hover:border-primary/50 hover:bg-primary/8"
                disabled={episodes.filter((e) => e.finalVideoUrl).length < 2}
              >
                <Merge className="mr-1.5 h-3.5 w-3.5" />
                {selectionMode ? t("mergeCancel") : t("mergeVideos")}
              </Button>
              <Button onClick={() => setCreateOpen(true)} className="h-9 shrink-0 rounded-full px-4 text-xs">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t("create")}
              </Button>
            </div>
          </section>

          {!selectionMode && (
            <section className="overflow-hidden bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Film className="h-4 w-4 text-primary" />
                    <h3 className="truncate text-sm font-semibold text-[--text-primary]">
                      {activeEpisode ? formatEpisodeChipLabel(activeEpisode) : "分镜工作台"}
                    </h3>
                    {detailLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  </div>
                  <p className="mt-1 text-xs text-[--text-muted]">
                    {episodeDetail
                      ? `${visibleSceneCount} 个场景 · ${episodeDetail.shots.length} 个镜头 · ${episodeDetail.characters.length || projectCharacters.length} 个角色参考`
                      : "选择上方分集后查看该集分镜"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-black/[0.04] px-3 py-1 text-xs font-semibold text-[--text-muted]">
                    已有故事板图 {shotsWithStoryboardFrames}/{totalShots}
                  </span>
                </div>
              </div>

              {detailLoading ? (
                <div className="flex min-h-[360px] items-center justify-center">
                  <div className="flex flex-col items-center gap-3 text-sm text-[--text-muted]">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    加载分镜中...
                  </div>
                </div>
              ) : !episodeDetail || storyboardScenes.length === 0 ? (
                <div className="max-h-[calc(100vh-220px)] space-y-5 overflow-y-auto bg-white p-3">
                  {fallbackDraftScenes.map((scene, sceneIndex) => renderDraftSceneCard(scene, sceneIndex))}
                </div>
              ) : (
                <div className="max-h-[calc(100vh-220px)] space-y-5 overflow-y-auto bg-white p-3">
                  {storyboardScenes.map((scene, sceneIndex) => {
                    const expanded = expandedSceneIds.has(scene.id);
                    const sceneActionBusy = storyboardSceneActionId === scene.id || storyboardSceneActionId === "new";
                    const sceneGenerating = generatingStoryboardSceneId === scene.id;
                    const sceneFrameAssets = scene.shots
                      .map((shot) => ({ shot, asset: getActiveAsset(shot, "first_frame") }))
                      .filter((item) => item.asset?.fileUrl);
                    return (
                      <article key={scene.id} className="overflow-hidden rounded-xl bg-[#e8e8e6] p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => toggleScene(scene.id)}
                            className="flex min-w-0 items-center gap-3 text-left"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-mono text-xs font-bold text-primary">
                              {expanded ? "−" : "+"}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-2xl font-bold text-[--text-primary]">
                                S{String(sceneIndex + 1).padStart(2, "0")} - {scene.name}
                              </span>
                              <span className="text-xs text-[--text-muted]">
                                {scene.shots.length} 个小镜头 · 可展开查看明细
                              </span>
                            </span>
                          </button>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleScene(scene.id)}
                              className="rounded-full bg-white/80"
                            >
                              {expanded ? "收起" : "展开"}
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                            </Button>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setStoryboardSceneMenuOpen((openId) => (openId === scene.id ? null : scene.id))}
                                disabled={!!storyboardSceneActionId}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-[--text-secondary] shadow-sm transition-colors hover:bg-white hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label="分镜操作"
                                title="分镜操作"
                              >
                                {sceneActionBusy ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <MoreHorizontal className="h-4 w-4" />
                                )}
                              </button>
                              {storyboardSceneMenuOpen === scene.id && (
                                <div className="absolute right-0 top-full z-30 mt-1 min-w-[120px] overflow-hidden rounded-xl border border-[--border-subtle] bg-white py-1 shadow-lg">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStoryboardSceneMenuOpen(null);
                                      duplicateStoryboardScene(scene);
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[--text-secondary] hover:bg-[--surface] hover:text-[--text-primary]"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    复制
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStoryboardSceneMenuOpen(null);
                                      deleteStoryboardScene(scene);
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    删除
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStoryboardSceneMenuOpen(null);
                                      addStoryboardScene();
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[--text-secondary] hover:bg-[--surface] hover:text-[--text-primary]"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    添加
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div
                          className="grid min-h-[310px] grid-cols-1 gap-3 xl:grid-cols-[var(--storyboard-cols)]"
                          style={{
                            ["--storyboard-cols" as string]: `${columnFractions.left}fr 8px ${columnFractions.middle}fr 8px ${columnFractions.right}fr`,
                          }}
                        >
                          <section className="min-w-0 bg-[#d2d2d0] p-4">
                            {renderReferenceColumn(scene)}
                          </section>

                          {renderResizeHandle("left", "拖动调整参考素材和提示词宽度")}

                          <section className="min-w-0 bg-[#d2d2d0] p-4">
                            {renderPromptColumn(scene)}
                            {renderVideoSettingsBar(scene.shots.reduce((sum, shot) => sum + (shot.duration || 0), 0))}
                          </section>

                          {renderResizeHandle("right", "拖动调整提示词和故事板图宽度")}

                          <section className="min-w-0 bg-[#d2d2d0] p-4">
                            <div className="min-h-[238px] rounded-xl border border-[--border-subtle] bg-white p-3">
                              <div className="mb-3 flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-[--text-primary]">故事板图</div>
                                  <div className="text-[10px] text-[--text-muted]">
                                    {sceneFrameAssets.length}/{scene.shots.length} 已生成
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => generateStoryboardImagesForScene(scene)}
                                  disabled={sceneGenerating}
                                  className="h-8 rounded-full px-3 text-[11px]"
                                >
                                  {sceneGenerating ? (
                                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  ) : (
                                    <ImageIcon className="mr-1 h-3 w-3" />
                                  )}
                                  生成故事板图
                                </Button>
                              </div>
                              {sceneFrameAssets.length > 0 ? (
                                <div className="grid grid-cols-2 gap-2">
                                  {sceneFrameAssets.map(({ shot, asset }) => (
                                    <div key={asset!.id} className="overflow-hidden rounded-lg border border-[--border-subtle] bg-[--surface]">
                                      <div className="aspect-video bg-black/5">
                                        <img
                                          src={uploadUrl(asset!.fileUrl || "")}
                                          alt={`镜头 ${shot.sequence} 故事板图`}
                                          className="h-full w-full object-cover"
                                        />
                                      </div>
                                      <div className="px-2 py-1 text-[10px] font-semibold text-[--text-secondary]">
                                        镜头 {shot.sequence}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="flex min-h-[176px] flex-col items-center justify-center gap-3 text-center text-sm text-[--text-muted]">
                                  <ImageIcon className="h-8 w-8 text-[--text-muted]" />
                                  <span>{scene.name}</span>
                                  <span className="text-xs">等待生成故事板图</span>
                                </div>
                              )}
                            </div>
                          </section>
                        </div>

                        {expanded && (
                          <div className="space-y-2 border-t border-[--border-subtle] bg-white px-3 py-3">
                            {scene.shots.map((shot) => {
                              const thumb =
                                getActiveAsset(shot, "first_frame")?.fileUrl ||
                                getActiveAssets(shot, "reference")[0]?.fileUrl ||
                                getActiveAsset(shot, "last_frame")?.fileUrl;
                              return (
                                <div
                                  key={shot.id}
                                  className="grid gap-3 rounded-lg border border-[--border-subtle] bg-[--surface]/40 p-3 md:grid-cols-[72px_minmax(0,1fr)_168px]"
                                >
                                  <div className="flex h-12 w-full items-center justify-center overflow-hidden rounded-md bg-white">
                                    {thumb ? (
                                      <img src={uploadUrl(thumb)} alt={`镜头 ${shot.sequence}`} className="h-full w-full object-cover" />
                                    ) : (
                                      <ImageIcon className="h-5 w-5 text-[--text-muted]" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-mono text-xs font-bold text-primary">镜头 {shot.sequence}</div>
                                    <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-[--text-secondary]">
                                      {compactText(storyboardPromptFromShot(shot, scene.name), 220) || "暂无提示词"}
                                    </div>
                                  </div>
                                  <div className="flex flex-col items-end justify-center gap-2">
                                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                                      thumb
                                        ? "bg-emerald-50 text-emerald-700"
                                        : "bg-black/[0.04] text-[--text-muted]"
                                    }`}>
                                      {thumb ? "已有故事板图" : "待生成故事板图"}
                                    </span>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={thumb ? "outline" : "default"}
                                      disabled={generatingStoryboardShotId === shot.id}
                                      onClick={() => regenerateStoryboardImageForShot(shot, scene.name)}
                                      className="h-7 rounded-full px-3 text-[10px]"
                                    >
                                      {generatingStoryboardShotId === shot.id ? (
                                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                      ) : (
                                        <ImageIcon className="mr-1 h-3 w-3" />
                                      )}
                                      {thumb ? "重生成" : "生成"}
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Floating selection action bar */}
      {selectionMode && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-[--border-subtle] bg-white px-5 py-3 shadow-xl">
          <span className="text-sm font-medium text-[--text-secondary]">
            {t("mergeSelected", { count: selectedIds.size })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={exitSelectionMode}
          >
            {t("mergeCancel")}
          </Button>
          <Button
            size="sm"
            disabled={selectedIds.size < 2 || merging}
            onClick={handleMerge}
          >
            {merging ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {t("merging")}
              </>
            ) : (
              t("mergeConfirm")
            )}
          </Button>
        </div>
      )}

      {/* Create dialog */}
      <EpisodeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        mode="create"
      />

      {/* Edit dialog */}
      <EpisodeDialog
        open={!!editingEpisode}
        onOpenChange={(open) => { if (!open) setEditingEpisode(null); }}
        onSubmit={handleEdit}
        defaultValues={editingEpisode ? {
          title: editingEpisode.title,
          description: editingEpisode.description || "",
          keywords: editingEpisode.keywords || "",
        } : undefined}
        mode="edit"
      />

      {/* Video player modal */}
      {playingEpisode && playingEpisode.finalVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPlayingEpisode(null)}
        >
          <div
            className="relative w-[90%] max-w-3xl overflow-hidden rounded-2xl bg-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPlayingEpisode(null)}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <X className="h-4 w-4" />
            </button>
            <video
              src={uploadUrl(playingEpisode.finalVideoUrl)}
              controls
              autoPlay
              className="w-full"
            />
            <div className="flex items-center justify-between bg-[#111] px-5 py-3">
              <span className="text-sm font-semibold text-white">{playingEpisode.title}</span>
              <span className="font-mono text-xs text-[#666]">
                EP.{String(playingEpisode.sequence).padStart(2, "0")}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Merged video preview + download modal */}
      {mergedVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setMergedVideoUrl(null)}
        >
          <div
            className="relative w-[90%] max-w-3xl overflow-hidden rounded-2xl bg-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setMergedVideoUrl(null)}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <X className="h-4 w-4" />
            </button>
            <video
              src={uploadUrl(mergedVideoUrl)}
              controls
              autoPlay
              className="w-full"
            />
            <div className="flex items-center justify-between bg-[#111] px-5 py-3">
              <span className="text-sm font-semibold text-white">{t("mergeVideos")}</span>
              <a
                href={uploadUrl(mergedVideoUrl)}
                download
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                <Download className="h-3.5 w-3.5" />
                {t("downloadVideo")}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
