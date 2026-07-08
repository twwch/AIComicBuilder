import { generateText } from "ai";
import {
  createLanguageModel,
  extractJSON,
  resolveLanguageModelConfigs,
  supportsOpenAIJsonMode,
  type ProviderConfig,
} from "@/lib/ai/ai-sdk";
import type {
  StoryboardAssetInput,
  StoryboardAssetVariantInput,
  StoryboardProductionBibleInput,
  StoryboardVisualAssetInput,
} from "./types";
import { emptyPlanOutput, type StoryboardFramePlanAgentOutput } from "./storyboard-frame-plan-schema";
import { compactText, sanitizePromptText, toRecord } from "./prompt-sanitizer";

export interface StoryboardFramePlannerAgentInput {
  episode_id: string;
  scene_id: string;
  scene_summary?: string;
  locked_shots: unknown[];
  assets: StoryboardAssetInput[];
  assetVariants?: StoryboardAssetVariantInput[];
  visualAssets?: StoryboardVisualAssetInput[];
  productionBible?: StoryboardProductionBibleInput | null;
  modelConfig?: { text?: ProviderConfig | null } | null;
}

export interface StoryboardFramePlannerAgentResult {
  output: StoryboardFramePlanAgentOutput;
  agent_used: true;
  model: {
    protocol: string;
    modelId: string;
  };
  raw_text: string;
}

const SYSTEM_PROMPT = `You are a storyboard frame planning agent for an industrial short-drama generation pipeline.

You ONLY output JSON. You do not write final image prompts.

Your job:
- Read locked shots for ONE scene only.
- Split continuous scene action into multiple storyboard key frames.
- Each frame must be one static still image moment.
- Soften unsafe violence into non-graphic static visuals.
- Select only visible active assets for each frame by asset_id.

Forbidden in frame descriptions:
- sound effects
- dialogue/subtitles
- duration
- video motion process
- multiple sequential events
- explicit gore or graphic injury

Output JSON shape:
{
  "episode_id": "",
  "scene_id": "",
  "frames": [
    {
      "frame_id": "",
      "shot_id": "",
      "scene_id": "",
      "episode_id": "",
      "subject": { "type": "character|prop|environment|vehicle|detail|reaction", "asset_id": "", "description": "" },
      "static_frame_description": "",
      "composition": "",
      "camera": { "shot_type": "", "angle": "", "framing": "" },
      "active_assets": {
        "characters": [{ "asset_id": "", "variant_id": "", "role_in_frame": "subject|background|reaction" }],
        "scene": { "asset_id": "", "variant_id": "", "role_in_frame": "background" },
        "props": [{ "asset_id": "", "variant_id": "", "role_in_frame": "subject|supporting|background" }]
      },
      "safety_notes": "",
      "source_shot_ids": []
    }
  ]
}`;

