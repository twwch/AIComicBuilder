export type AssetPromptType = "character" | "prop" | "scene";
export type AssetVisualMode =
  | "character_turnaround"
  | "character_single"
  | "prop_white_background"
  | "scene_reference";

type BindingKind = "asset_bound" | "variant_bound" | "constraint_default" | "system_generated";

export interface CompiledVisualSlot {
  source: string;
  value: string;
  binding: BindingKind;
  required?: boolean;
  repaired?: boolean;
  repairNote?: string;
}

export interface AssetVisualSchema {
  identity?: Record<string, unknown> | null;
  appearance?: Record<string, unknown> | null;
  clothing?: {
    top?: unknown;
    bottom?: unknown;
    shoes?: unknown;
    outerwear?: unknown;
    accessories?: unknown;
  } | null;
  prop?: Record<string, unknown> | null;
  scene?: Record<string, unknown> | null;
  constraints?: {
    era?: unknown;
    genre?: unknown;
    mustHave?: unknown;
    mustNotHave?: unknown;
  } | null;
}

export interface AssetPromptAsset {
  id?: string | null;
  type: AssetPromptType;
  name: string;
  role?: string | null;
  category?: string | null;
  prompt?: string | null;
  description?: string | null;
  visualHint?: string | null;
  visualConstraints?: string | null;
  negativeConstraints?: string | null;
  tags?: string[] | null;
  sceneAssetId?: string | null;
  visualSchema?: AssetVisualSchema | null;
  faceTemplate?: { label?: string | null; url?: string | null; note?: string | null } | null;
}

export interface AssetPromptVariant {
  id?: string | null;
  name?: string | null;
  variantType?: string | null;
  state?: string | null;
  description?: string | null;
  prompt?: string | null;
  visualConstraints?: string | null;
  negativeConstraints?: string | null;
  editInstruction?: string | null;
  lockedTraits?: unknown;
  changedTraits?: unknown;
  visualSchema?: Partial<AssetVisualSchema> | null;
}

export interface AssetVisualSpec {
  mode?: AssetVisualMode;
  aspectRatio?: string | null;
  size?: string | null;
  background?: "pure_white" | "transparent" | "simple" | "environment";
  layout?: string | null;
}

export interface AssetStyleSpec {
  style?: string | null;
  lighting?: string | null;
  camera?: string | null;
  texture?: string | null;
  era?: string | null;
  eraConstraint?: string | null;
  genre?: string | null;
  forbiddenVisualElements?: string[] | null;
  mustHave?: string[] | null;
  mustNotHave?: string[] | null;
}

export interface AssetCompilerInput {
  asset: AssetPromptAsset;
  variant: AssetPromptVariant | null;
  visual_spec: AssetVisualSpec;
  style_spec: AssetStyleSpec;
}

export interface AssetCompilerIR {
  compiler: {
    name: "asset_prompt_compiler";
    version: "v2";
    mode: "schema_bound_final_prompt";
  };
  asset_type: AssetPromptType;
  asset_id: string;
  variant_id: string;
  bindings: {
    character_asset_id: string | null;
    character_variant_id: string | null;
    scene_asset_id: string | null;
    prop_asset_id: string | null;
    binding_rule: string;
  };
  identity: Record<string, CompiledVisualSlot>;
  appearance: Record<string, CompiledVisualSlot>;
  clothing: {
    top?: CompiledVisualSlot;
    bottom?: CompiledVisualSlot;
    shoes?: CompiledVisualSlot;
    outerwear?: CompiledVisualSlot;
    accessories?: CompiledVisualSlot;
  };
  prop: Record<string, CompiledVisualSlot>;
  scene: Record<string, CompiledVisualSlot>;
  pose_layout: Record<string, CompiledVisualSlot>;
  style: Record<string, CompiledVisualSlot>;
  constraints: {
    era: string;
    genre: string;
    must_have: string[];
    visual_must_not_have: string[];
    system_rules: string[];
  };
}

export interface ValidationReport {
  passed: boolean;
  errors: string[];
  warnings: string[];
  repairs: string[];
  system_rules: string[];
}

export interface BuiltAssetPrompt {
  compiler_input: AssetCompilerInput;
  compiler_ir: AssetCompilerIR;
  compiled_final_prompt: string;
  compiled_negative_prompt: string;
  compiled_display_prompt: string;
  validation_report: ValidationReport;
  // Compatibility aliases for older callers. New code should use the four fields above.
  structured_prompt: AssetCompilerIR;
  prompt: string;
  display_prompt: string;
  negative_prompt: string;
}

const NARRATIVE_PATTERNS = [
  /重生/,
  /复仇/,
  /换嫁/,
  /冲喜/,
  /婚姻/,
  /结婚/,
  /离婚/,
  /新婚/,
  /前世/,
  /今生/,
  /剧情/,
  /剧本/,
  /台词/,
  /对白/,
  /未来/,
  /命运/,
  /转身嫁/,
  /故事/,
  /情节/,
  /第\d+集/,
  /episode/i,
];

const ANCIENT_FORBIDDEN = [
  "hanfu",
  "ancient costume",
  "traditional Chinese robe",
  "period drama costume",
  "fantasy clothing",
  "wuxia costume",
  "xianxia costume",
  "flowing ceremonial dress",
  "imperial robe",
  "palace costume",
  "wide-sleeved robe",
  "hair sticks",
  "ancient hairstyle",
  "发簪",
  "汉服",
  "古装",
  "仙侠",
  "武侠",
  "宫廷服饰",
  "长袍广袖",
];

const FUTURE_OR_MODERN_TECH_FORBIDDEN = [
  "smartphone",
  "modern LED screen",
  "LED billboard",
  "laptop",
  "tablet computer",
  "QR code",
  "contemporary logo",
  "modern luxury car",
  "futuristic technology",
  "neon cyberpunk lighting",
];

const SYSTEM_RULES = {
  noStory: "Do not infer story events, relationships, dialogue, revenge, rebirth, marriage, or timeline details.",
  noCostumeInvention: "Do not invent clothing outside compiled clothing slots.",
  respectBindings: "All rendered visual details must come from asset/variant schema slots or constraint defaults.",
};

export function buildAssetImagePrompt(input: {
  asset: AssetPromptAsset;
  variant?: AssetPromptVariant | null;
  visualSpec?: AssetVisualSpec | null;
  styleSpec?: AssetStyleSpec | null;
}): BuiltAssetPrompt {
  const assetType = normalizeAssetType(input.asset.type);
  const compilerInput: AssetCompilerInput = {
    asset: input.asset,
    variant: input.variant ?? null,
    visual_spec: {
      ...defaultAssetVisualSpec(assetType),
      ...(input.visualSpec ?? {}),
    },
    style_spec: {
      ...defaultAssetStyleSpec(),
      ...(input.styleSpec ?? {}),
    },
  };
  const compilerIR = assetType === "character"
    ? buildCharacterCompilerIR(compilerInput)
    : assetType === "prop"
      ? buildPropCompilerIR(compilerInput)
      : buildSceneCompilerIR(compilerInput);
  const validationReport = validateCompilerIR(compilerIR);
  const compiledFinalPrompt = compileFinalPrompt(compilerIR);
  const compiledNegativePrompt = compileNegativePrompt(compilerIR);
  const compiledDisplayPrompt = compileDisplayPrompt(compiledFinalPrompt);

  return {
    compiler_input: compilerInput,
    compiler_ir: compilerIR,
    compiled_final_prompt: compiledFinalPrompt,
    compiled_negative_prompt: compiledNegativePrompt,
    compiled_display_prompt: compiledDisplayPrompt,
    validation_report: validationReport,
    structured_prompt: compilerIR,
    prompt: compiledFinalPrompt,
    display_prompt: compiledDisplayPrompt,
    negative_prompt: compiledNegativePrompt,
  };
}

export function categoryToAssetType(category: string): AssetPromptType {
  if (category === "characters" || category === "character") return "character";
  if (category === "props" || category === "items" || category === "prop") return "prop";
  return "scene";
}

export function defaultAssetVisualSpec(assetType: AssetPromptType, size?: string | null): AssetVisualSpec {
  if (assetType === "character") {
    return {
      mode: "character_turnaround",
      aspectRatio: "16:9",
      size: size || "1536x1024",
      background: "pure_white",
      layout: "left close-up portrait, right front side back full-body turnaround",
    };
  }
  if (assetType === "prop") {
    return {
      mode: "prop_white_background",
      aspectRatio: "16:9",
      size: size || "1536x1024",
      background: "pure_white",
      layout: "single centered prop, orthographic catalog view",
    };
  }
  return {
    mode: "scene_reference",
    aspectRatio: "16:9",
    size: size || "1536x1024",
    background: "environment",
    layout: "wide empty environment reference, no characters",
  };
}

export function defaultAssetStyleSpec(): AssetStyleSpec {
  return {
    style: "realistic live-action photography",
    lighting: "studio soft light",
    camera: "eye-level, 35mm film feel",
    texture: "natural skin texture, fabric texture, realistic material detail",
    genre: "realistic Chinese short-drama asset reference",
  };
}

