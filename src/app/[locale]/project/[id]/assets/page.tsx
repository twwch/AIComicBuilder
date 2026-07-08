"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import {
  ArrowLeft,
  Box,
  Check,
  ImageIcon,
  Loader2,
  Map,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AssetType = "character" | "scene" | "prop";

interface AssetVariant {
  id: string;
  name: string;
  variantType: string;
  state: string;
  visualConstraints: string;
  referenceImage: string | null;
  status: "draft" | "generated" | "reviewing" | "approved" | "rejected" | "locked";
}

interface AssetSource {
  id: string;
  occurrenceType: string;
  evidenceText: string;
  importance: number;
}

interface StoryAsset {
  id: string;
  type: AssetType;
  name: string;
  aliases: string[];
  importance: number;
  importanceLabel: string;
  description: string;
  visualConstraints: string;
  negativeConstraints: string;
  confirmed: number;
  referenceImage: string | null;
  variants: AssetVariant[];
  sources: AssetSource[];
  detail?: Record<string, unknown> | null;
}

const tabs: Array<{ type: AssetType | "all"; label: string; icon: typeof Box }> = [
  { type: "all", label: "全部", icon: Box },
  { type: "character", label: "角色", icon: UserRound },
  { type: "scene", label: "场景", icon: Map },
  { type: "prop", label: "物品", icon: ImageIcon },
];

function assetTypeLabel(type: AssetType) {
  if (type === "character") return "角色";
  if (type === "scene") return "场景";
  return "物品";
}

function statusLabel(status: AssetVariant["status"]) {
  const labels: Record<AssetVariant["status"], string> = {
    draft: "草稿",
    generated: "已生成",
    reviewing: "待审",
    approved: "已确认",
    rejected: "退回",
    locked: "锁定",
  };
  return labels[status];
}

export default function ProjectAssetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const locale = useLocale();
  const [assets, setAssets] = useState<StoryAsset[]>([]);
  const [activeType, setActiveType] = useState<AssetType | "all">("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/assets`);
      const data = await res.json();
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (activeType !== "all" && asset.type !== activeType) return false;
      if (!needle) return true;
      return [
        asset.name,
        asset.description,
        asset.visualConstraints,
        ...(asset.aliases || []),
        ...(asset.variants || []).map((variant) => `${variant.name} ${variant.state}`),
      ].some((text) => text.toLowerCase().includes(needle));
    });
  }, [activeType, assets, query]);

  const counts = useMemo(() => {
    return assets.reduce(
      (acc, asset) => {
        acc.all += 1;
        acc[asset.type] += 1;
        return acc;
      },
      { all: 0, character: 0, scene: 0, prop: 0 } as Record<AssetType | "all", number>,
    );
  }, [assets]);

  async function confirmAsset(asset: StoryAsset) {
    setSavingId(asset.id);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!res.ok) throw new Error("confirm failed");
      const updated = await res.json();
      setAssets((prev) => prev.map((item) => item.id === asset.id ? updated : item));
      toast.success("资产已确认");
    } catch {
      toast.error("确认失败");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[--surface]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-[--text-muted]">正在加载资产库</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[--surface] p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href={`/${locale}/project/${projectId}/episodes`}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-[--border-subtle] bg-white text-[--text-secondary] transition-colors hover:text-primary"
              aria-label="返回"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-[--text-primary]">资产库</h1>
              <p className="text-sm text-[--text-muted]">
                Mention 来源、Asset 主体、Variant 状态与人工确认
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={loadAssets}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        </header>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2 rounded-lg border border-[--border-subtle] bg-white p-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeType === tab.type;
              return (
                <button
                  key={tab.type}
                  onClick={() => setActiveType(tab.type)}
                  className={`flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-white"
                      : "text-[--text-muted] hover:bg-[--surface] hover:text-[--text-primary]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  <span className={active ? "text-white/80" : "text-[--text-muted]"}>
                    {counts[tab.type]}
                  </span>
                </button>
              );
            })}
          </div>
          <label className="relative block w-full md:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[--text-muted]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="搜索名称、别名、状态"
            />
          </label>
        </div>

        {filteredAssets.length === 0 ? (
          <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-dashed border-[--border-subtle] bg-white">
            <p className="text-sm text-[--text-muted]">暂无资产。先从剧本导入流程生成资产草稿。</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[--border-subtle] bg-white">
            <div className="grid grid-cols-[1.2fr_0.9fr_1.1fr_0.8fr_120px] border-b border-[--border-subtle] bg-[--surface] px-4 py-2 text-xs font-semibold text-[--text-muted] max-lg:hidden">
              <span>资产主体</span>
              <span>变体</span>
              <span>来源</span>
              <span>生产约束</span>
              <span className="text-right">状态</span>
            </div>
            <div className="divide-y divide-[--border-subtle]">
              {filteredAssets.map((asset) => (
                <article
                  key={asset.id}
                  className="grid gap-4 px-4 py-4 lg:grid-cols-[1.2fr_0.9fr_1.1fr_0.8fr_120px]"
                >
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                        {assetTypeLabel(asset.type)}
                      </span>
                      <span className="rounded-md bg-[--surface] px-2 py-1 text-xs text-[--text-muted]">
                        {asset.importanceLabel}
                      </span>
                    </div>
                    <h2 className="truncate text-base font-semibold text-[--text-primary]">{asset.name}</h2>
                    {asset.aliases?.length > 0 && (
                      <p className="mt-1 text-xs text-[--text-muted]">别名：{asset.aliases.join("、")}</p>
                    )}
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-[--text-secondary]">
                      {asset.description || "暂无描述"}
                    </p>
                  </div>

                  <div className="space-y-2">
                    {(asset.variants || []).slice(0, 4).map((variant) => (
                      <div key={variant.id} className="rounded-md border border-[--border-subtle] p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-[--text-primary]">{variant.name}</span>
                          <span className="shrink-0 text-xs text-[--text-muted]">{statusLabel(variant.status)}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[--text-muted]">
                          {variant.state || variant.visualConstraints || "默认状态"}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    {(asset.sources || []).slice(0, 3).map((source) => (
                      <p key={source.id} className="line-clamp-2 rounded-md bg-[--surface] px-2 py-1.5 text-xs leading-5 text-[--text-secondary]">
                        {source.evidenceText || "导入资产草稿"}
                      </p>
                    ))}
                  </div>

                  <div className="min-w-0">
                    <p className="line-clamp-4 text-sm leading-6 text-[--text-secondary]">
                      {asset.visualConstraints || "暂无视觉约束"}
                    </p>
                  </div>

                  <div className="flex items-start justify-end">
                    {asset.confirmed ? (
                      <span className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-50 px-3 text-sm font-medium text-emerald-700">
                        <ShieldCheck className="h-4 w-4" />
                        已确认
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => confirmAsset(asset)}
                        disabled={savingId === asset.id}
                      >
                        {savingId === asset.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="mr-2 h-4 w-4" />
                        )}
                        确认
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
