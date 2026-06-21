import { z } from "zod";

export const ProjectSchema = z.object({
  title: z.string().min(1).max(200),
  script: z.string().max(50000).optional().default(""),
});

export const EpisodeSchema = z.object({
  title: z.string().min(1).max(200),
  episodeNumber: z.number().int().positive().optional(),
});

export const ShotSchema = z.object({
  shotNumber: z.number().int().positive().optional(),
  episodeId: z.string().min(1),
});

export const AgentCategoryEnum = z.enum([
  "script_outline", "script_generate", "script_parse",
  "character_extract", "shot_split", "keyframe_prompts",
  "video_prompts", "ref_image_prompts", "ref_video_prompts",
]);

export const AgentSchema = z.object({
  name: z.string().min(1).max(100),
  platform: z.enum(["bailian", "coze"]).optional().default("bailian"),
  category: AgentCategoryEnum,
  appId: z.string().min(1).max(200),
  apiKey: z.string().min(1).max(2000),
  description: z.string().max(1000).optional().default(""),
});



export const GenerateActionSchema = z.enum([
  "script_outline",
  "script_generate",
  "script_parse",
  "character_extract",
  "shot_split",
  "keyframe_prompts",
  "video_prompts",
  "ref_image_prompts",
  "ref_video_prompts",
  "batch_frame_generate",
  "batch_video_generate",
  "batch_scene_frame",
  "batch_ref_image_generate",
  "batch_character_image",
  "generate_keyframe_prompts",
  "single_character_image",
  "single_shot_rewrite",
  "single_frame_generate",
  "single_storyboard_edit",
  "single_video_generate",
  "single_scene_frame",
  "single_reference_video",
  "batch_reference_video",
  "single_video_prompt",
  "batch_video_prompt",
  "ai_optimize_text",
  "video_assemble",
  "single_ref_image_generate",
  "generate_ref_prompts",
  "single_ref_image_generate_all",
]);

export const GenerateRequestSchema = z.object({
  action: GenerateActionSchema,
  episodeId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  modelConfig: z
    .object({
      text: z.unknown().optional(),
      image: z.unknown().optional(),
      video: z.unknown().optional(),
    })
    .optional(),
});

export const UploadScriptSchema = z.object({
  content: z.string().min(1).max(100000),
  title: z.string().max(200).optional(),
});

export const ProviderConfigSchema = z.object({
  protocol: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  secretKey: z.string().optional(),
  modelId: z.string().min(1),
});

export const UploadModelConfigSchema = z.object({
  text: ProviderConfigSchema,
});

export const AgentUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: AgentCategoryEnum.optional(),
  appId: z.string().min(1).max(200).optional(),
  apiKey: z.string().min(1).max(2000).optional(),
  description: z.string().max(1000).optional(),
});

export const ProjectUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  idea: z.string().max(10000).optional(),
  script: z.string().max(50000).optional(),
  outline: z.string().max(50000).optional(),
  status: z.enum(["draft", "processing", "completed"]).optional(),
  generationMode: z.enum(["keyframe", "reference", "4grid"]).optional(),
  useProjectPrompts: z.number().int().min(0).max(1).optional(),
  colorPalette: z.string().max(500).optional(),
  worldSetting: z.string().max(10000).optional(),
  targetDuration: z.number().int().positive().optional(),
  bgmUrl: z.string().max(1000).optional(),
});

export const EpisodeCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  keywords: z.string().max(500).optional(),
});

export const EpisodeUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  keywords: z.string().max(500).optional(),
  idea: z.string().max(10000).optional(),
  script: z.string().max(50000).optional(),
  outline: z.string().max(50000).optional(),
  status: z.enum(["draft", "processing", "completed"]).optional(),
  generationMode: z.enum(["keyframe", "reference", "4grid"]).optional(),
  targetDuration: z.number().int().positive().optional(),
});

export const MergeEpisodesSchema = z.object({
  episodeIds: z.array(z.string().min(1)).min(2),
});

export const ReorderEpisodesSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

export const ModelListSchema = z.object({
  protocol: z.string().min(1),
  capability: z.enum(["text", "image", "video"]).optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
});

export function parseOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(`Validation error: ${first.path.join(".")} ${first.message}`);
  }
  return result.data;
}
