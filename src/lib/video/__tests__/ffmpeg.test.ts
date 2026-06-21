import { describe, expect, it, vi, beforeEach } from "vitest";

const mockInputOptions = vi.hoisted(() => vi.fn());
const mockOutputOptions = vi.hoisted(() => vi.fn());
const mockOutput = vi.hoisted(() => vi.fn());
const mockOn = vi.hoisted(() => vi.fn());
const mockRun = vi.hoisted(() => vi.fn());
const mockFfmpegInput = vi.hoisted(() => vi.fn());

vi.mock("fluent-ffmpeg", () => {
  const handlers = new Map<string, () => void>();
  const chain = {
    inputOptions: mockInputOptions.mockReturnThis(),
    outputOptions: mockOutputOptions.mockReturnThis(),
    output: mockOutput.mockReturnThis(),
    on: mockOn.mockImplementation((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return chain;
    }),
    run: mockRun.mockImplementation(() => {
      handlers.get("end")?.();
    }),
  };
  const ffmpeg = Object.assign(
    vi.fn((input?: string) => {
      mockFfmpegInput(input);
      return chain;
    }),
    {
      setFfmpegPath: vi.fn(),
      ffprobe: vi.fn(),
    },
  );
  return { default: ffmpeg };
});

vi.mock("@/lib/id", () => ({
  id: () => "test-id",
}));

import { extractLastVideoFrame } from "../ffmpeg";

describe("extractLastVideoFrame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts the final video frame into the frames directory", async () => {
    const framePath = await extractLastVideoFrame("uploads/videos/shot.mp4", "uploads/project", {
      prefix: "shot 2 tail",
    });

    expect(framePath).toMatch(/uploads[\\/]project[\\/]frames[\\/]shot-2-tail-test-id\.png$/);
    expect(mockFfmpegInput).toHaveBeenCalledWith(expect.stringMatching(/uploads[\\/]videos[\\/]shot\.mp4$/));
    expect(mockInputOptions).toHaveBeenCalledWith(["-sseof", "-0.05"]);
    expect(mockOutputOptions).toHaveBeenCalledWith(["-frames:v", "1", "-q:v", "2"]);
    expect(mockOutput).toHaveBeenCalledWith(framePath);
    expect(mockRun).toHaveBeenCalled();
  });
});
