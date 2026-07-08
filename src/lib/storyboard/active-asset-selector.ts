import type {
  NormalizedStoryboardShot,
  StoryboardActiveAssets,
  StoryboardAssetInput,
  StoryboardAssetRef,
  StoryboardAssetRole,
  StoryboardAssetType,
  StoryboardAssetVariantInput,
  StoryboardBoundAsset,
  StoryboardLookup,
  StoryboardSubject,
  StoryboardVisualAssetInput,
} from "./types";
import { compactText, parseStringArray, readString, sanitizePromptText, toRecord, unique } from "./prompt-sanitizer";

const DETAIL_TERMS = /特写|近景|细节|手部|脸部|close-up|detail|insert|macro/i;
const REACTION_TERMS = /反应|表情|脸|眼神|reaction|face|expression/i;
const VEHICLE_TERMS = /车|汽车|卡车|巴士|摩托|自行车|船|飞机|车灯|远光灯|前照灯|vehicle|car|truck|bus|motorcycle|bike|boat|plane|headlight/i;
const COMPONENT_TERMS = /轮胎|车轮|雨刷|玻璃|门把|按钮|屏幕|把手|车窗|窗户|手指|眼睛|tire|wheel|wiper|glass|handle|button|screen|window|finger|eye/i;
const BODY_DETAIL_TERMS = /手指|手部|手掌|眼睛|脸|肩|背影|finger|hand|eye|face|shoulder/i;
const PERSON_TERMS = /人物|角色|男人|女人|老人|孩子|少年|少女|他|她|其|主角|配角|person|man|woman|boy|girl|character/i;

export function buildStoryboardLookup(input: {
  assets?: unknown[];
  assetVariants?: unknown[];
  visualAssets?: unknown[];
}): StoryboardLookup {
  const assets = (input.assets ?? []).map(normalizeAsset).filter((asset): asset is StoryboardAssetInput => Boolean(asset));
  const variants = (input.assetVariants ?? []).map(normalizeVariant).filter((variant): variant is StoryboardAssetVariantInput => Boolean(variant));
  const variantsByAssetId = new Map<string, StoryboardAssetVariantInput[]>();
  for (const variant of variants) {
    const list = variantsByAssetId.get(variant.assetId) ?? [];
    list.push(variant);
    variantsByAssetId.set(variant.assetId, list);
  }

  return {
    assetsById: new Map(assets.map((asset) => [asset.id, asset])),
    variantsById: new Map(variants.map((variant) => [variant.id, variant])),
    variantsByAssetId,
    visualAssets: (input.visualAssets ?? [])
      .map(normalizeVisualAsset)
      .filter((asset): asset is StoryboardVisualAssetInput => Boolean(asset)),
  };
}

function normalizeAsset(value: unknown): StoryboardAssetInput | null {
  const record = toRecord(value);
  const id = readString(record, ["id", "asset_id", "assetId"]);
  const type = readString(record, ["type", "asset_type", "assetType"]);
  const name = readString(record, ["name", "asset_name", "assetName"]);
  if (!id || !name || (type !== "character" && type !== "scene" && type !== "prop")) return null;
  return {
    id,
    type,
    name,
    aliases: parseStringArray(record.aliases),
    description: readString(record, ["description"]),
    visualConstraints: readString(record, ["visualConstraints", "visual_constraints"]),
    negativeConstraints: readString(record, ["negativeConstraints", "negative_constraints"]),
    referenceImage: readString(record, ["referenceImage", "reference_image", "imageUrl", "fileUrl"]),
    metadata: record.metadata,
  };
}

function normalizeVariant(value: unknown): StoryboardAssetVariantInput | null {
  const record = toRecord(value);
  const id = readString(record, ["id", "variant_id", "variantId"]);
  const assetId = readString(record, ["assetId", "asset_id"]);
  if (!id || !assetId) return null;
  return {
    id,
    assetId,
    name: readString(record, ["name", "variant_name", "variantName"]),
    variantType: readString(record, ["variantType", "variant_type"]),
    state: readString(record, ["state"]),
    lockedTraits: record.lockedTraits ?? record.locked_traits,
    changedTraits: record.changedTraits ?? record.changed_traits,
    visualConstraints: readString(record, ["visualConstraints", "visual_constraints"]),
    negativeConstraints: readString(record, ["negativeConstraints", "negative_constraints"]),
    referenceImage: readString(record, ["referenceImage", "reference_image", "imageUrl", "fileUrl"]),
    status: readString(record, ["status"]),
  };
}

