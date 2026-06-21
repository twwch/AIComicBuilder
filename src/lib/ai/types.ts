export interface TextOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  images?: string[];  // local file paths for vision input
}

export type WorkflowFamily = "z-image-turbo-comfyui" | "ideogram4-comfyui" | "qwen-edit-dual" | "hidream-o1-comfyui" | "ernie-image-comfyui";

export interface ImageOptions {
  model?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  /** Optional base image for edit-style models. */
  editBaseImage?: string;
  referenceImages?: string[];
  /** Labels for reference images, e.g. character names. Must match referenceImages order. */
  referenceLabels?: string[];
  /** Semantic roles for references, e.g. character/costume/scene/pose. */
  referenceRoles?: string[];
  /** Explicit workflow selection for multi-workflow providers like ComfyUI. */
  workflowFamily?: WorkflowFamily;
  /** Optional negative prompt for providers/workflows that support it. */
  negativePrompt?: string;
}

export interface AIProvider {
  generateText(prompt: string, options?: TextOptions): Promise<string>;
  generateImage(prompt: string, options?: ImageOptions): Promise<string>;
}

// Keyframe mode: both firstFrame and lastFrame must be provided
type KeyframeVideoParams = {
  firstFrame: string;
  lastFrame: string;
  initialImage?: never;
};

// Reference image mode: a single initial image (local path or http URL)
type ReferenceVideoParams = {
  firstFrame?: never;
  lastFrame?: never;
  initialImage: string;
};

export type SigmaPreset = "speed" | "balanced" | "quality" | "quality_lite";

export type CameraControl =
  | "dolly-in" | "dolly-out"
  | "dolly-left" | "dolly-right"
  | "pan-left" | "pan-right"
  | "tilt-up" | "tilt-down"
  | "zoom-in" | "zoom-out"
  | "jib-up" | "jib-down"
  | "roll-ccw" | "roll-cw"
  | "orbit-ccw" | "orbit-cw"
  | "static";

export type VideoGenerateParams = (KeyframeVideoParams | ReferenceVideoParams) & {
  prompt: string;
  duration: number;
  ratio: string;
  /** Character/style reference images for consistency (e.g. Veo 3.1 referenceImages) */
  referenceImages?: string[];
  /** LTX sigma schedule preset: speed (fewer steps), balanced (default), quality (more steps) */
  sigmaPreset?: SigmaPreset;
  /** LTX camera control LoRA type (requires LoRA file on disk) */
  cameraControl?: CameraControl;
};

export interface VideoGenerateResult {
  filePath: string;
  lastFrameUrl?: string;
}

export interface VideoProvider {
  generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult>;
}
