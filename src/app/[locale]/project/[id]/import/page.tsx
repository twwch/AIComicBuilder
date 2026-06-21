"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Upload, FileText, Users, Layers, Sparkles,
  Loader2, Check, X, ArrowLeft, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";
import { useModelStore } from "@/stores/model-store";
import { useModelGuard } from "@/hooks/use-model-guard";
import { toast } from "sonner";

const ACCEPTED = ".txt,.docx,.pdf,.md,.markdown";
const MAX_SIZE = 20 * 1024 * 1024;

interface ExtractedCharacter {
  name: string;
  frequency: number;
  description: string;
  visualHint?: string;
  scope: "main" | "guest";
}

interface SplitEpisode {
  title: string;
  description: string;
  keywords: string;
  idea: string;
  characters?: string[];
}

interface LogEntry {
  id: string;
  step: number;
  status: "running" | "done" | "error";
  message: string;
  metadata?: unknown;
  createdAt: string | number;
}

type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { num: 1 as Step, icon: FileText, label: "importStep.parse" },
  { num: 2 as Step, icon: Users, label: "importStep.characters" },
  { num: 3 as Step, icon: Layers, label: "importStep.split" },
  { num: 4 as Step, icon: Sparkles, label: "importStep.generate" },
] as const;

export default function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("import");
  const textGuard = useModelGuard("text");
  const getModelConfig = useModelStore((s) => s.getModelConfig);

  // Pipeline state
  const [currentStep, setCurrentStep] = useState<Step | 0>(0);
  const [stepStatus, setStepStatus] = useState<Record<Step, "idle" | "running" | "done" | "error">>({
    1: "idle", 2: "idle", 3: "idle", 4: "idle",
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Step 0: Upload
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Step 1 result
  const [fullText, setFullText] = useState("");

  // Step 2 result
  const [characters, setCharacters] = useState<ExtractedCharacter[]>([]);
  const [relationships, setRelationships] = useState<Array<{ characterA: string; characterB: string; relationType: string; description?: string }>>([]);

  // Step 3 result
  const [episodes, setEpisodes] = useState<SplitEpisode[]>([]);

  // History mode
  const [historyMode, setHistoryMode] = useState(false);
  const [selectedStep, setSelectedStep] = useState<Step | null>(null);

  // Load existing logs on mount
  useEffect(() => {
    async function loadLogs() {
      try {
        const res = await apiFetch(`/api/projects/${projectId}/import/logs`);
        const data = await res.json();
        if (data.length > 0) {
          setLogs(data);
          setHistoryMode(true);
          // Determine last completed step
          const doneSteps = data.filter((l: LogEntry) => l.status === "done").map((l: LogEntry) => l.step);
          const maxDone = Math.max(0, ...doneSteps) as Step | 0;
          setCurrentStep(maxDone);
          for (let s = 1; s <= 4; s++) {
            const stepLogs = data.filter((l: LogEntry) => l.step === s);
            if (stepLogs.some((l: LogEntry) => l.status === "error")) {
              setStepStatus((prev) => ({ ...prev, [s]: "error" }));
            } else if (stepLogs.some((l: LogEntry) => l.status === "done")) {
              setStepStatus((prev) => ({ ...prev, [s]: "done" }));
            }
          }
        }
      } catch {
        // No logs, fresh import
      }
    }
    loadLogs();
  }, [projectId]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = useCallback((step: Step, status: LogEntry["status"], message: string) => {
    setLogs((prev) => [
      ...prev,
      { id: Date.now().toString(), step, status, message, createdAt: Date.now() },
    ]);
  }, []);

  const handleFile = useCallback((f: File) => {
    if (f.size > MAX_SIZE) {
      toast.error(t("fileTooLarge"));
      return;
    }
    setFile(f);
  }, [t]);

  // ── Step 1 + 2: Auto-run parse → character extraction ──
  async function startPipeline() {
    if (!file) return;
    if (!textGuard()) return;

    setHistoryMode(false);
    setLogs([]);

    // Clear old logs
    await apiFetch(`/api/projects/${projectId}/import/logs`, { method: "DELETE" });

    // Step 1: Parse
    setCurrentStep(1);
    setStepStatus((prev) => ({ ...prev, 1: "running" }));
    addLog(1, "running", `解析文件: ${file.name}`);

    let text: string;
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(`/api/projects/${projectId}/import/parse`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      text = data.text;
      setFullText(text);
      addLog(1, "done", `解析完成，共 ${data.charCount} 字`);
      setStepStatus((prev) => ({ ...prev, 1: "done" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Parse failed";
      addLog(1, "error", `文件解析失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 1: "error" }));
      return;
    }

    // Step 2: Character extraction (auto-continue)
    setCurrentStep(2);
    setStepStatus((prev) => ({ ...prev, 2: "running" }));
    addLog(2, "running", "开始角色提取...");

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, modelConfig: getModelConfig() }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCharacters(data.characters);
      setRelationships(data.relationships || []);
      const mainCount = data.characters.filter((c: ExtractedCharacter) => c.scope === "main").length;
      const guestCount = data.characters.length - mainCount;
      addLog(2, "done", `提取完成: ${mainCount} 个主角, ${guestCount} 个配角`);
      setStepStatus((prev) => ({ ...prev, 2: "done" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extract failed";
      addLog(2, "error", `角色提取失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 2: "error" }));
      return;
    }
  }

  // ── Step 2 only: Retry character extraction ──
  async function retryCharacterExtract() {
    if (!fullText) return;
    if (!textGuard()) return;

    setStepStatus((prev) => ({ ...prev, 2: "running" }));
    addLog(2, "running", "重试角色提取...");

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fullText, modelConfig: getModelConfig() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCharacters(data.characters);
      setRelationships(data.relationships || []);
      const mainCount = data.characters.filter((c: ExtractedCharacter) => c.scope === "main").length;
      const guestCount = data.characters.length - mainCount;
      addLog(2, "done", `提取完成: ${mainCount} 个主角, ${guestCount} 个配角`);
      setStepStatus((prev) => ({ ...prev, 2: "done" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extract failed";
      addLog(2, "error", `角色提取失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 2: "error" }));
    }
  }

  // ── Step 3: Split (triggered by user after reviewing characters) ──
  async function runSplit() {
    if (!textGuard()) return;

    setCurrentStep(3);
    setStepStatus((prev) => ({ ...prev, 3: "running" }));
    addLog(3, "running", "开始自动分集...");

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: fullText,
          allCharacters: characters.map((c) => ({ name: c.name, scope: c.scope })),
          modelConfig: getModelConfig(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setEpisodes(data.episodes);
      addLog(3, "done", `分集完成，共 ${data.episodes.length} 集`);
      setStepStatus((prev) => ({ ...prev, 3: "done" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Split failed";
      addLog(3, "error", `分集失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 3: "error" }));
    }
  }

  // ── Step 4: Generate (triggered by user after reviewing episodes) ──
  async function runGenerate() {
    setCurrentStep(4);
    setStepStatus((prev) => ({ ...prev, 4: "running" }));
    addLog(4, "running", `创建 ${episodes.length} 集和角色...`);

    try {
      const res = await apiFetch(`/api/projects/${projectId}/import/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodes,
          characters,
          relationships,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      addLog(4, "done", `导入完成！创建了 ${data.characterCount} 个角色和 ${data.episodes.length} 集`);
      setStepStatus((prev) => ({ ...prev, 4: "done" }));
      toast.success(t("complete"));
      setTimeout(() => {
        router.push(`/${locale}/project/${projectId}/episodes`);
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generate failed";
      addLog(4, "error", `创建失败: ${msg}`);
      setStepStatus((prev) => ({ ...prev, 4: "error" }));
    }
  }

  // Retry handler for any failed step
  function retryStep() {
    const failedStep = ([1, 2, 3, 4] as Step[]).find((s) => stepStatus[s] === "error");
    if (!failedStep) return;
    switch (failedStep) {
      case 1: // Re-run full pipeline (need file again)
        startPipeline();
        break;
      case 2:
        retryCharacterExtract();
        break;
      case 3:
        runSplit();
        break;
      case 4:
        runGenerate();
        break;
    }
  }

  function toggleScope(idx: number) {
    setCharacters((prev) =>
      prev.map((c, i) =>
        i === idx ? { ...c, scope: c.scope === "main" ? "guest" : "main" } : c
      )
    );
  }

  function updateEpisode(idx: number, field: keyof SplitEpisode, value: string) {
    setEpisodes((prev) =>
      prev.map((ep, i) => (i === idx ? { ...ep, [field]: value } : ep))
    );
  }

  function removeEpisode(idx: number) {
    setEpisodes((prev) => prev.filter((_, i) => i !== idx));
  }

  const stepIcon = (status: string) => {
    switch (status) {
      case "running": return <Loader2 className="h-4 w-4 animate-spin" />;
      case "done": return <Check className="h-4 w-4" />;
      case "error": return <AlertCircle className="h-4 w-4" />;
      default: return null;
    }
  };

  const stepColor = (status: string, selected: boolean) => {
    const base = (() => {
      switch (status) {
        case "running": return "border-primary/30 bg-primary/5 text-primary";
        case "done": return "border-transparent bg-[--surface] text-[--text-primary]";
        case "error": return "border-red-300 bg-red-50 text-red-500";
        default: return "border-transparent bg-[--surface] text-[--text-muted]";
      }
    })();
    if (selected) return base + " !bg-primary/10 !border-primary/40 !text-primary shadow-sm";
    return base;
  };

  // Show characters review after step 2 done + step 3 idle
  const showCharReview = stepStatus[2] === "done" && stepStatus[3] === "idle" && !historyMode;
  // Show episodes review after step 3 done + step 4 idle
  const showEpReview = stepStatus[3] === "done" && stepStatus[4] === "idle" && !historyMode;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Left: Steps sidebar */}
      <div className="flex w-56 shrink-0 flex-col border-r border-[--border-subtle] bg-white p-4">
        <button
          onClick={() => router.push(`/${locale}/project/${projectId}/episodes`)}
          className="mb-6 flex items-center gap-2 text-sm text-[--text-muted] hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToEpisodes")}
        </button>

        <h2 className="mb-4 font-display text-lg font-bold text-[--text-primary]">
          {t("title")}
        </h2>

        <div className="flex flex-col gap-2">
          {STEPS.map(({ num, icon: Icon, label }) => {
            const isClickable = historyMode && stepStatus[num] !== "idle";
            const isSelected = selectedStep === num;
            return (
              <button
                key={num}
                disabled={!isClickable}
                onClick={() => isClickable && setSelectedStep(isSelected ? null : num)}
                className={`relative flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 ${stepColor(stepStatus[num], isSelected)} ${isClickable ? "cursor-pointer hover:bg-primary/5" : ""}`}
              >
                {/* Left accent bar for selected */}
                {isSelected && (
                  <div className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                )}
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  stepStatus[num] === "done"
                    ? isSelected ? "bg-primary/15 text-primary" : "bg-emerald-100 text-emerald-600"
                    : stepStatus[num] === "running" ? "bg-primary/15"
                    : stepStatus[num] === "error" ? "bg-red-100"
                    : "bg-white"
                }`}>
                  {stepIcon(stepStatus[num]) || <Icon className="h-4 w-4" />}
                </div>
                <span className="text-sm font-medium">{t(label)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Content area */}
      <div className="flex flex-1 flex-col overflow-y-auto bg-[--surface] p-6">
        {/* Upload area (only when no step started) */}
        {currentStep === 0 && !historyMode && (
          <div className="mx-auto w-full max-w-xl space-y-6">
            {/* Drop zone */}
            <div
              className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : file
                    ? "border-emerald-300 bg-emerald-50/50"
                    : "border-[--border-subtle] bg-white"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
              {file ? (
                <div className="flex items-center gap-3">
                  <FileText className="h-10 w-10 text-emerald-500" />
                  <div>
                    <p className="text-sm font-medium text-[--text-primary]">{file.name}</p>
                    <p className="text-xs text-[--text-muted]">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="ml-2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/5"
                  >
                    <X className="h-3.5 w-3.5 text-[--text-muted]" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="mb-3 h-10 w-10 text-[--text-muted]" />
                  <p className="text-sm font-medium text-[--text-primary]">{t("dropHint")}</p>
                  <p className="mt-1 text-xs text-[--text-muted]">{t("supportedFormats")}</p>
                </>
              )}
            </div>

            <Button
              onClick={startPipeline}
              disabled={!file}
              className="w-full rounded-xl"
              size="lg"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {t("startImport")}
            </Button>
          </div>
        )}

        {/* Characters review (after step 2) */}
        {showCharReview && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-[--text-primary]">
                {t("reviewCharacters")}
              </h3>
              <Button onClick={runSplit} className="rounded-xl">
                {t("confirmAndSplit")}
              </Button>
            </div>
            <p className="text-sm text-[--text-muted]">{t("reviewCharactersHint")}</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {characters.map((char, idx) => (
                <div
                  key={idx}
                  className="group relative overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                >
                  {/* Top accent strip */}
                  <div className={`h-1 w-full ${char.scope === "main" ? "bg-gradient-to-r from-blue-500 to-blue-400" : "bg-gradient-to-r from-purple-500 to-purple-400"}`} />
                  <div className="p-3.5">
                    {/* Avatar + Name */}
                    <div className="mb-2.5 flex items-center gap-2.5">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold text-white"
                        style={{ background: `linear-gradient(135deg, hsl(${(char.name.charCodeAt(0) * 37) % 360}, 45%, 45%), hsl(${(char.name.charCodeAt(0) * 37) % 360}, 50%, 55%))` }}
                      >
                        {char.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-bold text-[--text-primary]">{char.name}</div>
                        <div className="flex items-center gap-1.5 text-[10px] text-[--text-muted]">
                          <span>{t("frequency")} {char.frequency}</span>
                          {char.visualHint && (
                            <>
                              <span className="h-[3px] w-[3px] rounded-full bg-[#ddd]" />
                              <span className="truncate">{char.visualHint}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Visual hint tag */}
                    {char.visualHint && (
                      <div className="mb-2 inline-block rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                        {char.visualHint}
                      </div>
                    )}
                    {/* Description */}
                    <p className="line-clamp-2 text-[11px] leading-relaxed text-[--text-muted]">{char.description}</p>
                  </div>
                  {/* Scope badge (floating, clickable) */}
                  <button
                    onClick={() => toggleScope(idx)}
                    className={`absolute right-3 top-3 rounded-[8px] px-2 py-0.5 text-[9px] font-bold tracking-wide transition-colors ${
                      char.scope === "main"
                        ? "bg-blue-50 text-blue-600 hover:bg-blue-100"
                        : "bg-purple-50 text-purple-600 hover:bg-purple-100"
                    }`}
                  >
                    {char.scope === "main" ? t("main") : t("guest")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Episodes review (after step 3) */}
        {showEpReview && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-[--text-primary]">
                {t("reviewEpisodes")} ({episodes.length})
              </h3>
              <Button onClick={runGenerate} className="rounded-xl">
                {t("confirmAndGenerate")}
              </Button>
            </div>
            <p className="text-sm text-[--text-muted]">{t("reviewEpisodesHint")}</p>
            <div className="space-y-3">
              {episodes.map((ep, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-[--border-subtle] bg-white p-4"
                >
                  <div className="mb-2 flex items-center gap-3">
                    <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                      EP.{String(idx + 1).padStart(2, "0")}
                    </span>
                    <Input
                      value={ep.title}
                      onChange={(e) => updateEpisode(idx, "title", e.target.value)}
                      className="h-8 text-sm font-semibold"
                    />
                    <button
                      onClick={() => removeEpisode(idx)}
                      className="shrink-0 text-[--text-muted] hover:text-red-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs text-[--text-muted]">{ep.description}</p>
                  {ep.characters && ep.characters.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ep.characters.map((name) => {
                        const isMain = characters.some((c) => c.name === name && c.scope === "main");
                        return (
                          <span key={name} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isMain ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                            {name}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {ep.keywords && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ep.keywords.split(/[,，]/).map((kw) => kw.trim()).filter(Boolean).map((kw) => (
                        <span key={kw} className="rounded bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Logs panel */}
        {(currentStep > 0 || historyMode) && !showCharReview && !showEpReview && (() => {
          const filteredLogs = selectedStep
            ? logs.filter((l) => l.step === selectedStep)
            : logs;

          // Extract metadata from the "done" log of the selected step
          const stepDoneLog = selectedStep
            ? logs.find((l) => l.step === selectedStep && l.status === "done" && l.metadata)
            : null;
          const meta = stepDoneLog?.metadata as Record<string, unknown> | null;
          const metaCharacters = meta?.characters as ExtractedCharacter[] | undefined;
          const metaEpisodes = meta?.episodes as SplitEpisode[] | undefined;

          // For step 3, also show characters from step 2
          const step2DoneLog = (selectedStep === 3)
            ? logs.find((l) => l.step === 2 && l.status === "done" && l.metadata)
            : null;
          const step2Meta = step2DoneLog?.metadata as Record<string, unknown> | null;
          const step2Characters = step2Meta?.characters as ExtractedCharacter[] | undefined;

          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-[--text-secondary]">
                  {t("processLog")}
                  {selectedStep && (
                    <span className="ml-2 text-xs font-normal text-[--text-muted]">
                      — {t(STEPS[selectedStep - 1].label)}
                    </span>
                  )}
                </h3>
                {selectedStep && (
                  <button
                    onClick={() => setSelectedStep(null)}
                    className="text-xs text-primary hover:underline"
                  >
                    {t("showAll")}
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-[--border-subtle] bg-white p-4">
                <div className="max-h-[30vh] space-y-1.5 overflow-y-auto font-mono text-xs">
                  {filteredLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2">
                      <span
                        className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          log.status === "done"
                            ? "bg-emerald-500"
                            : log.status === "error"
                              ? "bg-red-500"
                              : "bg-amber-400"
                        }`}
                      />
                      {!selectedStep && (
                        <span className="shrink-0 text-[--text-muted]">[Step {log.step}]</span>
                      )}
                      <span className={log.status === "error" ? "text-red-500" : "text-[--text-primary]"}>
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>

              {/* Retry button when a step has failed */}
              {([1, 2, 3, 4] as Step[]).some((s) => stepStatus[s] === "error") && !historyMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={retryStep}
                  className="self-start"
                >
                  <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
                  {t("retry")}
                </Button>
              )}

              {/* Step 2 metadata: characters */}
              {selectedStep === 2 && metaCharacters && metaCharacters.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-[--text-secondary]">
                    {t("reviewCharacters")} ({metaCharacters.length})
                  </h4>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                    {metaCharacters.map((char, idx) => (
                      <div
                        key={idx}
                        className="group relative overflow-hidden rounded-[14px] border border-[--border-subtle] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 hover:border-[--border-hover]"
                      >
                        <div className={`h-1 w-full ${char.scope === "main" ? "bg-gradient-to-r from-blue-500 to-blue-400" : "bg-gradient-to-r from-purple-500 to-purple-400"}`} />
                        <div className="p-3.5">
                          <div className="mb-2.5 flex items-center gap-2.5">
                            <div
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold text-white"
                              style={{ background: `linear-gradient(135deg, hsl(${(char.name.charCodeAt(0) * 37) % 360}, 45%, 45%), hsl(${(char.name.charCodeAt(0) * 37) % 360}, 50%, 55%))` }}
                            >
                              {char.name.charAt(0)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-bold text-[--text-primary]">{char.name}</div>
                              <div className="flex items-center gap-1.5 text-[10px] text-[--text-muted]">
                                <span>{t("frequency")} {char.frequency}</span>
                                {char.visualHint && (
                                  <>
                                    <span className="h-[3px] w-[3px] rounded-full bg-[#ddd]" />
                                    <span className="truncate">{char.visualHint}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          {char.visualHint && (
                            <div className="mb-2 inline-block rounded-md bg-[--surface] px-2 py-0.5 text-[10px] font-medium text-[--text-muted]">
                              {char.visualHint}
                            </div>
                          )}
                          <p className="line-clamp-2 text-[11px] leading-relaxed text-[--text-muted]">{char.description}</p>
                        </div>
                        <span className={`absolute right-3 top-3 rounded-[8px] px-2 py-0.5 text-[9px] font-bold tracking-wide ${
                          char.scope === "main" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                        }`}>
                          {char.scope === "main" ? t("main") : t("guest")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3 metadata: episodes */}
              {selectedStep === 3 && metaEpisodes && metaEpisodes.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-[--text-secondary]">
                    {t("reviewEpisodes")} ({metaEpisodes.length})
                  </h4>
                  <div className="space-y-2">
                    {metaEpisodes.map((ep, idx) => (
                      <div key={idx} className="rounded-xl border border-[--border-subtle] bg-white p-3">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                            EP.{String(idx + 1).padStart(2, "0")}
                          </span>
                          <span className="text-sm font-semibold text-[--text-primary]">{ep.title}</span>
                        </div>
                        <p className="text-xs text-[--text-muted]">{ep.description}</p>
                        {ep.characters && ep.characters.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {ep.characters.map((name) => {
                              const isMain = step2Characters?.some((c) => c.name === name && c.scope === "main");
                              return (
                                <span key={name} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isMain ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
                                  {name}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {historyMode && (
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setHistoryMode(false);
                      setSelectedStep(null);
                      setCurrentStep(0);
                      setStepStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle" });
                    }}
                  >
                    {t("newImport")}
                  </Button>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
