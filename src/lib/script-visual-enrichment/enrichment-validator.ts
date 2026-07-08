import type {
  EnrichmentAssetCandidate,
  EnrichmentContext,
  EnrichmentPatch,
  EnrichmentValidationResult,
} from "./types";

const VALID_ASSET_TYPES = new Set(["character", "scene", "prop", "set_dressing", "prompt_detail"]);
const VALID_IMPORTANCE = new Set(["core", "important", "temporary", "background", "prompt_only"]);
const VALID_SOURCE_TYPES = new Set(["explicit", "inferred_from_context", "default_from_bible"]);

const RELATION_TERMS = [
  "父亲",
  "母亲",
  "爸爸",
  "妈妈",
  "丈夫",
  "妻子",
  "恋人",
  "前夫",
  "前妻",
  "兄弟",
  "姐妹",
  "仇人",
  "上司",
  "下属",
];

const MODERN_TERMS = [
  "手机",
  "智能手机",
  "微信",
  "短视频",
  "直播",
  "电脑",
  "笔记本电脑",
  "平板电脑",
  "LED",
  "二维码",
  "电动车",
  "自动门",
  "电子屏",
];

const KEY_PROP_TERMS = [
  "遗嘱",
  "合同",
  "录音",
  "录像",
  "证据",
  "戒指",
  "玉佩",
  "钥匙",
  "枪",
  "刀",
  "药",
  "病历",
  "照片",
  "信",
];

function compact(value: string, maxLength = 120) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function issue(patch: EnrichmentPatch, code: string, message: string) {
  const id = patch.beat_id || patch.scene_id || "unknown";
  return `[${id}] ${code}: ${message}`;
}

function mentionsAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function bibleSuggestsHistoricEra(context: EnrichmentContext) {
  const text = context.productionBible.rawText;
  if (!text) return false;
  if (/现代|当代|都市|互联网|智能手机/.test(text)) return false;
  return /古代|民国|清末|明朝|唐朝|宋朝|七十年代|八十年代|九十年代|70年代|80年代|90年代|旧社会|年代感/.test(text);
}

function isKnownCandidate(candidate: EnrichmentAssetCandidate, context: EnrichmentContext) {
  if (candidate.type === "character") return context.knownCharacters.has(candidate.name);
  if (candidate.type === "scene") return context.knownScenes.has(candidate.name);
  if (candidate.type === "prop") return context.knownProps.has(candidate.name);
  return true;
}

function validatePatchShape(patch: EnrichmentPatch, errors: string[], index: number) {
  if (!patch || typeof patch !== "object") {
    errors.push(`[patch ${index}] schema: patch must be an object`);
    return false;
  }

  const requiredStrings: Array<keyof EnrichmentPatch> = [
    "scene_id",
    "beat_id",
    "original_text",
    "enriched_text",
    "source_type",
    "reason",
  ];
  for (const key of requiredStrings) {
    if (typeof patch[key] !== "string") {
      errors.push(`[patch ${index}] schema: ${String(key)} must be a string`);
    }
  }

  if (!patch.added_visual_details || typeof patch.added_visual_details !== "object") {
    errors.push(`[patch ${index}] schema: added_visual_details is required`);
  } else {
    const details = patch.added_visual_details;
    for (const key of ["location_detail", "blocking", "wardrobe_detail", "action_detail", "emotion", "lighting", "atmosphere"] as const) {
      if (typeof details[key] !== "string") {
        errors.push(`[patch ${index}] schema: added_visual_details.${key} must be a string`);
      }
    }
    if (!Array.isArray(details.props)) errors.push(`[patch ${index}] schema: added_visual_details.props must be an array`);
    if (!Array.isArray(details.set_dressing)) errors.push(`[patch ${index}] schema: added_visual_details.set_dressing must be an array`);
  }

  if (!Array.isArray(patch.asset_candidates)) {
    errors.push(`[patch ${index}] schema: asset_candidates must be an array`);
  }
  if (!VALID_SOURCE_TYPES.has(patch.source_type)) {
    errors.push(`[patch ${index}] schema: source_type is invalid`);
  }
  if (typeof patch.confidence !== "number" || patch.confidence < 0 || patch.confidence > 1) {
    errors.push(`[patch ${index}] schema: confidence must be a number between 0 and 1`);
  }
  if (typeof patch.needs_human_review !== "boolean") {
    errors.push(`[patch ${index}] schema: needs_human_review must be boolean`);
  }

  return true;
}

