export type PromptAssetType = "character" | "scene" | "prop";
export type PromptFrameRole = "storyboard" | "first_frame" | "last_frame" | "reference";

export interface PromptAssetInput {
  id: string;
  type: PromptAssetType;
  name: string;
  description?: string | null;
  visualConstraints?: string | null;
  negativeConstraints?: string | null;
  referenceImage?: string | null;
}

export interface PromptAssetVariantInput {
  id: string;
  assetId: string;
  name: string;
  variantType?: string | null;
  state?: string | null;
  lockedTraits?: unknown;
  changedTraits?: unknown;
  visualConstraints?: string | null;
  negativeConstraints?: string | null;
  referenceImage?: string | null;
}

export interface PromptShotSpecInput {
  id: string;
  sequence: number;
  duration?: number | null;
  characters: string[];
  sceneAssetId?: string | null;
  propAssetIds: string[];
  shotType?: string | null;
  cameraAngle?: string | null;
  cameraMovement?: string | null;
  action?: string | null;
  emotion?: string | null;
}

export interface PromptProductionBibleInput {
  id?: string | null;
  worldSetting?: string | null;
  visualStyle?: string | null;
  eraConstraints?: string | null;
  locationRules?: string | null;
  characterRules?: string | null;
  sceneRules?: string | null;
  propRules?: string | null;
  positivePromptTemplate?: string | null;
  negativePromptTemplate?: string | null;
  complianceRules?: string | null;
}

export interface StructuredPromptSubject {
  type: PromptAssetType;
  asset_id: string;
  variant_id: string | null;
  name: string;
  variant: string;
  state: string;
  visual: string;
}

export interface StructuredImagePrompt {
  subjects: StructuredPromptSubject[];
  scene: {
    asset_id: string | null;
    variant_id: string | null;
    name: string;
    visual: string;
    era: string;
    constraints: string[];
  };
  camera: {
    shot_type: string;
    movement: string;
    composition: string;
    frame_role: PromptFrameRole;
  };
  action: string;
  style: string;
}

export interface BuiltImagePrompt {
  prompt: string;
  negative_prompt: string;
  structured_prompt: StructuredImagePrompt;
}

export function buildDeterministicImagePrompt(input: {
  shotSpec: PromptShotSpecInput;
  productionBible: PromptProductionBibleInput | null;
  assets: PromptAssetInput[];
  variantsByAssetId?: Map<string, PromptAssetVariantInput | null>;
  frameRole?: PromptFrameRole;
}): BuiltImagePrompt {
  const bible = input.productionBible;
  const frameRole = input.frameRole ?? "storyboard";
  const variantsByAssetId = input.variantsByAssetId ?? new Map();

  const orderedAssets = orderAssetsForShot(input.assets, input.shotSpec);
  const subjects = orderedAssets.map((asset) => {
    const variant = variantsByAssetId.get(asset.id) ?? null;
    return buildSubject(asset, variant);
  });

  const sceneSubject = subjects.find((subject) => subject.type === "scene") ?? null;
  const era = compactLines(bible?.eraConstraints, 700);
  const style = compactLines(
    [
      bible?.visualStyle,
      bible?.positivePromptTemplate,
      "realistic short-drama frame, production still, consistent asset identity",
    ].filter(Boolean).join("\n"),
    900,
  );
  const sceneConstraints = [
    bible?.worldSetting,
    bible?.eraConstraints,
    bible?.locationRules,
    bible?.sceneRules,
  ].map((value) => compactLines(value, 500)).filter(Boolean);

  const structuredPrompt: StructuredImagePrompt = {
    subjects,
    scene: {
      asset_id: sceneSubject?.asset_id ?? input.shotSpec.sceneAssetId ?? null,
      variant_id: sceneSubject?.variant_id ?? null,
      name: sceneSubject?.name ?? "",
      visual: sceneSubject?.visual ?? "",
      era,
      constraints: sceneConstraints,
    },
    camera: {
      shot_type: clean(input.shotSpec.shotType) || "storyboard",
      movement: clean(input.shotSpec.cameraMovement) || "static",
      composition: clean(input.shotSpec.cameraAngle) || "clear cinematic composition",
      frame_role: frameRole,
    },
    action: clean(input.shotSpec.action),
    style,
  };

  const negativePrompt = buildNegativePrompt({
    bible,
    assets: orderedAssets,
    variantsByAssetId,
  });

  return {
    prompt: renderStructuredPrompt(structuredPrompt),
    negative_prompt: negativePrompt,
    structured_prompt: structuredPrompt,
  };
}