export function buildPromptAnchoredFinalPrompt(input: {
  sourcePrompt?: string | null;
  compiledPrompt: string;
  category: string;
  targetName?: string | null;
  mode?: "main" | "variant" | "edit";
}) {
  const sourcePrompt = normalizeAuthoritativePrompt(input.sourcePrompt);
  const compiledPrompt = clean(input.compiledPrompt);
  const relationRules = promptRelationRules(input.category, input.mode);

  if (!sourcePrompt) {
    return [relationRules, compiledPrompt].filter(Boolean).join("\n\n");
  }

  return [
    `AUTHORITATIVE USER IMAGE PROMPT FOR ${input.targetName || "ASSET"}:`,
    "The following Chinese image prompt is the highest-priority source. The generated asset must strongly match it, not a generic studio portrait or default catalog item.",
    sourcePrompt,
    "PROMPT-IMAGE ALIGNMENT RULES:",
    relationRules,
    "SECONDARY STRUCTURAL GUARDRAILS:",
    "Use the compiled guardrails only when they do not conflict with the authoritative user prompt.",
    compiledPrompt,
  ].filter(Boolean).join("\n\n");
}

export function buildCompiledAssetProviderPrompt(input: {
  sourcePrompt?: string | null;
  compiledPrompt: string;
  category: string;
  targetName?: string | null;
  mode?: "main" | "variant" | "edit";
}) {
  const compiledPrompt = clean(input.compiledPrompt);
  const relationRules = promptRelationRules(input.category, input.mode);
  const sourcePrompt = normalizeAuthoritativePrompt(input.sourcePrompt);
  const sourceFingerprint = sourcePrompt
    ? `Display prompt source: Chinese editable asset prompt, ${sourcePrompt.length} characters, compiled into structured English slots.`
    : "";

  return [
    `STRUCTURED ENGLISH IMAGE PROMPT FOR ${input.targetName || "ASSET"}:`,
    sourceFingerprint,
    "GENERATION RULES:",
    relationRules,
    "COMPILED VISUAL PROMPT:",
    compiledPrompt,
  ].filter(Boolean).join("\n\n");
}

export function shouldRebuildAssetDisplayPrompt(prompt: unknown) {
  const text = normalizeAuthoritativePrompt(prompt);
  if (!text) return true;
  if (/Asset reference sheet|Reusable prop asset reference|Reusable empty scene environment reference|STRUCTURED ENGLISH IMAGE PROMPT/i.test(text)) {
    return true;
  }
  if (looksLikeLegacyDisplayPrompt(text)) return true;
  if (looksLikeOldCompiledChineseDisplayPrompt(text)) return true;
  if (looksLikeTranslatedCompiledDisplayPrompt(text)) return hasUntranslatedCompilerResidue(text);
  if (looksLikeConstraintOnlyPrompt(text)) return true;
  const profileText = extractDisplayPromptSection(text, ["角色档案", "物品档案", "环境档案"]) || text;
  return looksLikeDialogueOrActionLeak(profileText);
}

export function shouldPreferCompiledDisplayPrompt(existingPrompt: unknown, compiledDisplayPrompt: unknown) {
  const existing = normalizeAuthoritativePrompt(existingPrompt);
  const compiled = normalizeAuthoritativePrompt(compiledDisplayPrompt);
  if (!compiled) return false;
  if (!existing) return true;
  if (shouldRebuildAssetDisplayPrompt(existing)) return true;
  if (hasSpecificEraSignal(compiled) && !hasSpecificEraSignal(existing)) return true;
  if (hasGenericEraFallback(existing) && hasSpecificEraSignal(compiled)) return true;
  return false;
}

function normalizeAuthoritativePrompt(prompt: unknown) {
  const text = clean(prompt)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > 8000 ? `${text.slice(0, 8000).trim()}\n...` : text;
}

function extractDisplayPromptSection(prompt: string, titles: string[]) {
  for (const title of titles) {
    const marker = `【${title}】`;
    const start = prompt.indexOf(marker);
    if (start < 0) continue;
    const rest = prompt.slice(start + marker.length).trim();
    const next = rest.search(/\n【/);
    return (next >= 0 ? rest.slice(0, next) : rest).trim();
  }
  return "";
}

function looksLikeDialogueOrActionLeak(text: string) {
  const value = clean(text);
  if (!value) return false;
  const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.some(looksLikeSpeakerDialogueLine)) return true;
  if (/第\s*[0-9一二两三四五六七八九十百]+\s*[集场幕章]/.test(value)) return true;

  const pronounCount = (value.match(/[我你他她]/g) || []).length;
  const dialoguePunctuationCount = (value.match(/[？！?!]/g) || []).length;
  const actionLeak = /(说道|问道|喊道|冷笑|声音|语气|看见|看着|推到|抬头|转身|站在|坐在|握紧|拿起|递给|走到|回头|皱眉|哭|笑)/.test(value);
  if (pronounCount >= 4 && (dialoguePunctuationCount > 0 || actionLeak)) return true;
  if (pronounCount >= 2 && actionLeak) return true;
  return false;
}

function looksLikeConstraintOnlyPrompt(text: string) {
  const value = clean(text);
  if (!value) return false;
  const hasDisplaySections = /【(?:整体美学|画面规格|角色档案|物品档案|环境档案|职业与画风锚点|模板锁定|排除项)】/.test(value);
  if (hasDisplaySections) return false;
  const hasTemplateOrIdentityRules = /(模板|主图与全部变体|同一角色身份|脸型|五官|眉眼鼻唇|骨相|面部辨识度|性别识别|不改变年龄|只允许改变发型|禁止漫画风|换脸感)/.test(value);
  const hasReusableAssetContext = /(整体美学|画面规格|角色档案|物品档案|环境档案|空间类型|物品参考图|环境概念图|角色设定图|时代约束|资产设定|主图用于后续分镜复用)/.test(value);
  return hasTemplateOrIdentityRules && !hasReusableAssetContext;
}

function looksLikeLegacyDisplayPrompt(text: string) {
  return /【(?:整体美学|画面规格|角色档案|物品档案|环境档案|职业与画风锚点|模板锁定|排除项)】/.test(clean(text));
}

function looksLikeOldCompiledChineseDisplayPrompt(text: string) {
  const value = clean(text);
  const hasAssetHeader = /(资产参考设定图|可复用物品资产参考图|可复用空场景环境参考图)/.test(value);
  const hasOldSections = /(外貌|构图|必须满足|排除项)：/.test(value);
  return hasAssetHeader && hasOldSections;
}

function looksLikeTranslatedCompiledDisplayPrompt(text: string) {
  const value = clean(text);
  const hasAssetHeader = /(资产参考图|可复用物品资产参考图|可复用空场景环境参考图)/.test(value);
  const hasMirrorSections = /(外观|服装|物品设计|环境设计|排版布局|风格|必需的视觉约束)：/.test(value);
  return hasAssetHeader && hasMirrorSections;
}

function hasUntranslatedCompilerResidue(text: string) {
  return /\b(stable character identity|story scene background|unrelated environment props|cropped head|cropped feet|dramatic action pose|natural skin texture|anime style|illustration style|no comic style)\b/i.test(text);
}

function hasGenericEraFallback(text: string) {
  const value = clean(text);
  return /realistic modern\/civilian China unless asset schema explicitly states otherwise/i.test(value)
    || /现实主义现代\/平民中国，?除非资产结构明确指定其他时代/.test(value);
}

function hasSpecificEraSignal(text: string) {
  const value = clean(text);
  return /(19[0-9]{2}|20[0-9]{2})\s*(?:年|China)?/i.test(value)
    || /(1970s|1980s|1990s|70s|80s|90s)\s*China/i.test(value)
    || /(1970|1980|1990)年代中国|[七八九]十年代中国|[七八九]零年代中国/.test(value)
    || /Republican-era China|historical China|post-apocalyptic wasteland China/i.test(value)
    || /民国时期中国|古代中国|历史中国|中国末世废土|末世|废土/.test(value);
}

function looksLikeSpeakerDialogueLine(line: string) {
  const match = line.match(/^([\u4e00-\u9fa5A-Za-z0-9·]{1,12})(?:[（(][^）)]{1,24}[）)])?[：:]\s*(.+)$/);
  if (!match) return false;
  const label = match[1];
  const body = match[2] || "";
  const promptLabels = new Set([
    "主体",
    "类型",
    "空间类型",
    "变体名称",
    "变体生成要求",
    "参考模板",
    "模板约束",
    "身份约束",
    "上衣",
    "下装",
    "发型",
    "鞋",
    "配饰",
  ]);
  if (promptLabels.has(label)) return false;
  return /[我你他她]|[？！?!]|说|问|喊|没事|为什么|怎么|回来|听说/.test(body);
}

