import { describe, it, expect } from "vitest";
import { recommendTransitions, mergeTransitions, type ShotTransition } from "@/lib/transition-recommender";

function makeShot(overrides: Partial<{
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
}> = {}) {
  return {
    id: overrides.id ?? `shot_${overrides.sequence ?? 0}`,
    sequence: overrides.sequence ?? 0,
    prompt: overrides.prompt ?? null,
    motionScript: overrides.motionScript ?? null,
    videoScript: overrides.videoScript ?? null,
    cameraDirection: overrides.cameraDirection ?? null,
    duration: overrides.duration ?? null,
    sceneId: overrides.sceneId ?? null,
    transitionIn: overrides.transitionIn ?? null,
    transitionOut: overrides.transitionOut ?? null,
  };
}

describe("recommendTransitions", () => {
  it("returns empty array for no shots", () => {
    expect(recommendTransitions([])).toEqual([]);
  });

  it("single shot: fade_in + fade_out", () => {
    const shots = [makeShot({ id: "s1", sequence: 1 })];
    const recs = recommendTransitions(shots);
    expect(recs).toHaveLength(1);
    expect(recs[0].recommendedTransitionIn).toBe("fade_in");
    expect(recs[0].recommendedTransitionOut).toBe("fade_out");
    expect(recs[0].reasoning).toContain("first shot");
    expect(recs[0].reasoning).toContain("last shot");
  });

  it("two shots with static camera: cut between", () => {
    const shots = [
      makeShot({ id: "s1", sequence: 1, cameraDirection: "static" }),
      makeShot({ id: "s2", sequence: 2, cameraDirection: "static" }),
    ];
    const recs = recommendTransitions(shots);
    expect(recs[0].recommendedTransitionOut).toBe("cut");
    expect(recs[1].recommendedTransitionIn).toBe("cut");
  });

  it("scene change triggers dissolve in", () => {
    const shots = [
      makeShot({ id: "s1", sequence: 1, sceneId: "scene_a" }),
      makeShot({ id: "s2", sequence: 2, sceneId: "scene_b" }),
    ];
    const recs = recommendTransitions(shots);
    expect(recs[1].recommendedTransitionIn).toBe("dissolve");
    expect(recs[1].reasoning).toContain("scene change");
  });

  it("large camera opposite direction triggers wipe", () => {
    const shots = [
      makeShot({ id: "s1", sequence: 1, cameraDirection: "pan left" }),
      makeShot({ id: "s2", sequence: 2, cameraDirection: "orbit right" }),
    ];
    const recs = recommendTransitions(shots);
    expect(recs[0].recommendedTransitionOut).toBe("wipeleft");
    expect(recs[0].reasoning).toContain("wipe");
  });

  it("moderate camera change triggers dissolve out", () => {
    const shots = [
      makeShot({ id: "s1", sequence: 1, cameraDirection: "static" }),
      makeShot({ id: "s2", sequence: 2, cameraDirection: "pan right" }),
    ];
    const recs = recommendTransitions(shots);
    // camDiff = |0 - 4| = 4 >= 3 → dissolve out for s1
    expect(recs[0].recommendedTransitionOut).toBe("dissolve");
    expect(recs[0].reasoning).toContain("camera change");
  });

  it("high motion intensity delta triggers dissolve", () => {
    const shots = [
      makeShot({ id: "s1", sequence: 1, prompt: "two people talking quietly" }),
      makeShot({ id: "s2", sequence: 2, prompt: "explosive chase scene with fighting and running" }),
    ];
    const recs = recommendTransitions(shots);
    expect(recs[0].recommendedTransitionOut).toBe("dissolve");
    expect(recs[0].reasoning).toContain("mood intensity shift");
  });

  it("internal shot collapses identical dissolve in/out to cut", () => {
    // s2 needs prev + next and camDiff >= 3 on both sides to get dissolve in/out
    // s1: static(0), s2: pan right(4), s3: crane up(8)
    // camDiff(s1,s2)=4 ≥3 → dissolve in, camDiff(s2,s3)=4 ≥3 <8 → dissolve out
    // Then collapse: dissolve+dissolve → cut+cut
    const shots = [
      makeShot({ id: "s1", sequence: 1, cameraDirection: "static" }),
      makeShot({ id: "s2", sequence: 2, cameraDirection: "pan right" }),
      makeShot({ id: "s3", sequence: 3, cameraDirection: "crane up" }),
    ];
    const recs = recommendTransitions(shots);
    expect(recs[1].recommendedTransitionIn).toBe("cut");
    expect(recs[1].recommendedTransitionOut).toBe("cut");
    expect(recs[1].reasoning).toContain("internal shot");
  });

  it("handles Chinese text in motion intensity", () => {
    const shots = [
      makeShot({ id: "s1", sequence: 1, prompt: "安静对话场景" }),
      makeShot({ id: "s2", sequence: 2, prompt: "快速奔跑战斗爆炸场面" }),
    ];
    const recs = recommendTransitions(shots);
    expect(recs[0].recommendedTransitionOut).toBe("dissolve");
  });

  it("consistent camera + low intensity = cut", () => {
    const shots = [
      makeShot({ id: "s1", sequence: 1, cameraDirection: "static", prompt: "walk in park" }),
      makeShot({ id: "s2", sequence: 2, cameraDirection: "static", prompt: "sit on bench" }),
    ];
    const recs = recommendTransitions(shots);
    expect(recs[0].recommendedTransitionOut).toBe("cut");
    expect(recs[1].recommendedTransitionIn).toBe("cut");
  });

  it("handles null camera direction gracefully", () => {
    const shots = [
      makeShot({ id: "s1", sequence: 1, cameraDirection: null }),
      makeShot({ id: "s2", sequence: 2, cameraDirection: null }),
    ];
    expect(() => recommendTransitions(shots)).not.toThrow();
  });
});

describe("mergeTransitions", () => {
  it("overrides shot transitions with recommendations", () => {
    const shots = [
      makeShot({ id: "s1", sequence: 1, transitionIn: "cut", transitionOut: "cut" }),
      makeShot({ id: "s2", sequence: 2, transitionIn: "cut", transitionOut: "cut" }),
    ];
    const recs: ShotTransition[] = [
      { shotId: "s1", sequence: 1, recommendedTransitionIn: "fade_in", recommendedTransitionOut: "dissolve", reasoning: "test" },
      { shotId: "s2", sequence: 2, recommendedTransitionIn: "dissolve", recommendedTransitionOut: "fade_out", reasoning: "test" },
    ];
    const merged = mergeTransitions(shots, recs);
    expect(merged[0].transitionIn).toBe("fade_in");
    expect(merged[0].transitionOut).toBe("dissolve");
    expect(merged[1].transitionIn).toBe("dissolve");
    expect(merged[1].transitionOut).toBe("fade_out");
  });

  it("falls back to existing transition when no recommendation", () => {
    const shots = [
      makeShot({ id: "s1", sequence: 1, transitionIn: "wipeleft", transitionOut: "slideright" }),
    ];
    const merged = mergeTransitions(shots, []);
    expect(merged[0].transitionIn).toBe("wipeleft");
    expect(merged[0].transitionOut).toBe("slideright");
  });

  it("defaults to cut when nothing is set", () => {
    const shots = [makeShot({ id: "s1", sequence: 1, transitionIn: null, transitionOut: null })];
    const merged = mergeTransitions(shots, []);
    expect(merged[0].transitionIn).toBe("cut");
    expect(merged[0].transitionOut).toBe("cut");
  });
});
