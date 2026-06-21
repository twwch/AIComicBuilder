

export type TransitionType = "cut" | "dissolve" | "fade_in" | "fade_out" | "wipeleft" | "slideright" | "circleopen";

export interface ShotTransition {
  shotId: string;
  sequence: number;
  recommendedTransitionIn: TransitionType;
  recommendedTransitionOut: TransitionType;
  reasoning: string;
}

interface ShotRow {
  id: string;
  sequence: number;
  prompt: string | null;
  motionScript: string | null;
  videoScript: string | null;
  cameraDirection: string | null;
  duration: number | null;
  sceneId: string | null;
  transitionIn: string | null;
  transitionOut: string | null;
}

const DIRECTION_WEIGHT: Record<string, number> = {
  "static": 0,
  "push in": 1,
  "slow zoom in": 1,
  "dolly in": 1,
  "slow zoom out": 2,
  "dolly out": 2,
  "pan left": 3,
  "pan right": 4,
  "tilt up": 5,
  "tilt down": 6,
  "tracking shot": 7,
  "crane up": 8,
  "crane down": 9,
  "orbit left": 10,
  "orbit right": 11,
};

function directionGroup(dir: string): string {
  const d = dir.toLowerCase().trim();
  if (d === "static") return "static";
  if (/zoom|dolly|push/i.test(d)) return "depth";
  if (/pan|tilt|tracking/i.test(d)) return "lateral";
  if (/crane/i.test(d)) return "vertical";
  if (/orbit/i.test(d)) return "orbit";
  return "other";
}

function motionIntensity(shot: ShotRow): number {
  const text = [shot.prompt, shot.motionScript, shot.videoScript]
    .filter(Boolean).join(" ").toLowerCase();
  const actionWords = ["run", "jump", "punch", "explode", "chase", "crash",
    "fight", "dash", "rush", "快速", "奔跑", "战斗", "爆炸", "追"];
  const calmWords = ["walk", "talk", "sit", "stand", "look", "安静",
    "对话", "坐", "站", "凝视"];
  let score = 0;
  for (const w of actionWords) { if (text.includes(w)) score += 2; }
  for (const w of calmWords) { if (text.includes(w)) score -= 1; }
  return Math.max(0, score);
}

function cameraChanged(a: ShotRow, b: ShotRow): number {
  const da = (a.cameraDirection || "static").toLowerCase().trim();
  const db = (b.cameraDirection || "static").toLowerCase().trim();
  if (da === db) return 0;
  const wa = DIRECTION_WEIGHT[da] ?? 99;
  const wb = DIRECTION_WEIGHT[db] ?? 99;
  return Math.abs(wa - wb);
}

function isFirstShotOfScene(shot: ShotRow, prev: ShotRow | null): boolean {
  if (!prev) return false;
  return !!shot.sceneId && shot.sceneId !== prev.sceneId;
}

export function recommendTransitions(shots: ShotRow[]): ShotTransition[] {
  if (shots.length === 0) return [];

  const results: ShotTransition[] = [];

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const prev = i > 0 ? shots[i - 1] : null;
    const next = i < shots.length - 1 ? shots[i + 1] : null;

    let recIn: TransitionType = "cut";
    let recOut: TransitionType = "cut";
    let reasons: string[] = [];

    // ── Transition In ──
    if (prev) {
      if (isFirstShotOfScene(shot, prev)) {
        recIn = "dissolve";
        reasons.push("scene change → dissolve");
      } else {
        const camDiff = cameraChanged(prev, shot);
        if (camDiff >= 3) {
          recIn = "dissolve";
          reasons.push(`camera shift (${prev.cameraDirection} → ${shot.cameraDirection}) → dissolve`);
        } else if (camDiff >= 1) {
          recIn = "cut";
          reasons.push(`minor camera change → cut`);
        }
      }
    } else {
      // First shot of the episode
      recIn = "fade_in";
      reasons.push("first shot → fade_in");
    }

    // ── Transition Out ──
    if (next) {
      const intensityA = motionIntensity(shot);
      const intensityB = motionIntensity(next);
      const intensityDelta = Math.abs(intensityA - intensityB);

      if (isFirstShotOfScene(next, shot)) {
        recOut = "dissolve";
        reasons.push("next shot is new scene → dissolve out");
      } else if (intensityDelta >= 4) {
        recOut = "dissolve";
        reasons.push(`mood intensity shift (${intensityA}→${intensityB}) → dissolve`);
      } else {
        const camDiff = cameraChanged(shot, next);
        if (camDiff >= 8) {
          recOut = "wipeleft";
          reasons.push(`large camera opposite (${shot.cameraDirection} → ${next.cameraDirection}) → wipe`);
        } else if (camDiff >= 3) {
          recOut = "dissolve";
          reasons.push(`camera change → dissolve out`);
        } else if (camDiff === 0 && intensityDelta < 2) {
          recOut = "cut";
          reasons.push("consistent camera + tempo → cut");
        }
      }

      // If next shot is new scene → already handled above
    } else {
      recOut = "fade_out";
      reasons.push("last shot → fade_out");
    }

    // ── Collapse identical in/out for internal shots ──
    if (prev && next) {
      if (recIn === "dissolve" && recOut === "dissolve") {
        recIn = "cut";
        recOut = "cut";
        reasons = ["internal shot → cut"];
      }
    }

    results.push({
      shotId: shot.id,
      sequence: shot.sequence,
      recommendedTransitionIn: recIn,
      recommendedTransitionOut: recOut,
      reasoning: reasons.join("; ") || "default → cut",
    });
  }

  return results;
}

export function mergeTransitions(
  shots: ShotRow[],
  recommendations: ShotTransition[],
): Array<{ id: string; transitionIn: string; transitionOut: string }> {
  const recMap = new Map(recommendations.map((r) => [r.shotId, r]));
  return shots.map((s) => {
    const rec = recMap.get(s.id);
    return {
      id: s.id,
      transitionIn: rec?.recommendedTransitionIn ?? s.transitionIn ?? "cut",
      transitionOut: rec?.recommendedTransitionOut ?? s.transitionOut ?? "cut",
    };
  });
}