function promptRelationRules(category: string, mode?: "main" | "variant" | "edit") {
  const base = [
    "Follow every explicit visual fact in the authoritative prompt: overall aesthetic, era/world style, identity, profession, role profile, clothing, props, environment, layout, and exclusions.",
    "If a profession, faction, survival state, medical role, engineer role, commander role, villain role, or scene function is mentioned, make it visibly readable through outfit, accessories, material wear, posture, color, and asset details.",
    "Do not replace specified roles or styles with generic modern studio clothing, casual jeans, plain black shirts, business portraits, beauty-shot defaults, or unrelated clean catalog imagery unless the authoritative prompt explicitly asks for them.",
  ];
  if (category === "characters") {
    return [
      ...base,
      "For character assets, the face/template identity lock is mandatory, but clothing, accessories, makeup intensity, and state must still reflect the character profile and the script's overall aesthetic.",
      mode === "variant"
        ? "For variants, preserve the same face and identity while making the variant state clearly visible."
        : "",
    ].filter(Boolean).join("\n");
  }
  if (category === "props" || category === "items") {
    return [
      ...base,
      "For prop assets, the object must visibly reflect its script function, material, era, usage marks, and world style.",
    ].join("\n");
  }
  if (category === "scenes") {
    return [
      ...base,
      "For scene assets, architecture, set dressing, lighting, weathering, and scale must visibly match the script world style.",
    ].join("\n");
  }
  return base.join("\n");
}

function buildCharacterCompilerIR(input: AssetCompilerInput): AssetCompilerIR {
  const asset = input.asset;
  const variant = input.variant;
  const visualSpec = input.visual_spec;
  const styleSpec = input.style_spec;
  const stableText = stableVisualText(asset, variant);
  const tags = asset.tags ?? [];
  const constraints = compileConstraints("character", asset, variant, styleSpec, stableText);
  const gender = pickGender(tags, stableText);
  const age = pickAge(tags, stableText);
  const identity = {
    subject: slot(characterSubject(gender, age), "system.identity.subject", "system_generated", true),
    name: slot(asset.name, "asset.name", "asset_bound", true),
    gender: slot(gender, "asset.tags|asset.visualConstraints", "asset_bound"),
    age_range: slot(age, "asset.tags|asset.visualConstraints", "asset_bound"),
    role_identity: slot(asset.role || asset.category || "", "asset.role", "asset_bound"),
    variant: slot(variant?.name || variant?.variantType || "base character sheet", "variant.name", variant ? "variant_bound" : "system_generated"),
  };
  const appearance = {
    hairstyle: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "appearance", "hairstyle"),
      fallbackText: stableText,
      hints: ["发型", "头发", "短发", "长发", "盘发", "辫子"],
      defaultValue: eraDefaultHairstyle(constraints.era),
      source: "appearance.hairstyle",
      constraints,
    }),
    face_shape: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "appearance", "face_shape") ?? schemaValue(asset, variant, "appearance", "faceShape"),
      fallbackText: stableText,
      hints: ["脸型", "五官", "眉眼", "鼻", "唇", "骨相"],
      defaultValue: faceTemplateText(asset),
      source: "appearance.face_shape",
      constraints,
    }),
    skin_tone: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "appearance", "skin_tone") ?? schemaValue(asset, variant, "appearance", "skinTone"),
      fallbackText: stableText,
      hints: ["肤色", "皮肤"],
      defaultValue: "natural Chinese skin tone",
      source: "appearance.skin_tone",
      constraints,
    }),
    body_proportion: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "appearance", "body_proportion") ?? schemaValue(asset, variant, "appearance", "bodyProportion"),
      fallbackText: stableText,
      hints: ["身高", "体型", "身材", "比例"],
      defaultValue: "accurate full-body proportions",
      source: "appearance.body_proportion",
      constraints,
    }),
    expression: slot("neutral calm expression for reusable character reference", "system.character_asset.expression", "system_generated"),
  };
  const clothing = compileCharacterClothing(asset, variant, stableText, constraints);
  return {
    compiler: { name: "asset_prompt_compiler", version: "v2", mode: "schema_bound_final_prompt" },
    asset_type: "character",
    asset_id: clean(asset.id),
    variant_id: clean(variant?.id),
    bindings: bindingsFor("character", asset, variant),
    identity,
    appearance,
    clothing,
    prop: {},
    scene: {},
    pose_layout: {
      background: slot("pure white background", "visual_spec.background", "system_generated", true),
      layout: slot(visualSpec.layout || "left close-up portrait, right front side back full-body turnaround", "visual_spec.layout", "system_generated", true),
      camera: slot("eye-level front-facing studio reference", "visual_spec.camera", "system_generated", true),
      framing: slot("full body visible with complete head and feet inside the frame", "visual_spec.framing", "system_generated", true),
      consistency: slot("same face, same hairstyle, same clothing, same skin tone, same body shape in every view", "compiler.consistency_rule", "system_generated", true),
    },
    style: compileStyle(styleSpec, visualSpec),
    constraints: {
      era: constraints.era,
      genre: constraints.genre,
      must_have: uniq([
        "single character only",
        "pure white background",
        "left close-up portrait",
        "right front view full body",
        "right side view full body",
        "right back view full body",
        "eye-level camera",
        "accurate full-body proportions",
        "consistent face, hairstyle, clothing, skin tone, body shape across all views",
        ...arrayFrom(styleSpec.mustHave),
      ]),
      visual_must_not_have: uniq([
        ...constraints.visual_must_not_have,
        "extra people",
        "story scene background",
        "unrelated environment props",
        "cropped head",
        "cropped feet",
        "dramatic action pose",
      ]),
      system_rules: uniq([
        ...constraints.system_rules,
        SYSTEM_RULES.noCostumeInvention,
      ]),
    },
  };
}

function buildPropCompilerIR(input: AssetCompilerInput): AssetCompilerIR {
  const asset = input.asset;
  const variant = input.variant;
  const visualSpec = input.visual_spec;
  const styleSpec = input.style_spec;
  const stableText = stableVisualText(asset, variant);
  const constraints = compileConstraints("prop", asset, variant, styleSpec, stableText);
  return {
    compiler: { name: "asset_prompt_compiler", version: "v2", mode: "schema_bound_final_prompt" },
    asset_type: "prop",
    asset_id: clean(asset.id),
    variant_id: clean(variant?.id),
    bindings: bindingsFor("prop", asset, variant),
    identity: {
      name: slot(asset.name, "asset.name", "asset_bound", true),
      category: slot(asset.role || asset.category || "prop", "asset.role", "asset_bound"),
      variant: slot(variant?.name || "base prop", "variant.name", variant ? "variant_bound" : "system_generated"),
    },
    appearance: {},
    clothing: {},
    prop: {
      shape_material: compileTextSlot({
        schemaValue: schemaValue(asset, variant, "prop", "shape_material") ?? schemaValue(asset, variant, "prop", "shapeMaterial"),
        fallbackText: stableText,
        hints: ["形状", "材质", "颜色", "纹理", "磨损"],
        defaultValue: "stable prop shape, material, color, scale, and surface texture",
        source: "prop.shape_material",
        constraints,
      }),
      condition: compileTextSlot({
        schemaValue: schemaValue(asset, variant, "prop", "condition"),
        fallbackText: stableText,
        hints: ["状态", "磨损", "破旧", "崭新"],
        defaultValue: variant?.state || "base reusable prop state",
        source: "prop.condition",
        constraints,
      }),
    },
    scene: {},
    pose_layout: {
      background: slot("pure white background", "visual_spec.background", "system_generated", true),
      layout: slot(visualSpec.layout || "single centered prop, orthographic catalog view", "visual_spec.layout", "system_generated", true),
      camera: slot("eye-level product reference", "visual_spec.camera", "system_generated"),
      framing: slot("entire prop visible inside the frame", "visual_spec.framing", "system_generated", true),
    },
    style: compileStyle(styleSpec, visualSpec),
    constraints: {
      era: constraints.era,
      genre: constraints.genre,
      must_have: uniq(["single reusable prop asset", "pure white background", "entire object visible", ...arrayFrom(styleSpec.mustHave)]),
      visual_must_not_have: uniq([...constraints.visual_must_not_have, "people", "hands", "scene background", "holder", "reflected lettering"]),
      system_rules: uniq([...constraints.system_rules, "Do not invent a human interaction or usage scene."]),
    },
  };
}

function buildSceneCompilerIR(input: AssetCompilerInput): AssetCompilerIR {
  const asset = input.asset;
  const variant = input.variant;
  const visualSpec = input.visual_spec;
  const styleSpec = input.style_spec;
  const stableText = stableVisualText(asset, variant);
  const constraints = compileConstraints("scene", asset, variant, styleSpec, stableText);
  return {
    compiler: { name: "asset_prompt_compiler", version: "v2", mode: "schema_bound_final_prompt" },
    asset_type: "scene",
    asset_id: clean(asset.id),
    variant_id: clean(variant?.id),
    bindings: bindingsFor("scene", asset, variant),
    identity: {
      name: slot(asset.name, "asset.name", "asset_bound", true),
      category: slot(asset.role || asset.category || "scene environment", "asset.role", "asset_bound"),
      variant: slot(variant?.name || "base scene reference", "variant.name", variant ? "variant_bound" : "system_generated"),
    },
    appearance: {},
    clothing: {},
    prop: {},
    scene: {
      environment_design: compileTextSlot({
        schemaValue: schemaValue(asset, variant, "scene", "environment_design") ?? schemaValue(asset, variant, "scene", "environmentDesign"),
        fallbackText: stableText,
        hints: ["空间", "建筑", "陈设", "布局", "光源", "年代"],
        defaultValue: "stable empty environment layout, architecture, key furniture, lighting direction",
        source: "scene.environment_design",
        constraints,
      }),
    },
    pose_layout: {
      background: slot("environment reference, no characters", "visual_spec.background", "system_generated", true),
      layout: slot(visualSpec.layout || "wide empty environment reference", "visual_spec.layout", "system_generated", true),
      camera: slot("eye-level wide shot", "visual_spec.camera", "system_generated"),
      framing: slot("complete reusable scene layout", "visual_spec.framing", "system_generated", true),
    },
    style: compileStyle(styleSpec, visualSpec),
    constraints: {
      era: constraints.era,
      genre: constraints.genre,
      must_have: uniq(["empty reusable scene reference", "stable layout", "clear architecture and key set dressing", ...arrayFrom(styleSpec.mustHave)]),
      visual_must_not_have: uniq([...constraints.visual_must_not_have, "people", "characters", "crowds", "subtitles"]),
      system_rules: uniq([...constraints.system_rules, "Do not render plot action or dramatic event."]),
    },
  };
}

