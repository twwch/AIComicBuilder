import type { EnrichmentPatch } from "./types";

export interface AppliedEnrichmentText {
  text: string;
  appliedCount: number;
  skippedCount: number;
}

type Replacement = {
  start: number;
  end: number;
  text: string;
};

function compact(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function findNextNonOverlappingIndex(
  source: string,
  needle: string,
  minIndex: number,
  replacements: Replacement[],
) {
  let index = source.indexOf(needle, minIndex);
  while (index >= 0) {
    const end = index + needle.length;
    const overlaps = replacements.some((replacement) =>
      index < replacement.end && end > replacement.start
    );
    if (!overlaps) return index;
    index = source.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return -1;
}

export function applyEnrichmentPatchesToText(
  sourceText: string,
  patches: Pick<EnrichmentPatch, "original_text" | "enriched_text">[],
): AppliedEnrichmentText {
  const source = String(sourceText || "");
  const replacements: Replacement[] = [];
  let cursor = 0;
  let skippedCount = 0;

  for (const patch of patches) {
    const original = String(patch.original_text || "").trim();
    const enriched = String(patch.enriched_text || "").trim();
    if (!original || !enriched || compact(original) === compact(enriched)) {
      skippedCount += 1;
      continue;
    }

    let index = findNextNonOverlappingIndex(source, original, cursor, replacements);
    if (index < 0) {
      index = findNextNonOverlappingIndex(source, original, 0, replacements);
    }
    if (index < 0) {
      skippedCount += 1;
      continue;
    }

    replacements.push({
      start: index,
      end: index + original.length,
      text: enriched,
    });
    cursor = index + original.length;
  }

  if (replacements.length === 0) {
    return { text: source, appliedCount: 0, skippedCount };
  }

  replacements.sort((left, right) => left.start - right.start);
  let text = "";
  let lastIndex = 0;
  for (const replacement of replacements) {
    text += source.slice(lastIndex, replacement.start);
    text += replacement.text;
    lastIndex = replacement.end;
  }
  text += source.slice(lastIndex);

  return {
    text,
    appliedCount: replacements.length,
    skippedCount,
  };
}
