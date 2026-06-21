"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowUpDown, ImageIcon, VideoIcon, CheckCircle2, XCircle, Clock } from "lucide-react";
import { uploadUrl } from "@/lib/utils/upload-url";

interface Version {
  id: string;
  label: string;
  versionNum: number;
}

interface ShotAsset {
  id: string;
  type: string;
  isActive: number;
  prompt: string;
  fileUrl: string | null;
  status: string;
  characters: string[] | null;
  modelProvider: string | null;
  modelId: string | null;
  meta: Record<string, unknown> | null;
}

interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  motionScript: string | null;
  videoPrompt: string | null;
  cameraDirection: string | null;
  duration: number;
  transitionIn: string | null;
  transitionOut: string | null;
  status: string;
  dialogues: Array<{ id: string; text: string; characterName: string; sequence: number }>;
  assets: ShotAsset[];
}

interface VersionCompareProps {
  versions: Version[];
  projectId: string;
  currentEpisodeId?: string | null;
}

function getActiveAsset(assets: ShotAsset[], type: string): ShotAsset | undefined {
  return assets.find((a) => a.type === type && a.isActive === 1);
}

function ShotPreview({ shot }: { shot?: Shot }) {
  const t = useTranslations();
  if (!shot) {
    return (
      <div className="flex h-full min-h-[120px] items-center justify-center rounded-lg border border-dashed border-[--border-subtle] bg-[--surface]/50">
        <XCircle className="h-5 w-5 text-[--text-muted]" />
      </div>
    );
  }

  const firstFrame = getActiveAsset(shot.assets, "first_frame");
  const lastFrame = getActiveAsset(shot.assets, "last_frame");
  const video = getActiveAsset(shot.assets, "keyframe_video") || getActiveAsset(shot.assets, "reference_video");
  const shotStatus = shot.status || "pending";

  return (
    <div className="space-y-2">
      {/* Frame images */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="relative aspect-video overflow-hidden rounded-lg bg-[--surface]">
          {firstFrame?.fileUrl ? (
            <img src={uploadUrl(firstFrame.fileUrl)} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center"><ImageIcon className="h-4 w-4 text-[--text-muted]" /></div>
          )}
        </div>
        <div className="relative aspect-video overflow-hidden rounded-lg bg-[--surface]">
          {lastFrame?.fileUrl ? (
            <img src={uploadUrl(lastFrame.fileUrl)} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center"><ImageIcon className="h-4 w-4 text-[--text-muted]" /></div>
          )}
        </div>
      </div>

      {/* Video */}
      {video?.fileUrl ? (
        <video src={uploadUrl(video.fileUrl)} className="w-full rounded-lg" controls />
      ) : (
        <div className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[--border-subtle] py-2 text-xs text-[--text-muted]">
          <VideoIcon className="h-3 w-3" />
          {t("storyboard.noVideo") || "No video"}
        </div>
      )}

      {/* Prompt + meta */}
      <p className="line-clamp-2 text-xs text-[--text-secondary]">{shot.prompt}</p>
      {shot.videoPrompt && (
        <p className="line-clamp-1 text-[10px] text-[--text-muted] font-mono">{shot.videoPrompt}</p>
      )}

      {shot.dialogues.length > 0 && (
        <div className="space-y-0.5">
          {shot.dialogues.map((d) => (
            <p key={d.id} className="text-[10px] text-[--text-muted]">
              <span className="font-medium text-primary">{d.characterName}</span>: {d.text}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-[--text-muted]">
        <span className="flex items-center gap-0.5">
          <Clock className="h-2.5 w-2.5" /> {shot.duration}s
        </span>
        <span>{shot.transitionIn} → {shot.transitionOut}</span>
        {shot.motionScript && <span className="truncate">{shot.motionScript}</span>}
      </div>

      {shotStatus === "completed" && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
    </div>
  );
}

export function VersionCompare({
  versions,
  projectId,
  currentEpisodeId,
}: VersionCompareProps) {
  const t = useTranslations();
  const [versionAId, setVersionAId] = useState(versions[0]?.id || "");
  const [versionBId, setVersionBId] = useState(versions[1]?.id || "");
  const [shotsA, setShotsA] = useState<Shot[]>([]);
  const [shotsB, setShotsB] = useState<Shot[]>([]);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [errorA, setErrorA] = useState("");
  const [errorB, setErrorB] = useState("");
  const [sortAlign, setSortAlign] = useState(true);

  const fetchShots = useCallback(async (versionId: string, setShots: (s: Shot[]) => void, setLoading: (v: boolean) => void, setError: (v: string) => void) => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`/api/projects/${projectId}/versions/${versionId}/shots`);
      if (!resp.ok) throw new Error("Failed to fetch");
      const data = await resp.json();
      setShots(data.shots || []);
    } catch {
      setError(t("common.error"));
    }
    setLoading(false);
  }, [projectId, t]);

  useEffect(() => { if (versionAId) fetchShots(versionAId, setShotsA, setLoadingA, setErrorA); }, [versionAId, fetchShots]);
  useEffect(() => { if (versionBId) fetchShots(versionBId, setShotsB, setLoadingB, setErrorB); }, [versionBId, fetchShots]);

  // When currentEpisodeId changes, auto-select first two versions
  useEffect(() => {
    if (versions.length >= 2) {
      setVersionAId(versions[0].id);
      setVersionBId(versions[1].id);
    }
  }, [currentEpisodeId, versions]);

  const maxLen = Math.max(shotsA.length, shotsB.length);

  const alignmentRows = useMemo(() => {
    if (!sortAlign) {
      return Array.from({ length: maxLen }, (_, i) => ({
        shotA: shotsA[i],
        shotB: shotsB[i],
        diffType: "none" as const,
      }));
    }

    // Align by sequence number
    const seqA = new Map(shotsA.map((s) => [s.sequence, s]));
    const seqB = new Map(shotsB.map((s) => [s.sequence, s]));
    const allSeqs = new Set([...seqA.keys(), ...seqB.keys()]);
    const sorted = Array.from(allSeqs).sort((a, b) => a - b);

    return sorted.map((seq) => {
      const a = seqA.get(seq);
      const b = seqB.get(seq);
      let diffType: "added" | "removed" | "changed" | "same" = "same";
      if (!a && b) diffType = "added";
      else if (a && !b) diffType = "removed";
      else if (a && b && (a.prompt !== b.prompt || a.duration !== b.duration || a.videoPrompt !== b.videoPrompt)) {
        diffType = "changed";
      }
      return { shotA: a, shotB: b, diffType };
    });
  }, [shotsA, shotsB, sortAlign]);

  if (versions.length < 2) {
    return (
      <div className="rounded-lg border p-4 text-center text-sm text-muted-foreground">
        {t("storyboard.needTwoVersions")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: version selectors + align toggle */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-primary">A:</span>
          <select
            value={versionAId}
            onChange={(e) => setVersionAId(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNum} — {v.label}
              </option>
            ))}
          </select>
        </div>
        <span className="text-muted-foreground text-xs font-medium">vs</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-primary">B:</span>
          <select
            value={versionBId}
            onChange={(e) => setVersionBId(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNum} — {v.label}
              </option>
            ))}
          </select>
        </div>

        <Button
          variant="ghost"
          size="xs"
          onClick={() => setSortAlign(!sortAlign)}
          className={sortAlign ? "text-primary" : ""}
        >
          <ArrowUpDown className="h-3 w-3" />
          {sortAlign ? (t("storyboard.alignBySeq") || "Align by sequence") : (t("storyboard.rawOrder") || "Raw order")}
        </Button>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-3 text-xs text-[--text-muted]">
        <span>A: {shotsA.length} shots</span>
        <span>B: {shotsB.length} shots</span>
        {sortAlign && alignmentRows.filter((r) => r.diffType === "changed").length > 0 && (
          <span className="text-amber-600">{alignmentRows.filter((r) => r.diffType === "changed").length} changed</span>
        )}
        {sortAlign && alignmentRows.filter((r) => r.diffType === "added").length > 0 && (
          <span className="text-emerald-600">+{alignmentRows.filter((r) => r.diffType === "added").length} added</span>
        )}
        {sortAlign && alignmentRows.filter((r) => r.diffType === "removed").length > 0 && (
          <span className="text-red-600">-{alignmentRows.filter((r) => r.diffType === "removed").length} removed</span>
        )}
      </div>

      {/* Comparison grid */}
      <div className="space-y-3">
        {alignmentRows.map(({ shotA, shotB, diffType }, i) => {
          const borderColor =
            diffType === "added" ? "border-emerald-300 bg-emerald-50/40"
            : diffType === "removed" ? "border-red-300 bg-red-50/40"
            : diffType === "changed" ? "border-amber-300 bg-amber-50/40"
            : "border-[--border-subtle]";

          return (
            <div key={i} className={`grid grid-cols-2 gap-3 rounded-xl border p-3 ${borderColor}`}>
              {/* Version A */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-primary">
                    #{shotA?.sequence || shotB?.sequence || i + 1}
                    <span className="ml-1 font-normal text-[--text-muted]">
                      — v{versions.find((v) => v.id === versionAId)?.versionNum}
                    </span>
                  </span>
                  {diffType === "removed" && (
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-600">Removed</span>
                  )}
                  {diffType === "changed" && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-600">Changed</span>
                  )}
                </div>
                {loadingA ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : errorA ? (
                  <p className="text-xs text-destructive">{errorA}</p>
                ) : (
                  <ShotPreview shot={shotA} />
                )}
              </div>

              {/* Version B */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-primary">
                    #{shotB?.sequence || shotA?.sequence || i + 1}
                    <span className="ml-1 font-normal text-[--text-muted]">
                      — v{versions.find((v) => v.id === versionBId)?.versionNum}
                    </span>
                  </span>
                  {diffType === "added" && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600">New</span>
                  )}
                  {diffType === "changed" && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-600">Changed</span>
                  )}
                </div>
                {loadingB ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : errorB ? (
                  <p className="text-xs text-destructive">{errorB}</p>
                ) : (
                  <ShotPreview shot={shotB} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