function compileCharacterClothing(
  asset: AssetPromptAsset,
  variant: AssetPromptVariant | null,
  stableText: string,
  constraints: { era: string; genre: string; visual_must_not_have: string[]; system_rules: string[] },
): AssetCompilerIR["clothing"] {
  return {
    top: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "clothing", "top"),
      fallbackText: stableText,
      hints: ["上衣", "衬衫", "制服", "外套", "衣", "袄"],
      defaultValue: eraDefaultClothing(constraints.era).top,
      source: "clothing.top",
      constraints,
      required: true,
    }),
    bottom: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "clothing", "bottom"),
      fallbackText: stableText,
      hints: ["下装", "裤", "裙"],
      defaultValue: eraDefaultClothing(constraints.era).bottom,
      source: "clothing.bottom",
      constraints,
      required: true,
    }),
    shoes: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "clothing", "shoes"),
      fallbackText: stableText,
      hints: ["鞋", "靴"],
      defaultValue: eraDefaultClothing(constraints.era).shoes,
      source: "clothing.shoes",
      constraints,
      required: true,
    }),
    outerwear: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "clothing", "outerwear"),
      fallbackText: stableText,
      hints: ["外套", "大衣", "夹克", "罩衫"],
      defaultValue: eraDefaultClothing(constraints.era).outerwear,
      source: "clothing.outerwear",
      constraints,
    }),
    accessories: compileTextSlot({
      schemaValue: schemaValue(asset, variant, "clothing", "accessories"),
      fallbackText: stableText,
      hints: ["轮椅", "拐杖", "眼镜", "帽", "发饰", "配饰", "包"],
      defaultValue: eraDefaultClothing(constraints.era).accessories,
      source: "clothing.accessories",
      constraints,
    }),
  };
}

function compileTextSlot(input: {
  schemaValue: unknown;
  fallbackText: string;
  hints: string[];
  defaultValue: string;
  source: string;
  constraints: { era: string; genre: string; visual_must_not_have: string[] };
  required?: boolean;
}): CompiledVisualSlot {
  const schemaText = visualSlotText(input.schemaValue);
  const picked = schemaText || pickByHints(input.fallbackText, input.hints);
  const source = schemaText
    ? `asset_variant_schema.${input.source}`
    : picked
      ? `asset.visualConstraints.${input.source}`
      : `constraint_injection.${input.source}`;
  const binding: BindingKind = schemaText ? "variant_bound" : picked ? "asset_bound" : "constraint_default";
  const sanitized = sanitizeVisualText(picked || input.defaultValue);
  const repaired = repairEraConflict(sanitized, input.defaultValue, input.constraints);
  return {
    ...slot(repaired.value, source, repaired.repaired ? "constraint_default" : binding, input.required),
    repaired: repaired.repaired || undefined,
    repairNote: repaired.repairNote,
  };
}

function compileConstraints(
  assetType: AssetPromptType,
  asset: AssetPromptAsset,
  variant: AssetPromptVariant | null,
  styleSpec: AssetStyleSpec,
  stableText: string,
) {
  const era = inferEraConstraint([
    styleSpec.eraConstraint,
    styleSpec.era,
    asset.visualSchema?.constraints?.era,
    variant?.visualSchema?.constraints?.era,
    stableText,
  ]);
  const genre = sanitizeVisualText(styleSpec.genre || asset.visualSchema?.constraints?.genre || "realistic Chinese short-drama asset reference");
  const visualMustNotHave = uniq([
    ...commonNegative(),
    ...eraForbiddenElements(era),
    ...arrayFrom(styleSpec.forbiddenVisualElements),
    ...arrayFrom(styleSpec.mustNotHave),
    ...arrayFrom(asset.visualSchema?.constraints?.mustNotHave),
    ...arrayFrom(variant?.visualSchema?.constraints?.mustNotHave),
    ...splitConstraintText(asset.negativeConstraints),
    ...splitConstraintText(variant?.negativeConstraints),
  ]);
  const typeRule = assetType === "character"
    ? SYSTEM_RULES.noCostumeInvention
    : assetType === "scene"
      ? "Do not turn the reusable scene reference into a plot frame."
      : "Do not turn the reusable prop reference into a held-object story frame.";
  return {
    era,
    genre: toEnglishPromptValue(genre || "realistic Chinese short-drama asset reference"),
    visual_must_not_have: visualMustNotHave,
    system_rules: uniq([SYSTEM_RULES.noStory, SYSTEM_RULES.respectBindings, typeRule]),
  };
}

function compileStyle(styleSpec: AssetStyleSpec, visualSpec: AssetVisualSpec): Record<string, CompiledVisualSlot> {
  return {
    visual_style: slot(styleSpec.style || "realistic live-action photography", "style_spec.style", "system_generated", true),
    lighting: slot(styleSpec.lighting || "studio soft light", "style_spec.lighting", "system_generated"),
    camera: slot(styleSpec.camera || "eye-level, 35mm film feel", "style_spec.camera", "system_generated"),
    texture: slot(styleSpec.texture || "natural skin texture, fabric texture", "style_spec.texture", "system_generated"),
    size: slot(visualSpec.size || "", "visual_spec.size", "system_generated"),
    aspect_ratio: slot(visualSpec.aspectRatio || "", "visual_spec.aspect_ratio", "system_generated"),
  };
}

function validateCompilerIR(ir: AssetCompilerIR): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const repairs = collectSlots(ir)
    .filter((slotItem) => slotItem.slot.repaired)
    .map((slotItem) => `${slotItem.path}: ${slotItem.slot.repairNote || "auto-repaired"}`);
  if (!clean(ir.constraints.genre)) errors.push("genre is empty");
  if (!clean(ir.constraints.era)) warnings.push("era is empty; compiler should inject an era default");
  const positiveText = collectSlots(ir).map((item) => item.slot.value).join(" ").toLowerCase();
  const forbiddenInPositive = ir.constraints.visual_must_not_have
    .filter((item) => item && containsForbiddenTerm(positiveText, item));
  if (forbiddenInPositive.length) {
    errors.push(`visual forbidden elements leaked into positive prompt: ${uniq(forbiddenInPositive).join(", ")}`);
  }
  if (ir.asset_type === "character") {
    for (const key of ["top", "bottom", "shoes"] as const) {
      if (!ir.clothing[key]?.value) errors.push(`missing required clothing slot: ${key}`);
    }
  }
  return {
    passed: errors.length === 0,
    errors,
    warnings,
    repairs,
    system_rules: ir.constraints.system_rules,
  };
}

function compileFinalPrompt(ir: AssetCompilerIR) {
  if (ir.asset_type === "character") return compileCharacterFinalPrompt(ir);
  if (ir.asset_type === "prop") return compilePropFinalPrompt(ir);
  return compileSceneFinalPrompt(ir);
}

function compileCharacterFinalPrompt(ir: AssetCompilerIR) {
  return [
    `${slotValue(ir.identity.subject)}, ${slotValue(ir.identity.age_range)}, ${slotValue(ir.identity.role_identity)}`.replace(/\s+,/g, ","),
    `Asset reference sheet for ${slotValue(ir.identity.name) || "the character"}, ${ir.constraints.genre}, ${ir.constraints.era}.`,
    `Appearance: ${joinValues([
      ir.appearance.face_shape,
      ir.appearance.skin_tone,
      ir.appearance.body_proportion,
      ir.appearance.hairstyle,
      ir.appearance.expression,
    ])}.`,
    `Clothing: ${joinValues([
      ir.clothing.top,
      ir.clothing.bottom,
      ir.clothing.shoes,
      ir.clothing.outerwear,
      ir.clothing.accessories,
    ])}.`,
    `Layout: ${joinValues([
      ir.pose_layout.background,
      ir.pose_layout.layout,
      ir.pose_layout.camera,
      ir.pose_layout.framing,
      ir.pose_layout.consistency,
    ])}.`,
    `Style: ${joinValues([
      ir.style.visual_style,
      ir.style.lighting,
      ir.style.camera,
      ir.style.texture,
      ir.style.aspect_ratio,
      ir.style.size,
    ])}.`,
    `Required visual constraints: ${ir.constraints.must_have.join(", ")}.`,
  ].filter((line) => clean(line).replace(/[,. ]/g, "")).join("\n");
}

