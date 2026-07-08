"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Eye, EyeOff, Bot, Save, Pencil, X } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  platform: string;
  category: string;
  appId: string;
  apiKey: string;
  description: string;
}

const PLATFORMS = [
  { value: "bailian", labelKey: "bailian" },
  // { value: "dify", labelKey: "dify" },
  { value: "coze", labelKey: "coze" },
] as const;

const CATEGORIES = [
  { value: "script_outline", labelKey: "scriptOutline" },
  { value: "script_generate", labelKey: "scriptGenerate" },
  { value: "script_parse", labelKey: "scriptParse" },
  { value: "script_visual_enrichment", labelKey: "scriptVisualEnrichment" },
  { value: "character_extract", labelKey: "characterExtract" },
  { value: "shot_split", labelKey: "shotSplit" },
  { value: "keyframe_prompts", labelKey: "keyframePrompts" },
  { value: "video_prompts", labelKey: "videoPrompts" },
  { value: "ref_image_prompts", labelKey: "refImagePrompts" },
  { value: "ref_video_prompts", labelKey: "refVideoPrompts" },
] as const;

const EMPTY_FORM = {
  name: "",
  platform: "bailian" as string,
  category: CATEGORIES[0].value as string,
  appId: "",
  apiKey: "",
  description: "",
};

export function AgentSection() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await apiFetch("/api/agents");
      const data = await res.json();
      setAgents(data);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditingId(null);
  }

  function startEdit(agent: Agent) {
    setForm({
      name: agent.name,
      platform: agent.platform || "bailian",
      category: agent.category,
      appId: agent.appId,
      apiKey: agent.apiKey,
      description: agent.description || "",
    });
    setEditingId(agent.id);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.appId || !form.apiKey) return;
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/api/agents/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      } else {
        await apiFetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      resetForm();
      await fetchAgents();
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiFetch(`/api/agents/${id}`, { method: "DELETE" });
      setAgents((prev) => prev.filter((a) => a.id !== id));
      if (editingId === id) resetForm();
    } catch {
      // silently fail
    }
  }

  function toggleKeyVisibility(id: string) {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function categoryLabel(value: string) {
    const cat = CATEGORIES.find((c) => c.value === value);
    if (!cat) return value;
    return t(`agentCategory_${cat.labelKey}`);
  }

  function platformLabel(value: string) {
    const p = PLATFORMS.find((pl) => pl.value === value);
    if (!p) return value;
    return t(`agentPlatform_${p.labelKey}`);
  }

  const isEditing = editingId !== null;

  return (
    <div className="frame-panel rounded-lg p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
          <Bot className="h-3.5 w-3.5" />
          {t("agents")}
        </h3>
        {!showForm && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { resetForm(); setShowForm(true); }}
            className="h-7 gap-1 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("addAgent")}
          </Button>
        )}
      </div>

      {/* Add / Edit Agent Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-4 space-y-3 rounded-xl border border-[--border-subtle] bg-[--surface] p-4"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-[--text-primary]">
              {isEditing ? t("editAgent") : t("addAgent")}
            </span>
            <button
              type="button"
              onClick={resetForm}
              className="flex h-5 w-5 items-center justify-center rounded text-[--text-muted] hover:text-[--text-primary] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("agentName")}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("agentNamePlaceholder")}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("agentPlatform")}</Label>
              <select
                value={form.platform}
                onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(`agentPlatform_${p.labelKey}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("agentCategory")}</Label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {t(`agentCategory_${c.labelKey}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("agentAppId")}</Label>
              <Input
                value={form.appId}
                onChange={(e) => setForm((f) => ({ ...f, appId: e.target.value }))}
                placeholder="app-xxxxxxxxxxxx"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">API Key</Label>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder="sk-xxxxxxxxxxxx"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("agentDescription")}</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t("agentDescriptionPlaceholder")}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetForm}
              className="h-7 text-xs"
            >
              {tc("cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !form.name || !form.appId || !form.apiKey}
              className="h-7 gap-1 text-xs"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "..." : tc("save")}
            </Button>
          </div>
        </form>
      )}

      {/* Agent List */}
      {agents.length === 0 ? (
        <p className="py-6 text-center text-xs text-[--text-muted]">
          {t("noAgents")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[--border-subtle]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[--border-subtle] bg-[--surface]">
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[--text-muted]">{t("agentName")}</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[--text-muted]">{t("agentPlatform")}</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[--text-muted]">{t("agentCategory")}</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[--text-muted]">{t("agentAppId")}</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[--text-muted]">API Key</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-[--text-muted]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--border-subtle]">
              {agents.map((agent) => (
                <tr
                  key={agent.id}
                  className={`transition-colors hover:bg-[--surface] ${editingId === agent.id ? "bg-primary/5" : ""}`}
                >
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-[--text-primary]">{agent.name}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center rounded-full bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted] border border-[--border-subtle]">
                      {platformLabel(agent.platform || "bailian")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {categoryLabel(agent.category)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-xs text-[--text-muted]">
                      {agent.appId.length > 20
                        ? agent.appId.slice(0, 10) + "..." + agent.appId.slice(-6)
                        : agent.appId}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleKeyVisibility(agent.id)}
                      className="inline-flex items-center gap-1 text-xs text-[--text-muted] hover:text-[--text-primary] transition-colors"
                    >
                      {visibleKeys.has(agent.id) ? (
                        <>
                          <EyeOff className="h-3 w-3" />
                          <span className="font-mono">
                            {agent.apiKey.slice(0, 8)}...{agent.apiKey.slice(-4)}
                          </span>
                        </>
                      ) : (
                        <>
                          <Eye className="h-3 w-3" />
                          <span>••••••••</span>
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(agent)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-primary/10 hover:text-primary"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(agent.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] transition-colors hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
