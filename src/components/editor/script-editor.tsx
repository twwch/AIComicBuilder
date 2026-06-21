"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useProjectStore } from "@/stores/project-store";
import { useModelStore } from "@/stores/model-store";
import { STYLE_PRESETS, extractVisualStyleReference, extractVisualStyleValue, findStylePresetIdByReference, formatStylePreset } from "@/lib/style-presets";
import { useTranslations } from "next-intl";
import { Sparkles, Loader2, FileText, Lightbulb, ListOrdered } from "lucide-react";
import { InlineModelPicker } from "@/components/editor/model-selector";
import { VideoModelStrategyBadge } from "@/components/editor/video-model-strategy-badge";
import { VisualStyleBadge } from "@/components/editor/visual-style-badge";
import { AgentPicker } from "@/components/agent-picker";
import { apiFetch } from "@/lib/api-fetch";
import { useModelGuard } from "@/hooks/use-model-guard";
import { PromptEditButton } from "@/components/prompt-templates/prompt-edit-button";
import { toast } from "sonner";

export function ScriptEditor() {
  const t = useTranslations();
  const { project, updateIdea, updateScript, fetchProject } = useProjectStore();
  const getModelConfig = useModelStore((s) => s.getModelConfig);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingOutline, setGeneratingOutline] = useState(false);
  const [outline, setOutline] = useState(project?.outline || "");
  const [selectedStyleId, setSelectedStyleId] = useState(STYLE_PRESETS[0]?.id ?? "");
  const textGuard = useModelGuard("text");
  const scriptTextareaRef = useRef<HTMLTextAreaElement>(null);

  function applyStylePreset() {
    const selected = STYLE_PRESETS.find((style) => style.id === selectedStyleId);
    if (!selected || !project) return;
    const styleLine = `视觉风格参考：${formatStylePreset(selected)}`;
    const existing = project.idea || "";
    const lines = existing.split(/\r?\n/);
    const idx = lines.findIndex((line) => line.startsWith("视觉风格参考："));
    const next = idx >= 0
      ? lines.map((line, i) => (i === idx ? styleLine : line)).join("\n")
      : `${existing.trim()}${existing.trim() ? "\n\n" : ""}${styleLine}`;
    updateIdea(next);

    if (project.script) {
      const scriptLines = project.script.split(/\r?\n/);
      const scriptStyleLine = `视觉风格：${formatStylePreset(selected)}`;
      const scriptIdx = scriptLines.findIndex((line) => line.startsWith("视觉风格："));
      if (scriptIdx >= 0) {
        updateScript(scriptLines.map((line, i) => (i === scriptIdx ? scriptStyleLine : line)).join("\n"));
      }
    }

    scheduleSave();
  }

  // Sync outline from project when project data changes
  useEffect(() => {
    if (project?.outline !== undefined) {
      setOutline(project.outline || "");
    }
  }, [project?.outline]);

  useEffect(() => {
    if (generating && scriptTextareaRef.current) {
      const el = scriptTextareaRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [project?.script, generating]);

  // Auto-save: debounced (1.5s after last keystroke) + onBlur fallback
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  const persistNow = useCallback(async () => {
    const state = useProjectStore.getState();
    const proj = state.project;
    if (!proj || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const episodeId = state.currentEpisodeId;
    const url = episodeId
      ? `/api/projects/${proj.id}/episodes/${episodeId}`
      : `/api/projects/${proj.id}`;
    try {
      await apiFetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: proj.idea, script: proj.script, outline: proj.outline }),
      });
    } catch (err) {
      console.error("Auto-save error:", err);
    }
    savingRef.current = false;
    setSaving(false);
  }, []);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      persistNow();
    }, 1500);
  }, [persistNow]);

  // Clean up debounce on unmount and flush pending save
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        persistNow();
      }
    };
  }, [persistNow]);

  if (!project) return null;

  const currentVisualStyle = extractVisualStyleReference(project.idea) || extractVisualStyleValue(project.script);

  useEffect(() => {
    const matchedId = findStylePresetIdByReference(currentVisualStyle);
    if (matchedId && matchedId !== selectedStyleId) {
      setSelectedStyleId(matchedId);
    }
  }, [currentVisualStyle, selectedStyleId]);

  function handleSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    persistNow();
  }

  async function handleGenerateOutline() {
    if (!project) return;
    if (!textGuard()) return;
    setGeneratingOutline(true);
    setOutline("");

    try {
      const currentEpisodeId = useProjectStore.getState().currentEpisodeId;
      const resp = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "script_outline",
          payload: { idea: project.idea || "" },
          modelConfig: getModelConfig(),
          episodeId: currentEpisodeId,
        }),
      });
      if (!resp.ok) throw new Error("Failed to generate outline");

      // Stream response
      if (resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
          setOutline(fullText);
        }

        // Update store so it persists
        useProjectStore.setState((state) => ({
          project: state.project ? { ...state.project, outline: fullText } : null,
        }));
      }

      await fetchProject(project.id, currentEpisodeId ?? undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Outline generate error:", msg);
      toast.error(msg.includes("余额") || msg.includes("quota") || msg.includes("insufficient") ? msg : t("common.generationFailed"));
    } finally {
      setGeneratingOutline(false);
    }
  }

  function handleOutlineChange(value: string) {
    setOutline(value);
    // Update project store so auto-save picks it up
    useProjectStore.setState((state) => ({
      project: state.project ? { ...state.project, outline: value } : null,
    }));
    scheduleSave();
  }

  async function handleGenerateScript() {
    if (!project) return;
    if (!textGuard()) return;
    setGenerating(true);

    const idea = project.idea || "";
    const currentEpisodeId = useProjectStore.getState().currentEpisodeId;
    let currentOutline = outline;

    try {
      // Step 1: Auto-generate outline if empty (streaming)
      if (!currentOutline.trim()) {
        setGeneratingOutline(true);
        toast.info(t("project.generatingOutlineFirst") || "Generating outline first...");

        const outlineResp = await apiFetch(`/api/projects/${project.id}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "script_outline",
            payload: { idea },
            modelConfig: getModelConfig(),
            episodeId: currentEpisodeId,
          }),
        });

        if (outlineResp.ok && outlineResp.body) {
          const reader = outlineResp.body.getReader();
          const decoder = new TextDecoder();
          let fullOutline = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullOutline += decoder.decode(value, { stream: true });
            setOutline(fullOutline);
          }

          currentOutline = fullOutline;
          useProjectStore.setState((state) => ({
            project: state.project ? { ...state.project, outline: fullOutline } : null,
          }));
        }
        setGeneratingOutline(false);
      }

      // Step 2: Generate script (with outline if available)
      updateScript("");

      const response = await apiFetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "script_generate",
          payload: { idea, outline: currentOutline || undefined },
          modelConfig: getModelConfig(),
          episodeId: currentEpisodeId,
        }),
      });

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
          updateScript(fullText);
        }
      }

      await fetchProject(project.id, currentEpisodeId ?? undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Script generate error:", msg);
      toast.error(msg.includes("余额") || msg.includes("quota") || msg.includes("insufficient") ? msg : t("common.generationFailed"));
    }

    setGeneratingOutline(false);
    setGenerating(false);
  }

  return (
    <div className="animate-page-in space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/8">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
            {t("project.script")}
          </h2>
          <VisualStyleBadge idea={project.idea} script={project.script} />
          <VideoModelStrategyBadge />
        </div>
        <div className="flex items-center gap-2">
          <PromptEditButton promptKeys={["script_outline", "script_generate"]} projectId={project.id} />
          <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
            <SelectTrigger size="sm" className="max-w-64" />
            <SelectContent>
              {STYLE_PRESETS.map((style) => (
                <SelectItem key={style.id} value={style.id}>
                  {formatStylePreset(style)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={applyStylePreset}>
            插入风格
          </Button>
          <InlineModelPicker capability="text" />
          {saving && (
            <span className="flex items-center gap-1.5 text-xs text-[--text-muted]">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("common.saving")}
            </span>
          )}
        </div>
      </div>
      <div className="-mt-3">
        <VideoModelStrategyBadge showLabel={false} showHint />
      </div>

      {/* Idea input */}
      <div className="rounded-2xl border border-[--border-subtle] bg-white p-1.5">
        <div className="flex items-center gap-2 px-5 pt-3 pb-1">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
            {t("project.idea")}
          </span>
        </div>
        <Textarea
          value={project.idea}
          onChange={(e) => { updateIdea(e.target.value); scheduleSave(); }}
          onBlur={handleSave}
          placeholder={t("project.scriptIdeaPlaceholder")}
          rows={4}
          disabled={generating}
          className={`h-[30vh] resize-none overflow-y-auto rounded-xl border-0 bg-transparent px-5 pb-4 font-mono text-sm leading-relaxed placeholder:text-[--text-muted] focus-visible:ring-0 ${
            generating ? "opacity-40" : ""
          }`}
        />
      </div>

      {/* Outline + Generated script — side by side, fixed height */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Outline section */}
        <div className="flex flex-col rounded-2xl border border-[--border-subtle] bg-white p-1.5">
          <div className="flex items-center justify-between px-5 pt-3 pb-1">
            <div className="flex items-center gap-2">
              <ListOrdered className="h-3.5 w-3.5 text-violet-500" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
                {t("project.outline")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <AgentPicker projectId={project.id} category="script_outline" />
              <Button
                size="sm"
                onClick={handleGenerateOutline}
                disabled={generatingOutline || generating || !project.idea?.trim()}
              >
                {generatingOutline ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generatingOutline ? t("common.generating") : t("project.generateOutline")}
              </Button>
            </div>
          </div>

          <Textarea
            value={outline}
            onChange={(e) => handleOutlineChange(e.target.value)}
            onBlur={handleSave}
            placeholder={t("project.outlinePlaceholder")}
            disabled={generatingOutline}
            className={`h-[55vh] max-h-[55vh] resize-none overflow-y-auto rounded-xl border-0 bg-transparent px-5 pb-4 font-mono text-sm leading-relaxed placeholder:text-[--text-muted] focus-visible:ring-0 ${
              generatingOutline ? "opacity-40" : ""
            }`}
          />
        </div>

        {/* Generated script */}
        <div className="flex flex-col rounded-2xl border border-[--border-subtle] bg-white p-1.5">
          <div className="flex items-center justify-between px-5 pt-3 pb-1">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
                {t("project.generatedScript")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <AgentPicker projectId={project.id} category="script_generate" />
              <Button
                size="sm"
                onClick={handleGenerateScript}
                disabled={generating || generatingOutline || !project.idea?.trim()}
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generating ? t("common.generating") : t("project.generateScript")}
              </Button>
            </div>
          </div>
          {project.script ? (
            <Textarea
              ref={scriptTextareaRef}
              value={project.script}
              onChange={(e) => { updateScript(e.target.value); if (!generating) scheduleSave(); }}
              onBlur={() => { if (!generating) handleSave(); }}
              disabled={generating}
              className={`h-[55vh] max-h-[55vh] resize-none overflow-y-auto rounded-xl border-0 bg-transparent px-5 pb-4 font-mono text-sm leading-relaxed placeholder:text-[--text-muted] focus-visible:ring-0 ${
                generating ? "opacity-40" : ""
              }`}
            />
          ) : (
            <div className="h-[55vh] max-h-[55vh] overflow-y-auto px-5 pb-4 pt-2 text-sm text-[--text-muted]">
              {t("project.scriptPlaceholder") || "点击上方按钮生成剧本..."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