function compilePropFinalPrompt(ir: AssetCompilerIR) {
  return [
    `Reusable prop asset reference for ${slotValue(ir.identity.name) || "the prop"}, ${slotValue(ir.identity.category)}, ${ir.constraints.genre}, ${ir.constraints.era}.`,
    `Prop design: ${joinValues([ir.prop.shape_material, ir.prop.condition])}.`,
    `Layout: ${joinValues([ir.pose_layout.background, ir.pose_layout.layout, ir.pose_layout.camera, ir.pose_layout.framing])}.`,
    `Style: ${joinValues([ir.style.visual_style, ir.style.lighting, ir.style.texture, ir.style.aspect_ratio, ir.style.size])}.`,
    `Required visual constraints: ${ir.constraints.must_have.join(", ")}.`,
  ].filter(Boolean).join("\n");
}

function compileSceneFinalPrompt(ir: AssetCompilerIR) {
  return [
    `Reusable empty scene environment reference for ${slotValue(ir.identity.name) || "the scene"}, ${slotValue(ir.identity.category)}, ${ir.constraints.genre}, ${ir.constraints.era}.`,
    `Environment design: ${joinValues([ir.scene.environment_design])}.`,
    `Layout: ${joinValues([ir.pose_layout.background, ir.pose_layout.layout, ir.pose_layout.camera, ir.pose_layout.framing])}.`,
    `Style: ${joinValues([ir.style.visual_style, ir.style.lighting, ir.style.texture, ir.style.aspect_ratio, ir.style.size])}.`,
    `Required visual constraints: ${ir.constraints.must_have.join(", ")}.`,
  ].filter(Boolean).join("\n");
}

function compileNegativePrompt(ir: AssetCompilerIR) {
  return renderNegativePrompt(ir.constraints.visual_must_not_have);
}

function compileDisplayPrompt(compiledFinalPrompt: string) {
  return compiledFinalPrompt
    .split(/\n+/)
    .map((line) => translateCompiledPromptLine(line))
    .filter(Boolean)
    .join("\n");
}

function translateCompiledPromptLine(line: string) {
  const text = clean(line).replace(/\.$/, "");
  if (!text) return "";

  const characterHeader = text.match(/^Asset reference sheet for (.+?),\s*(.+)$/i);
  if (characterHeader) {
    return `${toChinesePromptValue(characterHeader[1])}的资产参考图，${sentence(toChinesePromptValue(characterHeader[2]))}`;
  }

  const propHeader = text.match(/^Reusable prop asset reference for (.+?),\s*(.+)$/i);
  if (propHeader) {
    return `${toChinesePromptValue(propHeader[1])}的可复用物品资产参考图，${sentence(toChinesePromptValue(propHeader[2]))}`;
  }

  const sceneHeader = text.match(/^Reusable empty scene environment reference for (.+?),\s*(.+)$/i);
  if (sceneHeader) {
    return `${toChinesePromptValue(sceneHeader[1])}的可复用空场景环境参考图，${sentence(toChinesePromptValue(sceneHeader[2]))}`;
  }

  const labeledLine = text.match(/^([A-Za-z ]+):\s*(.+)$/);
  if (labeledLine) {
    const label = COMPILED_DISPLAY_LABELS[labeledLine[1].trim().toLowerCase()] || labeledLine[1].trim();
    return `${label}：${sentence(toChinesePromptValue(labeledLine[2]))}`;
  }

  return cleanupChineseList(toChinesePromptValue(text));
}

const COMPILED_DISPLAY_LABELS: Record<string, string> = {
  appearance: "外观",
  clothing: "服装",
  layout: "排版布局",
  style: "风格",
  "required visual constraints": "必需的视觉约束",
  "prop design": "物品设计",
  "environment design": "环境设计",
};

function sentence(text: string) {
  const value = cleanupChineseList(text).replace(/[，,；;.。]+$/g, "").trim();
  return value ? `${value}。` : "";
}

function bindingsFor(assetType: AssetPromptType, asset: AssetPromptAsset, variant: AssetPromptVariant | null) {
  const assetId = clean(asset.id) || "unbound_asset";
  const variantId = clean(variant?.id) || "base_variant";
  return {
    character_asset_id: assetType === "character" ? assetId : null,
    character_variant_id: assetType === "character" ? variantId : null,
    scene_asset_id: clean(asset.sceneAssetId) || (assetType === "scene" ? assetId : null),
    prop_asset_id: assetType === "prop" ? assetId : null,
    binding_rule: "IR-only binding: final prompt uses compiled visual values, while validator enforces binding provenance.",
  };
}

function stableVisualText(asset: AssetPromptAsset, variant?: AssetPromptVariant | null) {
  return [
    asset.prompt,
    asset.description,
    asset.visualConstraints,
    asset.visualHint,
    variant?.visualConstraints,
    variant?.description,
    variant?.state,
    variant?.editInstruction,
    compactChangedTraits(variant?.lockedTraits),
    compactChangedTraits(variant?.changedTraits),
  ].map((value) => sanitizeVisualText(value)).filter(Boolean).join("; ");
}

function sanitizeVisualText(value: unknown, maxLength = 420) {
  const text = clean(value)
    .replace(/\/templates\/[^\s，。；;）)]+/g, "template image")
    .replace(/【[^】]+】/g, "。")
    .replace(/\s+/g, " ")
    .split(/[。.!！？?]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !NARRATIVE_PATTERNS.some((pattern) => pattern.test(sentence)))
    .join("; ");
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function schemaValue(
  asset: AssetPromptAsset,
  variant: AssetPromptVariant | null,
  group: keyof AssetVisualSchema,
  key: string,
) {
  const variantGroup = variant?.visualSchema?.[group];
  const assetGroup = asset.visualSchema?.[group];
  const variantValue = variantGroup && typeof variantGroup === "object" ? (variantGroup as Record<string, unknown>)[key] : undefined;
  const assetValue = assetGroup && typeof assetGroup === "object" ? (assetGroup as Record<string, unknown>)[key] : undefined;
  return variantValue ?? assetValue;
}

function visualSlotText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return sanitizeVisualText(value);
  if (typeof value === "number" || typeof value === "boolean") return sanitizeVisualText(String(value));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.value != null) return sanitizeVisualText(record.value);
    return sanitizeVisualText(Object.values(record).filter(Boolean).join("; "));
  }
  return "";
}

function repairEraConflict(value: string, defaultValue: string, constraints: { era: string; visual_must_not_have: string[] }) {
  const lower = value.toLowerCase();
  const conflict = constraints.visual_must_not_have.some((item) => lower.includes(item.toLowerCase()));
  return conflict
    ? {
        value: defaultValue,
        repaired: true,
        repairNote: `replaced era-conflicting value "${value}" with "${defaultValue}"`,
      }
    : { value, repaired: false, repairNote: undefined };
}

function pickByHints(text: string, hints: string[]) {
  return text
    .split(/[;；。.\n]/)
    .map((part) => part.trim())
    .find((part) => hints.some((hint) => part.includes(hint))) || "";
}

function pickGender(tags: string[], text: string) {
  const joined = `${tags.join(" ")} ${text}`;
  if (/女性|女人|女主|女孩|少女|姑娘/.test(joined)) return "female";
  if (/男性|男人|男主|男孩|少年/.test(joined)) return "male";
  return "";
}

function pickAge(tags: string[], text: string) {
  const joined = `${tags.join(" ")} ${text}`;
  if (/儿童|小孩|孩子/.test(joined)) return "child";
  if (/少年|少女|学生|年轻|青年/.test(joined)) return "young adult";
  if (/中年/.test(joined)) return "middle-aged";
  if (/老人|老年/.test(joined)) return "elderly";
  const match = joined.match(/\d{1,2}\s*岁/);
  return match?.[0] ?? "";
}

function characterSubject(gender: string, age: string) {
  const ageText = age === "young adult" ? "young " : age ? `${age} ` : "";
  if (gender === "female") return `Chinese ${ageText}woman`.replace(/\s+/g, " ").trim();
  if (gender === "male") return `Chinese ${ageText}man`.replace(/\s+/g, " ").trim();
  return `Chinese ${ageText}person`.replace(/\s+/g, " ").trim();
}

function faceTemplateText(asset: AssetPromptAsset) {
  if (!asset.faceTemplate) return "consistent face shape and facial features";
  return sanitizeVisualText([asset.faceTemplate.label, asset.faceTemplate.note].filter(Boolean).join("; "));
}

