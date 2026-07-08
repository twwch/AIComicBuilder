export const MODEL_MAX_DURATIONS: Record<string, number> = {
  "veo-2.0-generate-001": 8,
  "veo-3.0-generate-001": 8,
  "veo-3.0-fast-generate-001": 8,
  "veo-3.1-generate-001": 8,
  "veo-3.1-fast-generate-001": 8,
  "kling-v1": 10,
  "kling-v1-5": 10,
  "kling-v2.5-turbo": 10,
  "kling-v3": 15,
  "doubao-seedance-1-5-pro-250528": 12,
  "doubao-seedance-1-5-pro-251215": 12,
  "doubao-seedance-1-0-lite-250528": 5,
  "wan2.7-t2v": 15,
  "wan2.7-r2v": 15,
  "wan2.6-t2v": 15,
  "wan2.6-i2v-flash": 15,
  "wan2.6-i2v": 10,
  "wan2.6-r2v": 10,
  "wan2.6-r2v-flash": 10,
  "viduq3-pro": 16,
  "viduq3-turbo": 16,
  "viduq3": 16,
  "kling-video": 15,
  "kling-3.0-turbo": 15,
  "minimax-hailuo-02": 10,
  "minimax-hailuo-2.3": 10,
};

/** Family-level fallback: if modelId contains this substring, use this duration */
const FAMILY_MAX_DURATIONS: [string, number][] = [
  ["veo", 8],
  ["kling-v3", 15],
  ["kling", 10],
  ["seedance-1-0", 5],
  ["seedance", 12],
  ["wan2.7", 15],
  ["wan2.6", 15],
  ["wan", 15],
  ["viduq3", 16],
  ["vidu", 16],
  ["hailuo", 10],
  ["pixverse", 10],
];

export const DEFAULT_MAX_DURATION = 12;

/** Returns the maximum supported video duration (seconds) for the given model ID. Unknown models return 12. */
export function getModelMaxDuration(modelId?: string | null): number {
  if (!modelId) return DEFAULT_MAX_DURATION;

  const lowerModelId = modelId.toLowerCase();

  // Exact match
  if (lowerModelId in MODEL_MAX_DURATIONS) {
    return MODEL_MAX_DURATIONS[lowerModelId];
  }

  // Prefix match
  for (const key of Object.keys(MODEL_MAX_DURATIONS).sort((a, b) => b.length - a.length)) {
    if (lowerModelId.startsWith(key) || key.startsWith(lowerModelId)) {
      return MODEL_MAX_DURATIONS[key];
    }
  }

  // Family substring match (order matters — more specific first)
  for (const [family, duration] of FAMILY_MAX_DURATIONS) {
    if (lowerModelId.includes(family)) {
      return duration;
    }
  }

  return DEFAULT_MAX_DURATION;
}