export async function planStoryboardFramesWithAgent(
  input: StoryboardFramePlannerAgentInput,
): Promise<StoryboardFramePlannerAgentResult> {
  const configs = resolveLanguageModelConfigs(input.modelConfig?.text);
  if (configs.length === 0) throw new Error("No text model configured for storyboard frame planning");

  const prompt = buildPlannerPrompt(input);
  const errors: string[] = [];
  for (const config of configs) {
    try {
      const result = await generateText({
        model: createLanguageModel(config),
        system: SYSTEM_PROMPT,
        prompt,
        providerOptions: supportsOpenAIJsonMode(config)
          ? { openai: { response_format: { type: "json_object" as const } } }
          : undefined,
        temperature: 0.1,
        maxRetries: 1,
      });
      return {
        output: parsePlannerOutput(result.text, input),
        agent_used: true,
        model: {
          protocol: config.protocol,
          modelId: config.modelId,
        },
        raw_text: result.text,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`Storyboard frame planner failed: ${errors.at(-1) || "unknown error"}`);
}

function parsePlannerOutput(text: string, input: StoryboardFramePlannerAgentInput): StoryboardFramePlanAgentOutput {
  const json = extractJSON(text);
  const parsed = JSON.parse(json) as Partial<StoryboardFramePlanAgentOutput>;
  const output = {
    ...emptyPlanOutput(input.episode_id, input.scene_id),
    ...parsed,
    episode_id: String(parsed.episode_id || input.episode_id),
    scene_id: String(parsed.scene_id || input.scene_id),
    frames: Array.isArray(parsed.frames) ? parsed.frames : [],
  };
  return output;
}

function buildPlannerPrompt(input: StoryboardFramePlannerAgentInput) {
  return [
    "Plan storyboard key frames for this ONE scene.",
    "",
    "Hard rules:",
    "- Output JSON only.",
    "- Do not create final positive_prompt or negative_prompt.",
    "- Each frame is one static still image.",
    "- Split long scene text into multiple frames when multiple visual beats exist.",
    "- Use only asset_id values from available assets.",
    "- Do not include mentioned-only assets if they are not visible in the frame.",
    "- Keep dialogue, sound, duration, and voiceover out of static_frame_description.",
    "- For violent/high-risk actions, choose pre-impact, aftermath, subjective blur, or restrained detail frames.",
    "",
    "Scene:",
    JSON.stringify({
      episode_id: input.episode_id,
      scene_id: input.scene_id,
      scene_summary: sanitizePromptText(input.scene_summary || ""),
    }, null, 2),
    "",
    "Production bible:",
    JSON.stringify(compactProductionBible(input.productionBible), null, 2),
    "",
    "Available assets:",
    JSON.stringify({
      characters: input.assets.filter((asset) => asset.type === "character").map(assetForPrompt),
      scenes: input.assets.filter((asset) => asset.type === "scene").map(assetForPrompt),
      props: input.assets.filter((asset) => asset.type === "prop").map(assetForPrompt),
    }, null, 2),
    "",
    "Available variants:",
    JSON.stringify((input.assetVariants ?? []).map((variant) => ({
      id: variant.id,
      assetId: variant.assetId,
      name: variant.name,
      state: compactText(variant.state || variant.visualConstraints || "", 120),
      has_reference_image: Boolean(variant.referenceImage),
    })), null, 2),
    "",
    "Locked shots in this scene:",
    JSON.stringify(input.locked_shots.map(shotForPrompt), null, 2),
  ].join("\n");
}

function compactProductionBible(bible?: StoryboardProductionBibleInput | null) {
  if (!bible) return {};
  return {
    title: bible.title,
    worldSetting: compactText(bible.worldSetting || "", 300),
    visualStyle: compactText(bible.visualStyle || "", 220),
    eraConstraints: compactText(bible.eraConstraints || "", 220),
    locationRules: compactText(bible.locationRules || "", 220),
    sceneRules: compactText(bible.sceneRules || "", 220),
    propRules: compactText(bible.propRules || "", 220),
    complianceRules: compactText(bible.complianceRules || "", 220),
    metadata: bible.metadata,
  };
}

function assetForPrompt(asset: StoryboardAssetInput) {
  return {
    id: asset.id,
    type: asset.type,
    name: asset.name,
    aliases: asset.aliases ?? [],
    description: compactText(asset.description || asset.visualConstraints || "", 180),
    has_reference_image: Boolean(asset.referenceImage),
  };
}

function shotForPrompt(value: unknown) {
  const record = toRecord(value);
  return {
    shot_id: String(record.shot_id || record.shotId || record.id || ""),
    scene_id: String(record.scene_id || record.sceneId || ""),
    episode_id: String(record.episode_id || record.episodeId || ""),
    shot_type: String(record.shot_type || record.shotType || ""),
    frame_description: compactText(record.frame_description || record.frameDescription || record.prompt || record.videoPrompt || "", 700),
    action: compactText(record.action || record.motionScript || "", 360),
    camera: record.camera || {
      shot_type: record.shotType || record.shot_type || "",
      angle: record.camera_angle || "",
      framing: record.composition || record.compositionGuide || "",
    },
    characters: record.characters || record.character_asset_ids || record.characterAssetIds || [],
    scene_asset: record.scene_asset || record.sceneAsset || record.scene_asset_id || record.sceneAssetId || null,
    props: record.props || record.prop_asset_ids || record.propAssetIds || [],
    dialogue: compactText(record.dialogue || record.dialogue_text || "", 180),
    sound_effect: compactText(record.sound_effect || record.soundDesign || "", 120),
    duration: String(record.duration || ""),
  };
}