function inferEraConstraint(values: unknown[]) {
  const joined = values.map((value) => clean(value)).filter(Boolean).join(" ");
  if (/末世|废土|末日|灾变|丧尸|避难所|重卡|荒凉/i.test(joined)) return "post-apocalyptic wasteland China";
  const explicitYear = joined.match(/(19[0-9]{2}|20[0-9]{2})\s*年?/);
  if (explicitYear) return `${explicitYear[1]} China`;
  if (/八十年代|80年代|1980年代|1980s/i.test(joined)) return "1980s China";
  if (/七十年代|70年代|1970年代|1970s/i.test(joined)) return "1970s China";
  if (/九十年代|90年代|1990年代|1990s/i.test(joined)) return "1990s China";
  if (/民国/.test(joined)) return "Republican-era China";
  if (/古代|唐代|宋代|明代|清代|汉代|古风|仙侠|武侠/.test(joined)) return "historical China";
  if (/现代|当代|现实/.test(joined)) return "contemporary realistic China";
  return "realistic modern/civilian China unless asset schema explicitly states otherwise";
}

function eraForbiddenElements(era: string) {
  if (isHistoricalEra(era)) return FUTURE_OR_MODERN_TECH_FORBIDDEN;
  if (isLate20thCenturyChina(era)) return [...ANCIENT_FORBIDDEN, ...FUTURE_OR_MODERN_TECH_FORBIDDEN];
  if (/modern|contemporary|civilian|现实|现代|当代/i.test(era)) return ANCIENT_FORBIDDEN;
  return ANCIENT_FORBIDDEN;
}

function isHistoricalEra(era: string) {
  return /historical|ancient|唐|宋|明|清|汉|古代|古风|仙侠|武侠/i.test(era);
}

function isLate20thCenturyChina(era: string) {
  return /19[5-9][0-9]|1970|1980|1990|70s|80s|90s|七十年代|八十年代|九十年代/i.test(era);
}

function is1970sEra(era: string) {
  return /197[0-9]|1970s|70s|七十年代|七零年代/i.test(era);
}

function is1980sEra(era: string) {
  return /198[0-9]|1980s|80s|八十年代|八零年代/i.test(era);
}

function is1990sEra(era: string) {
  return /199[0-9]|1990s|90s|九十年代|九零年代/i.test(era);
}

function eraDefaultClothing(era: string) {
  if (/post-apocalyptic|wasteland|末世|废土/i.test(era)) {
    return {
      top: "post-apocalyptic survival workwear or tactical jacket, weathered fabric, practical layered clothing",
      bottom: "post-apocalyptic cargo pants or durable work trousers with utility details",
      shoes: "worn tactical boots or heavy-duty survival boots",
      outerwear: "dusty survival jacket, tactical vest, or reinforced workwear outer layer if needed",
      accessories: "survival utility belt, medical pouch, radio, gloves, or practical faction accessories only when fitting the role",
    };
  }
  if (is1980sEra(era)) {
    return {
      top: "1980s China plain civilian blouse or shirt, simple modern cut, cotton fabric",
      bottom: "1980s China simple trousers or modest knee-length skirt, civilian everyday styling",
      shoes: "1980s China plain cloth shoes or low leather shoes",
      outerwear: "simple 1980s civilian jacket if outerwear is needed",
      accessories: "simple 1980s civilian accessories only when explicitly defined",
    };
  }
  if (is1970sEra(era)) {
    return {
      top: "1970s China plain civilian shirt or work jacket, simple modern cut",
      bottom: "1970s China straight trousers or plain skirt",
      shoes: "plain cloth shoes",
      outerwear: "simple work jacket only if outerwear is needed",
      accessories: "simple 1970s civilian accessories only when explicitly defined",
    };
  }
  if (is1990sEra(era)) {
    return {
      top: "1990s China plain civilian blouse, shirt, or simple jacket",
      bottom: "1990s China simple trousers or skirt",
      shoes: "plain low shoes",
      outerwear: "simple 1990s jacket only if outerwear is needed",
      accessories: "simple 1990s civilian accessories only when explicitly defined",
    };
  }
  return {
    top: "plain realistic civilian top, modern cut",
    bottom: "plain realistic civilian trousers or skirt",
    shoes: "plain realistic low shoes",
    outerwear: "simple civilian outerwear only if needed",
    accessories: "simple realistic civilian accessories only when explicitly defined",
  };
}

function eraDefaultHairstyle(era: string) {
  if (/post-apocalyptic|wasteland|末世|废土/i.test(era)) return "practical post-apocalyptic hairstyle with realistic dust or fatigue when fitting the role";
  if (is1980sEra(era)) return "simple 1980s China everyday hairstyle";
  return "realistic everyday hairstyle consistent across all views";
}

const ZH_VISUAL_PROMPT_TERMS: Array<[string, string]> = [
  ["真人实拍摄影质感", "realistic live-action photography"],
  ["自然皮肤毛孔与织物纹理", "natural skin pores and fabric texture"],
  ["自然皮肤纹理", "natural skin texture"],
  ["不要漫画风", "no comic style"],
  ["夸张美型或换脸感", "exaggerated beauty styling or face-swap look"],
  ["影棚级光影", "studio-grade lighting"],
  ["35mm 胶片质地", "35mm film texture"],
  ["年代写实影视画风", "period realistic cinematic style"],
  ["古装写实影视画风", "historical realistic cinematic style"],
  ["都市短剧写实画风", "urban realistic short-drama style"],
  ["真人短剧写实画风", "realistic live-action short-drama style"],
  ["整体画风", "overall visual style"],
  ["时代约束", "era constraint"],
  ["不出现明显跨时代物件", "no visibly anachronistic objects"],
  ["只允许改变", "only allow changes to"],
  ["不改变", "do not change"],
  ["必须与", "must match "],
  ["必须", "must"],
  ["保持", "keep"],
  ["参考", "reference "],
  ["突出", "emphasize "],
  ["服装、发型、建筑、交通工具、道具、电器和广告字体必须符合该年份", "clothing, hairstyle, architecture, vehicles, props, appliances, and signage must match that year"],
  ["服装、建筑、道具、色彩和光影保持时代质感统一", "clothing, architecture, props, color, and lighting keep a unified period texture"],
  ["1980年代中国", "1980s China"],
  ["八十年代中国", "1980s China"],
  ["七十年代中国", "1970s China"],
  ["九十年代中国", "1990s China"],
  ["1990年代中国", "1990s China"],
  ["1980年代中国", "1980s China"],
  ["1970年代中国", "1970s China"],
  ["现代中国", "contemporary China"],
  ["民国时期中国", "Republican-era China"],
  ["古代或架空古代中国", "ancient or fictional historical China"],
  ["女主角", "female lead"],
  ["男主角", "male lead"],
  ["女主角真人模板", "female lead live-action face template"],
  ["男主角真人模板", "male lead live-action face template"],
  ["女配角真人模板", "female supporting live-action face template"],
  ["男配角真人模板", "male supporting live-action face template"],
  ["女配角", "female supporting character"],
  ["男配角", "male supporting character"],
  ["反派角色", "antagonist character"],
  ["无名配角", "unnamed supporting character"],
  ["角色", "character"],
  ["女性", "female"],
  ["男性", "male"],
  ["年轻", "young adult"],
  ["青年", "young adult"],
  ["中年", "middle-aged"],
  ["老年", "elderly"],
  ["自然真实", "natural and realistic"],
  ["情绪层次克制", "restrained emotional layering"],
  ["紧张敏感", "tense and sensitive"],
  ["冷静克制", "calm and restrained"],
  ["温和细腻", "gentle and nuanced"],
  ["强势有压迫感", "commanding and oppressive"],
  ["疲惫脆弱", "tired and fragile"],
  ["脸型", "face shape"],
  ["五官比例", "facial feature proportions"],
  ["眉眼鼻唇比例", "eyebrow-eye-nose-lip proportions"],
  ["眉眼鼻唇关系", "eyebrow-eye-nose-lip relationship"],
  ["骨相", "facial bone structure"],
  ["面部辨识度", "facial recognizability"],
  ["面部辨识", "facial recognizability"],
  ["模板一致", "consistent with the template"],
  ["模板", "template"],
  ["一致", "consistent"],
  ["短发", "short hair"],
  ["长发", "long hair"],
  ["盘发", "updo hairstyle"],
  ["辫子", "braided hair"],
  ["发型", "hairstyle"],
  ["头发", "hair"],
  ["服装发型", "clothing and hairstyle"],
  ["上衣", "top"],
  ["下装", "bottom clothing"],
  ["外套", "outerwear jacket"],
  ["大衣", "coat"],
  ["夹克", "jacket"],
  ["衬衫", "shirt"],
  ["白大褂", "white medical coat"],
  ["制服", "uniform"],
  ["棉袄", "cotton-padded jacket"],
  ["红色棉袄", "red cotton-padded jacket"],
  ["裙子", "skirt"],
  ["长裤", "trousers"],
  ["裤子", "trousers"],
  ["布鞋", "cloth shoes"],
  ["皮鞋", "leather shoes"],
  ["鞋", "shoes"],
  ["靴", "boots"],
  ["配饰", "accessories"],
  ["医疗胸牌", "medical badge"],
  ["急救包", "first-aid kit"],
  ["医用腰包", "medical waist pouch"],
  ["眼镜", "glasses"],
  ["帽子", "hat"],
  ["红色", "red"],
  ["蓝色", "blue"],
  ["黑色", "black"],
  ["白色", "white"],
  ["灰色", "gray"],
  ["绿色", "green"],
  ["棕色", "brown"],
  ["米色", "beige"],
  ["低饱和", "low-saturation"],
  ["纯白背景", "pure white background"],
  ["平视视角", "eye-level view"],
  ["正面视角", "front view"],
  ["居中构图", "centered composition"],
  ["完整展示全貌", "full object visible"],
  ["单人完整入画", "single full character fully in frame"],
  ["头脚不裁切", "head and feet not cropped"],
  ["正面", "front view"],
  ["侧面", "side view"],
  ["背面", "back view"],
  ["三视图", "turnaround three-view sheet"],
  ["大全景", "wide establishing shot"],
  ["超广角", "ultra-wide angle"],
  ["大气透视", "atmospheric perspective"],
  ["道路", "road"],
  ["剧情场景", "story scene environment"],
  ["剧情道具", "story prop"],
  ["文件", "document prop"],
  ["合同", "contract document"],
  ["物品参考图", "prop reference sheet"],
  ["环境概念图", "environment concept reference"],
  ["角色设定图", "character design reference sheet"],
  ["空间结构", "spatial structure"],
  ["环境氛围", "environmental atmosphere"],
  ["方位关系", "orientation relationship"],
  ["空间尺度", "spatial scale"],
  ["布局", "layout"],
  ["建筑材质", "architectural materials"],
  ["主色调", "primary color palette"],
  ["标志性陈设", "signature set dressing"],
  ["光源基调", "base lighting direction"],
  ["形状", "shape"],
  ["尺寸", "size"],
  ["材质", "material"],
  ["颜色", "color"],
  ["磨损痕迹", "wear marks"],
  ["表面质感", "surface texture"],
  ["使用痕迹", "usage marks"],
  ["核心功能", "core function"],
  ["关键识别特征", "key recognizable features"],
  ["无字幕", "no subtitles"],
  ["无文字", "no text"],
  ["水印", "watermark"],
  ["无其他人物", "no other people"],
  ["无人", "no people"],
  ["无人物", "no people"],
  ["无人影", "no human silhouettes"],
  ["无背景环境", "no background environment"],
  ["无持握者", "no holder"],
  ["无手", "no hands"],
  ["禁止漫画风", "no comic style"],
  ["二次元", "anime style"],
  ["插画风", "illustration style"],
  ["现代豪车", "modern luxury car"],
  ["迈巴赫", "Maybach luxury car"],
  ["智能手机", "smartphone"],
  ["文字", "text"],
  ["和", " and "],
];