function orderAssetsForShot(assets: PromptAssetInput[], shotSpec: PromptShotSpecInput) {
  const characterNameSet = new Set(shotSpec.characters.map((name) => name.trim()).filter(Boolean));
  const propIdSet = new Set(shotSpec.propAssetIds);
  return assets
    .filter((asset) => {
      if (asset.type === "character") return characterNameSet.size === 0 || characterNameSet.has(asset.name);
      if (asset.type === "scene") return !shotSpec.sceneAssetId || asset.id === shotSpec.sceneAssetId;
      if (asset.type === "prop") return propIdSet.has(asset.id);
      return false;
    })
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name));
}

function typeRank(type: PromptAssetType) {
  if (type === "character") return 0;
  if (type === "scene") return 1;
  return 2;
}

function buildSubject(asset: PromptAssetInput, variant: PromptAssetVariantInput | null): StructuredPromptSubject {
  const variantVisual = compactLines(variant?.visualConstraints, 420);
  const lockedTraits = compactJson(variant?.lockedTraits, 260);
  const changedTraits = compactJson(variant?.changedTraits, 220);
  const baseVisual = compactLines(asset.visualConstraints, 360) || compactVisualFallback(asset.description);
  const visual = [
    baseVisual && `base=${baseVisual}`,
    variantVisual && `variant=${variantVisual}`,
    lockedTraits && `locked_traits=${lockedTraits}`,
    changedTraits && `changed_traits=${changedTraits}`,
  ].filter(Boolean).join("; ");

  return {
    type: asset.type,
    asset_id: asset.id,
    variant_id: variant?.id ?? null,
    name: asset.name,
    variant: clean(variant?.name) || clean(variant?.variantType) || "default",
    state: compactLines(variant?.state, 220),
    visual,
  };
}

function buildNegativePrompt(input: {
  bible: PromptProductionBibleInput | null;
  assets: PromptAssetInput[];
  variantsByAssetId: Map<string, PromptAssetVariantInput | null>;
}) {
  const parts = [
    input.bible?.negativePromptTemplate,
    input.bible?.complianceRules,
    input.bible?.eraConstraints
      ? `avoid anything that violates era constraints: ${compactLines(input.bible.eraConstraints, 700)}`
      : "",
    "modern smartphones, modern cars, LED screens, contemporary logos, modern street signs, modern plastic packaging, modern makeup, fashion outside the production bible era",
    "subtitles, captions, UI, watermark, logo, unreadable text, extra limbs, extra fingers, duplicate face, inconsistent face, wrong costume, unrelated background characters",
    ...input.assets.flatMap((asset) => [
      asset.negativeConstraints,
      input.variantsByAssetId.get(asset.id)?.negativeConstraints,
    ]),
  ];

  return uniqText(parts.map((value) => compactLines(value, 700)).filter(Boolean)).join("\n");
}

function renderStructuredPrompt(structured: StructuredImagePrompt) {
  const subjectLines = structured.subjects.length > 0
    ? structured.subjects.map((subject) => [
        `- type=${subject.type}`,
        `asset_id=${subject.asset_id}`,
        `variant_id=${subject.variant_id ?? "none"}`,
        `name=${subject.name}`,
        subject.variant && `variant=${subject.variant}`,
        subject.state && `state=${subject.state}`,
        subject.visual && `visual=${subject.visual}`,
      ].filter(Boolean).join("; ")).join("\n")
    : "- none";

  return [
    "[SUBJECTS]",
    subjectLines,
    "",
    "[SCENE_CONSTRAINTS]",
    `era=${structured.scene.era || "from production_bible"}`,
    `style=${structured.style}`,
    structured.scene.asset_id && `scene_asset_id=${structured.scene.asset_id}`,
    structured.scene.variant_id && `scene_variant_id=${structured.scene.variant_id}`,
    structured.scene.name && `scene_name=${structured.scene.name}`,
    structured.scene.visual && `scene_visual=${structured.scene.visual}`,
    structured.scene.constraints.length > 0 && `constraints=${structured.scene.constraints.join(" | ")}`,
    "",
    "[CAMERA]",
    `shot_type=${structured.camera.shot_type}`,
    `movement=${structured.camera.movement}`,
    `composition=${structured.camera.composition}`,
    `frame_role=${structured.camera.frame_role}`,
    "",
    "[ACTION]",
    structured.action || "hold the shot action defined by shot_spec; do not invent new plot",
  ].filter((line) => line !== false && line !== undefined && line !== null).join("\n");
}

function compactVisualFallback(value: unknown) {
  const text = compactLines(value, 220);
  if (!text) return "";
  return text
    .split(/[。.!！？?\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("; ");
}

function compactLines(value: unknown, maxLength = 300) {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function compactJson(value: unknown, maxLength = 240) {
  if (value === null || value === undefined || value === "") return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return compactLines(text, maxLength);
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function uniqText(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