function normalizeVisualAsset(value: unknown): StoryboardVisualAssetInput | null {
  const record = toRecord(value);
  const assetId = readString(record, ["asset_id", "assetId"]);
  const url = readString(record, ["url", "imageUrl", "fileUrl", "referenceImage", "reference_image"]);
  if (!assetId || !url) return null;
  return {
    asset_id: assetId,
    variant_id: readString(record, ["variant_id", "variantId"]),
    url,
    role: readString(record, ["role", "type"]),
    status: readString(record, ["status"]),
  };
}

export function chooseBaseVariant(assetId: string, lookup: StoryboardLookup) {
  const variants = lookup.variantsByAssetId.get(assetId) ?? [];
  return variants.find((variant) => variant.variantType === "default")
    ?? variants.find((variant) => /default|base|基础/i.test(`${variant.name ?? ""} ${variant.variantType ?? ""}`))
    ?? variants.find((variant) => /locked|approved|generated/i.test(variant.status ?? ""))
    ?? variants[0]
    ?? null;
}

function normalizeShotRef(value: unknown, lookup: StoryboardLookup): StoryboardAssetRef | null {
  if (typeof value === "string") {
    const variant = chooseBaseVariant(value, lookup);
    return { asset_id: value, variant_id: variant?.id ?? "" };
  }

  const record = toRecord(value);
  const assetId = readString(record, ["asset_id", "assetId", "id"]);
  if (!assetId) return null;
  const explicitVariantId = readString(record, ["variant_id", "variantId"]);
  const variant = explicitVariantId ? lookup.variantsById.get(explicitVariantId) : chooseBaseVariant(assetId, lookup);
  return {
    asset_id: assetId,
    variant_id: variant?.id ?? explicitVariantId,
    name: readString(record, ["name", "asset_name", "assetName"]),
  };
}

function normalizeShotRefArray(value: unknown, lookup: StoryboardLookup) {
  const values = Array.isArray(value) ? value : [];
  return values.map((item) => normalizeShotRef(item, lookup)).filter((item): item is StoryboardAssetRef => Boolean(item));
}

function normalizeCamera(value: unknown, record: Record<string, unknown>) {
  const camera = toRecord(value);
  return {
    shot_type: readString(camera, ["shot_type", "shotType", "shot_size", "shotSize", "size"]) || readString(record, ["shot_type", "shotType", "shot_size", "shotSize"]),
    angle: readString(camera, ["angle", "cameraAngle"]) || readString(record, ["camera_angle", "cameraAngle"]),
    framing: readString(camera, ["framing", "composition", "compositionGuide"]) || readString(record, ["framing", "composition", "compositionGuide"]),
    movement: readString(camera, ["movement", "cameraMovement"]) || readString(record, ["camera_movement", "cameraMovement", "cameraDirection"]),
  };
}

export function normalizeStoryboardShot(rawShot: unknown, index: number, lookup: StoryboardLookup): NormalizedStoryboardShot {
  const record = toRecord(rawShot);
  const camera = normalizeCamera(record.camera, record);
  const action = readString(record, ["action", "motionScript", "motion_script"]);
  const frameDescription = readString(record, ["static_frame_description", "staticFrameDescription", "frame_description", "frameDescription", "startFrame", "prompt", "videoPrompt", "source_text", "sourceText"]);
  const characterLegacyIds = parseStringArray(record.character_asset_ids ?? record.characterAssetIds ?? record.character_ids ?? record.characterIds);
  const propLegacyIds = parseStringArray(record.prop_asset_ids ?? record.propAssetIds ?? record.prop_ids ?? record.propIds);
  const sceneAsset = normalizeShotRef(record.scene_asset ?? record.sceneAsset, lookup)
    ?? normalizeShotRef(readString(record, ["scene_asset_id", "sceneAssetId"]), lookup);

  const characters = uniqueRefs([
    ...normalizeShotRefArray(record.characters, lookup),
    ...characterLegacyIds.map((assetId) => ({ asset_id: assetId, variant_id: chooseBaseVariant(assetId, lookup)?.id ?? "" })),
  ]);
  const props = uniqueRefs([
    ...normalizeShotRefArray(record.props, lookup),
    ...propLegacyIds.map((assetId) => ({ asset_id: assetId, variant_id: chooseBaseVariant(assetId, lookup)?.id ?? "" })),
  ]);

  const sourceText = [
    frameDescription,
    action,
    readString(record, ["videoPrompt", "video_prompt"]),
    readString(record, ["videoScript", "video_script"]),
    readString(record, ["motionScript", "motion_script"]),
    readString(record, ["emotion", "focalPoint"]),
    camera.framing,
    camera.movement,
  ].filter(Boolean).join(" ");

  return {
    shot_id: readString(record, ["shot_id", "shotId", "id"]) || `shot_${String(index + 1).padStart(3, "0")}`,
    episode_id: readString(record, ["episode_id", "episodeId"]),
    scene_id: readString(record, ["scene_id", "sceneId"]),
    shot_type: readString(record, ["shot_type", "shotType", "shot_role", "shotRole"]) || camera.shot_type,
    frame_description: frameDescription || action,
    action,
    emotion: readString(record, ["emotion", "focalPoint"]),
    composition: readString(record, ["composition", "compositionGuide"]) || camera.framing,
    camera,
    characters,
    scene_asset: sceneAsset,
    props,
    dialogue_text: readString(record, ["dialogue", "dialogues", "dialogue_text", "dialogueText"]),
    voiceover: readString(record, ["voiceover", "voiceOver"]),
    sound_effect: readString(record, ["sound", "soundDesign", "sound_design", "sound_effects", "soundEffects", "musicCue", "music_cue"]),
    duration: readString(record, ["duration"]),
    lock_status: readString(record, ["lock_status", "lockStatus"]),
    source_text: sourceText,
    planned_frame_id: readString(record, ["frame_id", "frameId"]),
    preplanned_frame: Boolean(record.preplanned_frame ?? record.preplannedFrame),
    planner_visible_asset_ids: collectPlannerVisibleAssetIds(record),
  };
}