function toEnglishPromptValue(value: unknown) {
  let text = clean(value);
  if (!text) return "";
  if (!/[\u3400-\u9fff]/.test(text)) return text;

  for (const [source, target] of ZH_VISUAL_PROMPT_TERMS.sort((a, b) => b[0].length - a[0].length)) {
    text = text.replace(new RegExp(escapeRegExp(source), "g"), target);
  }

  return text
    .replace(/[【】]/g, "")
    .replace(/（/g, " (")
    .replace(/）/g, ") ")
    .replace(/[：]/g, ": ")
    .replace(/[，、]/g, ", ")
    .replace(/[；]/g, "; ")
    .replace(/[。！？]/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

const EN_VISUAL_PROMPT_TERMS: Array<[string, string]> = [
  ["realistic Chinese short-drama asset reference", "现实主义中国短剧资产参考"],
  ["contemporary realistic China", "当代现实中国"],
  ["realistic modern/civilian China unless asset schema explicitly states otherwise", "现实主义现代/平民中国，除非资产结构明确指定其他时代"],
  ["post-apocalyptic wasteland China", "中国末世废土"],
  ["Republican-era China", "民国时期中国"],
  ["historical China", "古代中国"],
  ["1980s China", "1980年代中国"],
  ["1970s China", "1970年代中国"],
  ["1990s China", "1990年代中国"],
  ["Chinese young woman", "中国年轻女性"],
  ["Chinese young man", "中国年轻男性"],
  ["Chinese middle-aged woman", "中国中年女性"],
  ["Chinese middle-aged man", "中国中年男性"],
  ["Chinese elderly woman", "中国老年女性"],
  ["Chinese elderly man", "中国老年男性"],
  ["Chinese woman", "中国女性"],
  ["Chinese man", "中国男性"],
  ["Chinese person", "中国人物"],
  ["female lead live-action face template", "女主角真人模板"],
  ["male lead live-action face template", "男主角真人模板"],
  ["female supporting live-action face template", "女配角真人模板"],
  ["male supporting live-action face template", "男配角真人模板"],
  ["female supporting character", "女性配角"],
  ["male supporting character", "男性配角"],
  ["female lead", "女主角"],
  ["male lead", "男主角"],
  ["antagonist character", "反派角色"],
  ["unnamed supporting character", "无名配角"],
  ["young adult", "青年"],
  ["middle-aged", "中年"],
  ["elderly", "老年"],
  ["female", "女性"],
  ["male", "男性"],
  ["base character sheet", "基础角色设定图"],
  ["base prop", "基础物品"],
  ["base scene reference", "基础场景参考"],
  ["consistent face shape and facial features", "脸型和五官保持一致"],
  ["natural Chinese skin tone", "自然中国肤色"],
  ["accurate full-body proportions", "准确全身比例"],
  ["neutral calm expression for reusable character reference", "中性平静表情，便于复用角色参考"],
  ["exaggerated beauty styling or face-swap look", "夸张美型或换脸感"],
  ["natural skin texture", "自然皮肤纹理"],
  ["no comic style", "不要漫画风"],
  ["anime style", "二次元"],
  ["illustration style", "插画风"],
  ["red cotton-padded jacket", "红色棉袄"],
  ["short hair", "短发"],
  ["long hair", "长发"],
  ["updo hairstyle", "盘发"],
  ["braided hair", "辫子"],
  ["practical post-apocalyptic hairstyle with realistic dust or fatigue when fitting the role", "实用末世发型，可按角色状态加入真实灰尘或疲惫感"],
  ["simple 1980s China everyday hairstyle", "1980年代中国日常简洁发型"],
  ["realistic everyday hairstyle consistent across all views", "现实日常发型，各视图保持一致"],
  ["post-apocalyptic survival workwear or tactical jacket, weathered fabric, practical layered clothing", "末世生存工装或战术夹克，旧化面料，实用层叠穿着"],
  ["post-apocalyptic cargo pants or durable work trousers with utility details", "末世工装裤或耐磨工作裤，带实用细节"],
  ["worn tactical boots or heavy-duty survival boots", "旧化战术靴或重型生存靴"],
  ["dusty survival jacket, tactical vest, or reinforced workwear outer layer if needed", "如需外套，使用带灰尘的生存夹克、战术背心或加固工装外层"],
  ["survival utility belt, medical pouch, radio, gloves, or practical faction accessories only when fitting the role", "仅在符合角色时加入生存工具腰带、医疗包、对讲机、手套或阵营实用配饰"],
  ["1980s China plain civilian blouse or shirt, simple modern cut, cotton fabric", "1980年代中国素色日常上衣或衬衫，简洁现代剪裁，棉质面料"],
  ["1980s China simple trousers or modest knee-length skirt, civilian everyday styling", "1980年代中国简洁长裤或朴素及膝裙，平民日常造型"],
  ["1980s China plain cloth shoes or low leather shoes", "1980年代中国素色布鞋或低帮皮鞋"],
  ["simple 1980s civilian jacket if outerwear is needed", "如需外套，使用简洁1980年代平民夹克"],
  ["simple 1980s civilian accessories only when explicitly defined", "仅在明确设定时加入简洁1980年代平民配饰"],
  ["1970s China plain civilian shirt or work jacket, simple modern cut", "1970年代中国素色平民衬衫或工作夹克，简洁现代剪裁"],
  ["1970s China straight trousers or plain skirt", "1970年代中国直筒长裤或素色裙装"],
  ["plain cloth shoes", "素色布鞋"],
  ["simple work jacket only if outerwear is needed", "如需外套，仅使用简洁工作夹克"],
  ["simple 1970s civilian accessories only when explicitly defined", "仅在明确设定时加入简洁1970年代平民配饰"],
  ["1990s China plain civilian blouse, shirt, or simple jacket", "1990年代中国素色日常上衣、衬衫或简洁夹克"],
  ["1990s China simple trousers or skirt", "1990年代中国简洁长裤或裙装"],
  ["plain low shoes", "素色低帮鞋"],
  ["simple 1990s jacket only if outerwear is needed", "如需外套，仅使用简洁1990年代夹克"],
  ["simple 1990s civilian accessories only when explicitly defined", "仅在明确设定时加入简洁1990年代平民配饰"],
  ["plain realistic civilian top, modern cut", "现实平民素色上衣，现代剪裁"],
  ["plain realistic civilian trousers or skirt", "现实平民素色长裤或裙装"],
  ["plain realistic low shoes", "现实素色低帮鞋"],
  ["simple civilian outerwear only if needed", "如需外套，仅使用简洁平民外套"],
  ["simple realistic civilian accessories only when explicitly defined", "仅在明确设定时加入简洁现实平民配饰"],
  ["pure white background", "纯白背景"],
  ["left close-up portrait, right front side back full-body turnaround", "左侧近景肖像，右侧正面、侧面、背面全身三视图"],
  ["right front side back full-body turnaround", "右侧正面、侧面、背面全身三视图"],
  ["left close-up portrait", "左侧近景肖像"],
  ["eye-level front-facing studio reference", "平视正面影棚参考"],
  ["full body visible with complete head and feet inside the frame", "全身入画，头脚完整不裁切"],
  ["same face, same hairstyle, same clothing, same skin tone, same body shape in every view", "各视图保持同一脸型、发型、服装、肤色和身形"],
  ["realistic live-action photography", "真人实拍摄影"],
  ["realistic product photography", "现实产品摄影"],
  ["realistic live-action environment reference", "真人实拍环境参考"],
  ["studio soft light", "影棚柔光"],
  ["eye-level, 35mm film feel", "平视视角，35mm胶片质感"],
  ["natural skin texture, fabric texture, realistic material detail", "自然皮肤纹理、织物纹理、真实材质细节"],
  ["natural skin texture, fabric texture", "自然皮肤纹理、织物纹理"],
  ["single character only", "仅单人角色"],
  ["stable character identity", "稳定角色身份"],
  ["right front view full body", "右侧正面全身"],
  ["right side view full body", "右侧侧面全身"],
  ["right back view full body", "右侧背面全身"],
  ["eye-level camera", "平视镜头"],
  ["consistent face", "脸部一致"],
  ["bottom clothing", "下装"],
  ["hairstyle", "发型"],
  ["clothing", "服装"],
  ["skin tone", "肤色"],
  ["outerwear", "外套"],
  ["accessories", "配饰"],
  ["bottom", "下装"],
  ["shoes", "鞋"],
  ["top", "上衣"],
  ["body shape across all views", "各视图身形一致"],
  ["stable prop shape, material, color, scale, and surface texture", "稳定的物品形状、材质、颜色、比例和表面质感"],
  ["base reusable prop state", "基础可复用物品状态"],
  ["single centered prop, orthographic catalog view", "单个物品居中，正交目录视图"],
  ["eye-level product reference", "平视产品参考"],
  ["entire prop visible inside the frame", "物品完整入画"],
  ["single reusable prop asset", "单个可复用物品资产"],
  ["scene environment", "场景环境"],
  ["environment", "环境"],
  ["prop", "物品"],
  ["scene", "场景"],
  ["entire object visible", "物品完整可见"],
  ["stable empty environment layout, architecture, key furniture, lighting direction", "稳定的空场景布局、建筑结构、关键陈设和光源方向"],
  ["environment reference, no characters", "环境参考，无角色"],
  ["wide empty environment reference", "宽幅空场景环境参考"],
  ["eye-level wide shot", "平视广角镜头"],
  ["complete reusable scene layout", "完整可复用场景布局"],
  ["empty reusable scene reference", "空场景可复用参考"],
  ["stable layout", "稳定布局"],
  ["clear architecture and key set dressing", "清晰建筑结构和关键陈设"],
  ["text", "文字"],
  ["logo", "Logo"],
  ["watermark", "水印"],
  ["subtitle", "字幕"],
  ["caption", "字幕"],
  ["extra limbs", "多余肢体"],
  ["extra fingers", "多余手指"],
  ["distorted anatomy", "人体结构畸变"],
  ["low resolution", "低清晰度"],
  ["hanfu", "汉服"],
  ["ancient costume", "古装"],
  ["traditional Chinese robe", "传统中式长袍"],
  ["period drama costume", "古装剧服饰"],
  ["fantasy clothing", "奇幻服装"],
  ["wuxia costume", "武侠服饰"],
  ["xianxia costume", "仙侠服饰"],
  ["flowing ceremonial dress", "飘逸礼服"],
  ["imperial robe", "皇室长袍"],
  ["palace costume", "宫廷服饰"],
  ["wide-sleeved robe", "宽袖长袍"],
  ["hair sticks", "发簪"],
  ["ancient hairstyle", "古代发型"],
  ["smartphone", "智能手机"],
  ["modern LED screen", "现代LED屏"],
  ["LED billboard", "LED广告牌"],
  ["laptop", "笔记本电脑"],
  ["tablet computer", "平板电脑"],
  ["QR code", "二维码"],
  ["contemporary logo", "当代Logo"],
  ["modern luxury car", "现代豪车"],
  ["futuristic technology", "未来科技"],
  ["neon cyberpunk lighting", "霓虹赛博朋克光效"],
  ["extra people", "多余人物"],
  ["story scene background", "故事场景背景"],
  ["unrelated environment props", "无关环境道具"],
  ["cropped head", "头部裁切"],
  ["cropped feet", "脚部裁切"],
  ["dramatic action pose", "剧情动作姿势"],
  ["duplicate character", "重复角色"],
  ["inconsistent face", "脸部不一致"],
  ["inconsistent clothing", "服装不一致"],
  ["people", "人物"],
  ["hands", "手"],
  ["held object scene", "手持物品场景"],
  ["background environment", "背景环境"],
  ["reflected lettering", "反射文字"],
  ["human silhouette", "人物剪影"],
  ["character portrait", "人物肖像"],
  ["unrelated prop close-up", "无关道具特写"],
  ["characters", "角色"],
  ["crowds", "人群"],
  ["UI", "界面"],
];

function toChinesePromptValue(value: unknown) {
  let text = clean(value);
  if (!text) return "";

  text = text
    .replace(/\/templates\/[^\s，。；;）)]+/g, "模板图")
    .replace(/\b(19[0-9]{2}|20[0-9]{2}) China\b/gi, "$1年中国");

  for (const [source, target] of EN_VISUAL_PROMPT_TERMS.slice().sort((a, b) => b[0].length - a[0].length)) {
    const isShortToken = source.length <= 4 && !/\s/.test(source);
    const pattern = new RegExp(isShortToken ? `\\b${escapeRegExp(source)}\\b` : escapeRegExp(source), "gi");
    text = text.replace(pattern, target);
  }

  const normalized = text
    .replace(/\s*,\s*/g, "，")
    .replace(/\s*;\s*/g, "；")
    .replace(/\s*\.\s*/g, "。")
    .replace(/(^|[^0-9])\s*:\s*(?![0-9])/g, "$1：")
    .replace(/\s+/g, " ")
    .replace(/([，；。：])\s+/g, "$1")
    .replace(/\s+([，；。：])/g, "$1")
    .trim();
  const cleaned = cleanupChineseList(normalized);
  return cleaned.replace(/[，；。：,.]/g, "").trim() ? cleaned : "";
}

function cleanupChineseList(value: string) {
  return clean(value)
    .replace(/，{2,}/g, "，")
    .replace(/；{2,}/g, "；")
    .replace(/。{2,}/g, "。")
    .replace(/^[，；。：\s]+|[，；：\s]+$/g, "")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsForbiddenTerm(text: string, term: string) {
  const lowerTerm = term.toLowerCase().trim();
  if (!lowerTerm) return false;
  if (/^[a-z0-9 ]+$/i.test(lowerTerm)) {
    const escaped = lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
  }
  return text.includes(lowerTerm);
}

function collectSlots(ir: AssetCompilerIR) {
  const groups = {
    identity: ir.identity,
    appearance: ir.appearance,
    clothing: ir.clothing,
    prop: ir.prop,
    scene: ir.scene,
    pose_layout: ir.pose_layout,
    style: ir.style,
  };
  return Object.entries(groups).flatMap(([groupName, group]) =>
    Object.entries(group).map(([key, slotItem]) => ({
      path: `${groupName}.${key}`,
      slot: slotItem as CompiledVisualSlot,
    })),
  ).filter((item) => item.slot);
}

function slotValue(slotItem?: CompiledVisualSlot) {
  return toEnglishPromptValue(slotItem?.value);
}

function joinValues(values: Array<CompiledVisualSlot | undefined>) {
  return values.map(slotValue).filter(Boolean).join(", ");
}

function arrayFrom(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => sanitizeVisualText(item)).filter(Boolean);
  return splitConstraintText(value);
}

function splitConstraintText(value: unknown) {
  return String(value ?? "")
    .split(/[,，;；\n]/)
    .map((item) => sanitizeVisualText(item))
    .filter(Boolean);
}

function compactChangedTraits(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function commonNegative() {
  return [
    "text",
    "logo",
    "watermark",
    "UI",
    "subtitle",
    "caption",
    "extra limbs",
    "extra fingers",
    "distorted anatomy",
    "low resolution",
  ];
}

function renderNegativePrompt(values: unknown[]) {
  return uniq(values.flatMap((value) => String(value ?? "").split(/[,，\n]/)))
    .map((item) => toEnglishPromptValue(sanitizeVisualText(item)))
    .filter(Boolean)
    .join(", ");
}

function slot(value: unknown, source: string, binding: BindingKind, required = false): CompiledVisualSlot {
  return {
    source,
    value: sanitizeVisualText(value),
    binding,
    required,
  };
}

function normalizeAssetType(type: AssetPromptType): AssetPromptType {
  return type === "character" || type === "prop" || type === "scene" ? type : "character";
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function uniq(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
