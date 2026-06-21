import type { ModelConfig } from "@/lib/generate-utils";
import { handleScriptOutlineAction, handleScriptGenerate, handleScriptParseStream } from "./script";
import { handleCharacterExtract, handleSingleCharacterImage, handleBatchCharacterImage } from "./character";
import { handleShotSplitStream, handleSingleShotRewrite, handleResetStuckShots } from "./shots";
import { handleBatchFrameGenerate, handleSingleFrameGenerate, handleSingleStoryboardEdit, handleSingleSceneFrame, handleBatchSceneFrame } from "./frames";
import { handleSingleVideoGenerate, handleBatchVideoGenerate } from "./video-keyframe";
import { handleSingleReferenceVideo, handleBatchReferenceVideo } from "./video-reference";
import { handleVideoAssembleSync } from "./video-assemble";
import { handleSingleVideoPrompt, handleBatchVideoPrompt } from "./video-prompt";
import { handleAiOptimizeText } from "./ai-optimize";
import { handleSingleRefImageGenerate, handleBatchRefImageGenerate, handleGenerateRefPrompts, handleSingleShotRefImageGenerateAll } from "./ref-image";
import { handleGenerateKeyframePrompts } from "./keyframe";

type HandlerFn = (
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
) => Promise<Response>;

const handlerMap: Record<string, HandlerFn> = {
  script_outline: handleScriptOutlineAction,
  script_generate: handleScriptGenerate,
  script_parse: handleScriptParseStream,
  character_extract: handleCharacterExtract,
  single_character_image: handleSingleCharacterImage,
  batch_character_image: handleBatchCharacterImage,
  shot_split: handleShotSplitStream,
  generate_keyframe_prompts: handleGenerateKeyframePrompts,
  single_shot_rewrite: handleSingleShotRewrite,
  reset_stuck_shots: handleResetStuckShots,
  batch_frame_generate: handleBatchFrameGenerate,
  single_frame_generate: handleSingleFrameGenerate,
  single_storyboard_edit: handleSingleStoryboardEdit,
  single_video_generate: handleSingleVideoGenerate,
  batch_video_generate: handleBatchVideoGenerate,
  single_scene_frame: handleSingleSceneFrame,
  batch_scene_frame: handleBatchSceneFrame,
  single_reference_video: handleSingleReferenceVideo,
  batch_reference_video: handleBatchReferenceVideo,
  single_video_prompt: handleSingleVideoPrompt,
  batch_video_prompt: handleBatchVideoPrompt,
  ai_optimize_text: handleAiOptimizeText,
  video_assemble: handleVideoAssembleSync,
  batch_ref_image_generate: handleBatchRefImageGenerate,
  single_ref_image_generate: handleSingleRefImageGenerate,
  generate_ref_prompts: handleGenerateRefPrompts,
  single_ref_image_generate_all: handleSingleShotRefImageGenerateAll,
};

export function dispatchAction(
  action: string,
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
): Promise<Response> | null {
  const handler = handlerMap[action];
  return handler ? handler(projectId, userId, payload, modelConfig, episodeId, taskId) : null;
}