function collectPlannerVisibleAssetIds(record: Record<string, unknown>) {
  const ids: string[] = [];
  const visit = (value: unknown, allowString = false) => {
    if (!value) return;
    if (typeof value === "string") {
      if (allowString && value.trim()) ids.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, allowString));
      return;
    }
    if (typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const assetId = readString(item, ["asset_id", "assetId"]);
    if (assetId) ids.push(assetId);
    Object.entries(item).forEach(([key, nested]) => {
      if (["characters", "scene", "props"].includes(key)) visit(nested, true);
    });
  };
  visit(record.active_assets ?? record.activeAssets);
  visit(record.subject);
  return unique(ids);
}

function uniqueRefs(refs: StoryboardAssetRef[]) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.asset_id}:${ref.variant_id}`;
    if (!ref.asset_id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function bindingReferenceImage(assetId: string, variantId: string, lookup: StoryboardLookup) {
  const visualExact = lookup.visualAssets.find((asset) =>
    (asset.asset_id || asset.assetId) === assetId &&
    (asset.variant_id || asset.variantId || "") === variantId &&
    (asset.url || asset.imageUrl || asset.fileUrl || asset.referenceImage)
  );
  if (visualExact) return visualExact.url || visualExact.imageUrl || visualExact.fileUrl || visualExact.referenceImage || "";

  const variant = variantId ? lookup.variantsById.get(variantId) : null;
  if (variant?.referenceImage) return variant.referenceImage;

  const asset = lookup.assetsById.get(assetId);
  if (asset?.referenceImage) return asset.referenceImage;

  const visualAsset = lookup.visualAssets.find((item) =>
    (item.asset_id || item.assetId) === assetId &&
    (item.url || item.imageUrl || item.fileUrl || item.referenceImage)
  );
  return visualAsset?.url || visualAsset?.imageUrl || visualAsset?.fileUrl || visualAsset?.referenceImage || "";
}

function describeTraits(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return compactText(value, 180);
  if (Array.isArray(value)) return compactText(value.map((item) => String(item)).join(", "), 180);
  if (typeof value === "object") {
    return compactText(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => `${key}: ${String(item)}`)
        .join(", "),
      180,
    );
  }
  return "";
}

function bindAsset(ref: StoryboardAssetRef, expectedType: StoryboardAssetType, role: StoryboardAssetRole, lookup: StoryboardLookup): StoryboardBoundAsset | null {
  const asset = lookup.assetsById.get(ref.asset_id);
  if (!asset) return null;
  if (asset.type !== expectedType) return null;
  const variant = ref.variant_id ? lookup.variantsById.get(ref.variant_id) : chooseBaseVariant(ref.asset_id, lookup);
  const variantId = variant?.id ?? ref.variant_id;
  const description = compactText([
    asset.description,
    asset.visualConstraints,
    variant?.state,
    variant?.visualConstraints,
    describeTraits(variant?.lockedTraits),
    describeTraits(variant?.changedTraits),
  ].filter(Boolean).join("; "), 280);

  return {
    asset_id: ref.asset_id,
    variant_id: variantId,
    reference_image_url: bindingReferenceImage(ref.asset_id, variantId, lookup),
    name: asset.name,
    asset_type: asset.type,
    role_in_frame: role,
    description,
  };
}

function assetTerms(asset: StoryboardAssetInput) {
  return unique([asset.name, ...(asset.aliases ?? []), asset.id]).filter(Boolean);
}

function textMentionsAsset(text: string, asset: StoryboardAssetInput) {
  const lower = text.toLowerCase();
  return assetTerms(asset).some((term) => lower.includes(term.toLowerCase()));
}

function scoreProp(prop: StoryboardBoundAsset, frameText: string, isDetailShot: boolean) {
  let score = 0;
  if (frameText.includes(prop.name) || frameText.includes(prop.asset_id)) score += 6;
  if (prop.role_in_frame === "subject") score += 3;
  if (VEHICLE_TERMS.test(`${prop.name} ${prop.description}`)) score += isDetailShot ? 0 : 2;
  if (COMPONENT_TERMS.test(`${prop.name} ${prop.description}`)) score += isDetailShot ? 2 : -2;
  return score;
}

export function selectActiveAssets(input: {
  shot: NormalizedStoryboardShot;
  frameDescription: string;
  lookup: StoryboardLookup;
}) {
  const frameText = sanitizePromptText(`${input.frameDescription} ${input.shot.composition} ${input.shot.camera.framing}`);
  const isDetailShot = DETAIL_TERMS.test(`${input.shot.shot_type} ${input.shot.camera.shot_type} ${frameText}`);
  const isReactionShot = REACTION_TERMS.test(`${input.shot.shot_type} ${frameText}`);
  const isVehicleOrComponentFrame = VEHICLE_TERMS.test(frameText) || COMPONENT_TERMS.test(frameText);
  const isBodyDetailFrame = BODY_DETAIL_TERMS.test(frameText);
  const isPersonFrame = PERSON_TERMS.test(frameText);
  const plannerVisibleIds = new Set(input.shot.planner_visible_asset_ids ?? []);

  const mentionedCharacters = input.shot.characters
    .map((ref, index) => bindAsset(ref, "character", index === 0 ? "subject" : isReactionShot ? "reaction" : "background", input.lookup))
    .filter((asset): asset is StoryboardBoundAsset => Boolean(asset))
    .filter((asset) => plannerVisibleIds.has(asset.asset_id) || characterVisibleInFrame(asset, frameText, input.lookup));
  const fallbackCharacters =
    mentionedCharacters.length === 0 &&
    (!isVehicleOrComponentFrame || isBodyDetailFrame) &&
    (isPersonFrame || isBodyDetailFrame || input.shot.characters.length === 1)
      ? input.shot.characters
          .map((ref) => bindAsset(ref, "character", "subject", input.lookup))
          .filter((asset): asset is StoryboardBoundAsset => Boolean(asset))
          .slice(0, 1)
      : [];
  const boundCharacters = uniqueBoundAssets([...mentionedCharacters, ...fallbackCharacters])
    .slice(0, 2);

  const explicitScene = input.shot.scene_asset ? bindAsset(input.shot.scene_asset, "scene", "background", input.lookup) : null;
  const mentionedSceneAsset = Array.from(input.lookup.assetsById.values())
    .find((asset) => asset.type === "scene" && textMentionsAsset(frameText, asset));
  const scene = explicitScene ?? (mentionedSceneAsset ? bindAsset({ asset_id: mentionedSceneAsset.id, variant_id: chooseBaseVariant(mentionedSceneAsset.id, input.lookup)?.id ?? "" }, "scene", "background", input.lookup) : null);

  const explicitProps = input.shot.props
    .map((ref) => bindAsset(ref, "prop", "supporting", input.lookup))
    .filter((asset): asset is StoryboardBoundAsset => Boolean(asset))
    .filter((asset) => plannerVisibleIds.has(asset.asset_id) || propVisibleInFrame(asset, frameText, isVehicleOrComponentFrame));
  const mentionedProps = Array.from(input.lookup.assetsById.values())
    .filter((asset) => asset.type === "prop" && (plannerVisibleIds.has(asset.id) || textMentionsAsset(frameText, asset)))
    .map((asset) => bindAsset({ asset_id: asset.id, variant_id: chooseBaseVariant(asset.id, input.lookup)?.id ?? "" }, "prop", "supporting", input.lookup))
    .filter((asset): asset is StoryboardBoundAsset => Boolean(asset));
  const fallbackProps =
    explicitProps.length === 0 &&
    mentionedProps.length === 0 &&
    isVehicleOrComponentFrame &&
    !isBodyDetailFrame
      ? input.shot.props
          .map((ref) => bindAsset(ref, "prop", "supporting", input.lookup))
          .filter((asset): asset is StoryboardBoundAsset => Boolean(asset))
          .filter((asset) => VEHICLE_TERMS.test(`${asset.name} ${asset.description}`) && !COMPONENT_TERMS.test(`${asset.name} ${asset.description}`))
          .slice(0, 1)
      : [];
  const props = uniqueBoundAssets([...explicitProps, ...mentionedProps, ...fallbackProps])
    .map((prop) => ({ ...prop, role_in_frame: derivePropRole(prop, frameText, isDetailShot) }))
    .sort((a, b) => scoreProp(b, frameText, isDetailShot) - scoreProp(a, frameText, isDetailShot))
    .slice(0, isDetailShot || isVehicleOrComponentFrame ? 2 : 3);

  const subject = deriveSubject({
    characters: boundCharacters,
    scene,
    props,
    frameText,
    isDetailShot,
    isReactionShot,
  });

  const activeAssets: StoryboardActiveAssets = {
    characters: boundCharacters.map((asset) => ({
      asset_id: asset.asset_id,
      variant_id: asset.variant_id,
      reference_image_url: asset.reference_image_url,
      role_in_frame: asset.role_in_frame === "reaction" ? "reaction" : asset.asset_id === subject.asset_id ? "subject" : "background",
    })),
    scene: scene ? {
      asset_id: scene.asset_id,
      variant_id: scene.variant_id,
      reference_image_url: scene.reference_image_url,
    } : null,
    props: props.map((asset) => ({
      asset_id: asset.asset_id,
      variant_id: asset.variant_id,
      reference_image_url: asset.reference_image_url,
      role_in_frame: asset.asset_id === subject.asset_id ? "subject" : asset.role_in_frame === "background" ? "background" : "supporting",
    })),
  };

  return {
    subject,
    activeAssets,
    bound: {
      characters: boundCharacters,
      scene,
      props,
    },
  };
}

function characterVisibleInFrame(asset: StoryboardBoundAsset, frameText: string, lookup: StoryboardLookup) {
  const source = lookup.assetsById.get(asset.asset_id);
  if (!source) return false;
  return textMentionsAsset(frameText, source);
}

function propVisibleInFrame(asset: StoryboardBoundAsset, frameText: string, isVehicleOrComponentFrame: boolean) {
  if (frameText.includes(asset.name) || frameText.includes(asset.asset_id)) return true;
  const text = `${asset.name} ${asset.description}`;
  const isBroadVehicleAsset = VEHICLE_TERMS.test(text) && !COMPONENT_TERMS.test(text);
  if (isVehicleOrComponentFrame && isBroadVehicleAsset && VEHICLE_TERMS.test(frameText)) return true;
  return false;
}

function uniqueBoundAssets(assets: StoryboardBoundAsset[]) {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.asset_id}:${asset.variant_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function derivePropRole(prop: StoryboardBoundAsset, frameText: string, isDetailShot: boolean): StoryboardAssetRole {
  if (isDetailShot && (frameText.includes(prop.name) || COMPONENT_TERMS.test(`${prop.name} ${prop.description}`))) return "subject";
  if (frameText.includes(prop.name)) return "supporting";
  return "background";
}

function deriveSubject(input: {
  characters: StoryboardBoundAsset[];
  scene: StoryboardBoundAsset | null;
  props: StoryboardBoundAsset[];
  frameText: string;
  isDetailShot: boolean;
  isReactionShot: boolean;
}): StoryboardSubject {
  const subjectProp = input.props.find((prop) => prop.role_in_frame === "subject");
  if (subjectProp) {
    return {
      type: VEHICLE_TERMS.test(`${subjectProp.name} ${subjectProp.description}`) ? "vehicle" : input.isDetailShot ? "detail" : "prop",
      asset_id: subjectProp.asset_id,
      description: `${subjectProp.name} as the main visible subject`,
    };
  }

  const subjectCharacter = input.characters[0];
  if (subjectCharacter) {
    return {
      type: input.isReactionShot ? "reaction" : BODY_DETAIL_TERMS.test(input.frameText) || input.isDetailShot ? "detail" : "character",
      asset_id: subjectCharacter.asset_id,
      description: `${subjectCharacter.name} as the main visible subject`,
    };
  }

  if (input.scene) {
    return {
      type: "environment",
      asset_id: input.scene.asset_id,
      description: `${input.scene.name} as the visible environment subject`,
    };
  }

  return {
    type: "environment",
    asset_id: "",
    description: "",
  };
}

export function activeAssetCount(activeAssets: StoryboardActiveAssets) {
  return activeAssets.characters.length + activeAssets.props.length + (activeAssets.scene ? 1 : 0);
}
