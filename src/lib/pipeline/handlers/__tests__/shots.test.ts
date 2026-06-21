/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockSelectOrderBy = vi.hoisted(() => vi.fn(() => ({ limit: mockSelectLimit })));
// where returns a thenable object that also exposes .orderBy() for chained queries
const mockSelectWhere = vi.hoisted(() => {
  const fn: any = vi.fn(() => {
    const p = Promise.resolve(fn._results?.shift() ?? []);
    (p as any).orderBy = mockSelectOrderBy;
    return p;
  });
  fn._results = [];
  return fn;
});
const mockSelectFrom = vi.hoisted(() => vi.fn(() => ({ where: mockSelectWhere })));
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockSelectFrom })));

const mockInsertValues = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockInsertValues })));

const mockGenerateText = vi.hoisted(() => vi.fn());
const mockFindBoundAgent = vi.hoisted(() => vi.fn());
const mockExtractErrorMessage = vi.hoisted(() => vi.fn((e: unknown) => String(e)));
const mockSummarizeProviderConfig = vi.hoisted(() => vi.fn(() => "mock-text-model"));
const mockShouldUseStrictJsonMode = vi.hoisted(() => vi.fn(() => false));
const mockGetEpisodeCharacters = vi.hoisted(() => vi.fn());

// ─── Mock modules ──────────────────────────────────────────────────────
vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
  },
}));

vi.mock("ai", () => ({ generateText: mockGenerateText }));

vi.mock("@/lib/generate-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/generate-utils")>("@/lib/generate-utils");
  return {
    ...actual,
    findBoundAgent: mockFindBoundAgent,
    extractErrorMessage: mockExtractErrorMessage,
    summarizeProviderConfig: mockSummarizeProviderConfig,
    shouldUseStrictJsonMode: mockShouldUseStrictJsonMode,
    getEpisodeCharacters: mockGetEpisodeCharacters,
  };
});

vi.mock("@/lib/ai/ai-sdk", () => ({
  createLanguageModel: vi.fn(() => ({})),
  extractJSON: vi.fn((text: string) => text),
}));