function validateAssetCandidates(
  patch: EnrichmentPatch,
  context: EnrichmentContext,
  errors: string[],
  warnings: string[],
) {
  const seen = new Set<string>();
  for (const candidate of patch.asset_candidates || []) {
    const key = `${candidate.type}:${candidate.name}`.toLowerCase();
    if (seen.has(key)) {
      warnings.push(issue(patch, "duplicate_asset_candidate", `Duplicate asset candidate "${candidate.name}".`));
      continue;
    }
    seen.add(key);

    if (!candidate.name || typeof candidate.name !== "string") {
      errors.push(issue(patch, "asset_name_missing", "Every asset candidate needs a name."));
    }
    if (!VALID_ASSET_TYPES.has(candidate.type)) {
      errors.push(issue(patch, "asset_type_invalid", `Invalid asset type for "${candidate.name}".`));
    }
    if (!VALID_IMPORTANCE.has(candidate.importance)) {
      errors.push(issue(patch, "asset_importance_missing", `Asset "${candidate.name}" needs a valid importance.`));
    }

    const originalAndScene = `${patch.original_text}\n${context.sceneById.get(patch.scene_id)?.text || ""}`;
    const isMentioned = originalAndScene.includes(candidate.name);
    const known = isKnownCandidate(candidate, context);

    if (candidate.type === "character" && !isMentioned && !known) {
      errors.push(issue(patch, "new_key_character", `New character "${candidate.name}" is not present in source context.`));
    }

    if (candidate.type === "prop" && (candidate.importance === "core" || candidate.importance === "important") && !isMentioned && !known) {
      errors.push(issue(patch, "new_key_prop", `New key prop "${candidate.name}" is not grounded in source context.`));
    }

    if (candidate.type === "prop" && KEY_PROP_TERMS.some((term) => candidate.name.includes(term)) && !isMentioned && !known) {
      warnings.push(issue(patch, "key_prop_needs_review", `Potential key prop "${candidate.name}" should be confirmed by a human.`));
    }
  }
}

function validatePatchSemantics(
  patch: EnrichmentPatch,
  context: EnrichmentContext,
  errors: string[],
  warnings: string[],
) {
  const original = patch.original_text || "";
  const enriched = patch.enriched_text || "";
  const addedOnly = enriched.replace(original, "");

  if (!original.trim()) {
    errors.push(issue(patch, "original_text_missing", "Patch must keep the source beat text."));
  }
  if (!enriched.trim()) {
    errors.push(issue(patch, "enriched_text_missing", "Patch must provide enriched_text."));
  }

  if (original.trim() && !enriched.includes(original.trim()) && original.trim().length <= 80) {
    warnings.push(issue(patch, "original_not_verbatim", "Short original beat is not preserved verbatim inside enriched_text."));
  }

  if (!/[。.!?！？]?$/.test(enriched.trim())) {
    warnings.push(issue(patch, "sentence_end", "enriched_text should read as a complete visual description."));
  }

  if (!/[“”"']/.test(original) && /[“”"']/.test(addedOnly)) {
    errors.push(issue(patch, "new_dialogue", "Enrichment appears to add quoted dialogue."));
  }

  if (!/(说|问|回答|告诉|喊|叫)/.test(original) && /(说|问|回答|告诉|喊|叫)/.test(addedOnly)) {
    warnings.push(issue(patch, "dialogue_core_info", "Enrichment may add dialogue or dialogue intent."));
  }

  for (const term of RELATION_TERMS) {
    if (!original.includes(term) && addedOnly.includes(term)) {
      errors.push(issue(patch, "changed_relationship", `Relationship term "${term}" was introduced by enrichment.`));
    }
  }

  if (bibleSuggestsHistoricEra(context) && mentionsAny(enriched, MODERN_TERMS)) {
    errors.push(issue(patch, "era_conflict", "Modern visual element conflicts with historic production bible constraints."));
  }

  if (mentionsAny(enriched, ["苹果手机", "iPhone", "奔驰", "宝马", "特斯拉", "LV", "Gucci"])) {
    warnings.push(issue(patch, "brand_like_detail", "Brand-like detail should not be introduced during enrichment."));
  }

  if (original.length > 0 && enriched.length > Math.max(500, original.length * 6)) {
    warnings.push(issue(patch, "over_enrichment", `Enrichment is much longer than the original beat: "${compact(enriched)}"`));
  }

  if (patch.source_type !== "explicit" && !patch.needs_human_review) {
    warnings.push(issue(patch, "review_flag_missing", "Inferred/default visual details should be marked for human review."));
  }

  if (patch.confidence < 0.7 && !patch.needs_human_review) {
    warnings.push(issue(patch, "low_confidence_review", "Low-confidence patch should be marked needs_human_review."));
  }
}

export function validateEnrichmentPatches(
  patches: EnrichmentPatch[],
  context: EnrichmentContext,
): EnrichmentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const accepted_patches: EnrichmentPatch[] = [];
  const rejected_patches: EnrichmentPatch[] = [];

  patches.forEach((patch, index) => {
    const beforeErrors = errors.length;
    validatePatchShape(patch, errors, index);
    validateAssetCandidates(patch, context, errors, warnings);
    validatePatchSemantics(patch, context, errors, warnings);

    if (errors.length > beforeErrors) {
      rejected_patches.push(patch);
    } else {
      accepted_patches.push(patch);
    }
  });

  const status = errors.length > 0
    ? "invalid"
    : warnings.length > 0 || patches.some((patch) => patch.needs_human_review)
      ? "needs_review"
      : "valid";

  return {
    status,
    errors,
    warnings,
    rejected_patches,
    accepted_patches,
  };
}

