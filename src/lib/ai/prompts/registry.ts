// ─────────────────────────────────────────────────────────
// Prompt Registry — Slot Decomposition
// Decomposes all 12 prompt templates into editable slots.
// ─────────────────────────────────────────────────────────

// Re-export types for external consumers
export type { PromptSlot, PromptCategory, PromptDefinition } from "./registry-helpers";
import type { PromptDefinition } from "./registry-helpers";

// Import all definitions
import { scriptOutlineDef, scriptGenerateDef, scriptParseDef, scriptSplitDef } from "./registry-script";
import { characterExtractDef, importCharacterExtractDef, characterImageDef, characterImageSimpleDef, characterImageIdeogram4Def, characterImageHiDreamO1Def } from "./registry-character";
import { shotSplitDef, shotKeyframeAssetsDef } from "./registry-shot";
import { battleChoreographyDef } from "./registry-battle";
import { frameGenerateFirstDef, frameGenerateLastDef, sceneFrameGenerateDef, refImagePromptsDef } from "./registry-frame";
import { videoGenerateDef, refVideoGenerateDef, refVideoPromptDef, fourGridGenerateDef } from "./registry-video";

// Import helpers + registry access
import { __setRegistryMap, getPromptDefinition, getDefaultSlotContents } from "./registry-helpers";

// Build registry
export const PROMPT_REGISTRY: PromptDefinition[] = [
  scriptOutlineDef, scriptGenerateDef, scriptParseDef, scriptSplitDef,
  characterExtractDef, importCharacterExtractDef, characterImageDef, characterImageSimpleDef, characterImageIdeogram4Def, characterImageHiDreamO1Def,
  shotSplitDef, shotKeyframeAssetsDef, battleChoreographyDef,
  frameGenerateFirstDef, frameGenerateLastDef, sceneFrameGenerateDef, refImagePromptsDef,
  videoGenerateDef, refVideoGenerateDef, refVideoPromptDef, fourGridGenerateDef,
];

export const PROMPT_REGISTRY_MAP: Record<string, PromptDefinition> =
  Object.fromEntries(PROMPT_REGISTRY.map((d) => [d.key, d]));

// Wire up the registry map for late-bound helper access
__setRegistryMap(PROMPT_REGISTRY_MAP);

export { getPromptDefinition, getDefaultSlotContents };