vi.mock("@/lib/shot-asset-utils", () => ({
  getActiveAsset: vi.fn().mockResolvedValue(null),
  insertAssetVersion: vi.fn().mockResolvedValue(undefined),
  patchAsset: vi.fn().mockResolvedValue(undefined),
  loadShotLegacyViewsBatch: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/transition-recommender", async () => {
  const actual = await vi.importActual<typeof import("@/lib/transition-recommender")>("@/lib/transition-recommender");
  return { ...actual };
});

vi.mock("@/lib/task-registry", () => ({
  registerTask: vi.fn(() => ({ signal: new AbortController().signal })),
}));

const mockUpdateProgress = vi.hoisted(() => vi.fn());
const mockCompleteTask = vi.hoisted(() => vi.fn());
const mockFailTask = vi.hoisted(() => vi.fn());
vi.mock("@/lib/task-utils", () => ({
  updateTaskProgress: mockUpdateProgress,
  completeTask: mockCompleteTask,
  failTask: mockFailTask,
}));

import { handleShotSplitStream } from "../shots";

const PROJECT_ID = "proj-test-1";
const USER_ID = "user-1";
const SCRIPT_BASIC = `SCENE 1
A quiet morning in the forest.

SCENE 2
A sudden storm hits the village.`;

function makeModelConfig() {
  return { text: { provider: "openai", model: "gpt-4o" } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindBoundAgent.mockResolvedValue(null);
  mockGetEpisodeCharacters.mockResolvedValue([]);
});

describe("handleShotSplitStream", () => {
  it("returns 400 when script is empty", async () => {
    mockSelectWhere._results = [[{ id: PROJECT_ID, script: "", worldSetting: null, targetDuration: 0 }]];

    const res = await handleShotSplitStream(PROJECT_ID, USER_ID, {}, makeModelConfig());
    expect(res.status).toBe(400);
  });

  it("returns 400 when no text model configured", async () => {
    mockSelectWhere._results = [[{ id: PROJECT_ID, script: SCRIPT_BASIC, worldSetting: null, targetDuration: 0 }]];

    const res = await handleShotSplitStream(PROJECT_ID, USER_ID, {}, undefined);
    expect(res.status).toBe(400);
  });

  it("produces shots with transitions and sceneIds on success", async () => {
    const mockShots = [
      { sequence: 1, sceneDescription: "Forest morning", startFrame: "trees", endFrame: "clearing", motionScript: "static shot", duration: 5, dialogues: [], cameraDirection: "static" },
      { sequence: 2, sceneDescription: "Storm hits", startFrame: "dark sky", endFrame: "rain", motionScript: "pan right", duration: 6, dialogues: [], cameraDirection: "pan right" },
    ];

    // DB query sequence — use _results array for mockSelectWhere
    // (the .orderBy().limit() chain is handled by mockSelectLimit)
    mockSelectLimit.mockResolvedValue([{ maxNum: 0 }]);
    mockSelectWhere._results = [
      [{ id: PROJECT_ID, script: SCRIPT_BASIC, worldSetting: null, targetDuration: 0 }],  // query 1
      [],                                                                                   // query 2
      [],                                                                                   // query 3
      [{ worldSetting: null, targetDuration: 0 }],                                         // query 4
    ];

    mockGenerateText.mockResolvedValue({ text: JSON.stringify(mockShots) });

    const res = await handleShotSplitStream(PROJECT_ID, USER_ID, {}, makeModelConfig());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shots).toBe(2);

    // Verify DB inserts: version + shots (dialogues is empty, so skipped)
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsertValues).toHaveBeenCalledTimes(2);

    // First insert = storyboardVersions, second = shots
    const shotRows = mockInsertValues.mock.calls[1][0] as any[];
    expect(shotRows).toHaveLength(2);
    // sceneIds should be set (both from same chunk = sg_0)
    expect(shotRows[0].sceneId).toBe("sg_0");
    expect(shotRows[1].sceneId).toBe("sg_0");
    // transitions should be populated
    expect(shotRows[0].transitionIn).toBe("fade_in");
    expect(shotRows[0].transitionOut).toBe("dissolve");
    expect(shotRows[1].transitionIn).toBe("dissolve");
    expect(shotRows[1].transitionOut).toBe("fade_out");
  });

  it("tracks progress via taskId when provided", async () => {
    mockSelectLimit.mockResolvedValue([{ maxNum: 0 }]);
    mockSelectWhere._results = [
      [{ id: PROJECT_ID, script: SCRIPT_BASIC, worldSetting: null, targetDuration: 0 }],
      [],
      [],
      [{ worldSetting: null, targetDuration: 0 }],
    ];

    mockGenerateText.mockResolvedValue({ text: JSON.stringify([
      { sequence: 1, sceneDescription: "Shot A", startFrame: "a", endFrame: "b", motionScript: "static", duration: 4, dialogues: [], cameraDirection: "static" },
    ]) });

    const res = await handleShotSplitStream(PROJECT_ID, USER_ID, {}, makeModelConfig(), undefined, "task-123");
    expect(res.status).toBe(200);

    // Initial progress update
    expect(mockUpdateProgress).toHaveBeenCalledWith("task-123", { total: 0, completed: 0, failed: [] });
    // Progress with chunk count (2 scene markers = 1 chunk with maxScenes=2)
    expect(mockUpdateProgress).toHaveBeenCalledWith("task-123", { total: expect.any(Number), completed: expect.any(Number), failed: expect.any(Array) });
    // Complete task
    expect(mockCompleteTask).toHaveBeenCalledWith("task-123", expect.objectContaining({ total: expect.any(Number) }));
  });

  it("calls failTask on complete failure", async () => {
    mockSelectLimit.mockResolvedValue([{ maxNum: 0 }]);
    mockSelectWhere._results = [
      [{ id: PROJECT_ID, script: SCRIPT_BASIC, worldSetting: null, targetDuration: 0 }],
      [],
      [],
      [{ worldSetting: null, targetDuration: 0 }],
    ];

    mockGenerateText.mockRejectedValue(new Error("API timeout"));

    const res = await handleShotSplitStream(PROJECT_ID, USER_ID, {}, makeModelConfig(), undefined, "task-456");
    expect(res.status).toBe(500);
    expect(mockFailTask).toHaveBeenCalledWith("task-456", expect.stringContaining("API timeout"));
  });
});
