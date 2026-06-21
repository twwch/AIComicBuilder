import { ErrorCodes, makeError, type ComfyUIError } from "./errors";

function basename(p: string): string {
  return p.replace(/[/\\]$/, "").split(/[/\\]/).pop() || p;
}

export interface ModelRef {
  path: string;
  type: "checkpoint" | "lora" | "vae" | "unet" | "clip" | "upscale_model" | "text_encoder";
}

export interface PreflightResult {
  ok: boolean;
  serverReachable: boolean;
  missingNodeTypes: string[];
  missingModels: string[];
  warnings: string[];
  error: ComfyUIError | null;
}

const LOADER_NODE_FOLDERS: Record<string, string> = {
  CheckpointLoaderSimple: "checkpoints",
  UNETLoader: "unet",
  VAELoader: "vae",
  CLIPLoader: "clip",
  CLIPLoaderGGUF: "clip",
  LoraLoaderModelOnly: "loras",
  LatentUpscaleModelLoader: "upscale_models",
  WanVideoModelLoader: "wan",
  WanVideoVAELoader: "vae",
  WanVideoLoraSelect: "loras",
  LTXAVTextEncoderLoader: "text_encoders",
  LTXVAudioVAELoader: "vae",
};

export const WORKFLOW_NODE_REQUIREMENTS: Record<string, string[]> = {
  "ltx-i2v": [
    "CheckpointLoaderSimple", "LTXAVTextEncoderLoader", "LTXVAudioVAELoader",
    "CLIPTextEncode", "LTXVImgToVideoInplace", "LTXVConditioning",
    "SamplerCustomAdvanced", "CFGGuider", "KSamplerSelect", "ManualSigmas",
    "RandomNoise", "EmptyLTXVLatentVideo", "VAEDecodeTiled", "SaveVideo",
    "CreateVideo", "LTXVPreprocess", "LTXVCropGuides",
    "LoraLoaderModelOnly", "LTXVLatentUpsampler", "ResizeImagesByLongerEdge",
    "ResizeImageMaskNode", "ComfyMathExpression", "LTXVConcatAVLatent",
    "LTXVSeparateAVLatent", "LTXVAudioVAEDecode", "LTXVEmptyLatentAudio",
    "LatentUpscaleModelLoader", "LoadImage",
  ],
  "ltx-t2v": [
    "CheckpointLoaderSimple", "LTXAVTextEncoderLoader", "LTXVAudioVAELoader",
    "CLIPTextEncode", "LTXVImgToVideoInplace", "LTXVConditioning",
    "SamplerCustomAdvanced", "CFGGuider", "KSamplerSelect", "ManualSigmas",
    "RandomNoise", "EmptyLTXVLatentVideo", "VAEDecodeTiled", "SaveVideo",
    "CreateVideo", "LTXVPreprocess",
    "LoraLoaderModelOnly", "ComfyMathExpression", "LTXVConcatAVLatent",
    "LTXVSeparateAVLatent", "LTXVAudioVAEDecode", "LTXVEmptyLatentAudio",
    "LoadImage",
  ],
  "ltx-flf2v": [
    "CheckpointLoaderSimple", "LTXAVTextEncoderLoader", "LTXVAudioVAELoader",
    "CLIPTextEncode", "LTXVImgToVideoInplace", "LTXVConditioning",
    "SamplerCustomAdvanced", "CFGGuider", "KSamplerSelect", "ManualSigmas",
    "RandomNoise", "EmptyLTXVLatentVideo", "VAEDecodeTiled", "SaveVideo",
    "CreateVideo", "LTXVPreprocess",
    "LoraLoaderModelOnly", "ComfyMathExpression", "LTXVConcatAVLatent",
    "LTXVSeparateAVLatent", "LTXVAudioVAEDecode", "LTXVEmptyLatentAudio",
    "LoadImage", "GetImageSize",
  ],
  "ltx-4grid": [
    "CheckpointLoaderSimple", "LTXAVTextEncoderLoader", "LTXVAudioVAELoader",
    "CLIPTextEncode", "LTXVImgToVideoInplace", "LTXVConditioning",
    "SamplerCustomAdvanced", "CFGGuider", "KSamplerSelect", "ManualSigmas",
    "RandomNoise", "EmptyLTXVLatentVideo", "VAEDecodeTiled", "SaveVideo",
    "CreateVideo", "LTXVPreprocess", "LTXVCropGuides",
    "LoraLoaderModelOnly", "ResizeImagesByLongerEdge",
    "ResizeImageMaskNode", "ComfyMathExpression", "LTXVConcatAVLatent",
    "LTXVSeparateAVLatent", "LTXVAudioVAEDecode", "LTXVEmptyLatentAudio",
    "LoadImage", "PromptRelayEncodeTimeline", "LTXVAddGuideMulti",
    "NAGuidance", "PrimitiveStringMultiline",
  ],
  "ltx-i2v-pro": [
    "CheckpointLoaderSimple", "LTXAVTextEncoderLoader", "LTXVAudioVAELoader",
    "CLIPTextEncode", "LTXVImgToVideoInplace", "LTXVConditioning",
    "SamplerCustomAdvanced", "CFGGuider", "KSamplerSelect", "ManualSigmas",
    "RandomNoise", "EmptyLTXVLatentVideo", "VAEDecodeTiled", "SaveVideo",
    "CreateVideo", "LTXVPreprocess", "LTXVCropGuides",
    "LoraLoaderModelOnly", "LTXVLatentUpsampler", "ResizeImagesByLongerEdge",
    "ResizeImageMaskNode", "ComfyMathExpression", "LTXVConcatAVLatent",
    "LTXVSeparateAVLatent", "LTXVAudioVAEDecode", "LTXVEmptyLatentAudio",
    "LatentUpscaleModelLoader", "LoadImage", "NAGuidance",
  ],
  "wan-i2v": [
    "WanVideoModelLoader", "WanVideoSampler", "WanVideoDecode",
    "WanVideoVAELoader", "WanVideoLoraSelect", "WanVideoImageToVideoEncode",
    "WanVideoTextEmbedBridge", "CLIPLoaderGGUF", "CLIPTextEncode",
    "VHS_VideoCombine", "LoadImage", "ImageResizeKJv2",
    "GetImageSizeAndCount", "INTConstant", "CreateCFGScheduleFloatList",
    "easy cleanGpuUsed",
  ],
  "z-image-turbo-comfyui": [
    "SaveImage", "CLIPLoader", "VAELoader", "UNETLoader",
    "EmptySD3LatentImage", "CLIPTextEncode", "ModelSamplingAuraFlow",
    "ConditioningZeroOut", "KSampler", "VAEDecode",
  ],
  "qwen-edit-dual": [
    "TextEncodeQwenImageEditPlus", "VAEDecode", "KSampler",
    "LoadImage", "ImageScaleToTotalPixels", "SaveImage",
    "CheckpointLoaderSimple", "LoraLoaderModelOnly", "CLIPLoader",
    "GetImageSize", "ZML_PresetResolutionV2", "easy cleanGpuUsed",
  ],
  "ideogram4-comfyui": [
    "SaveImage", "CLIPLoader", "VAELoader", "UNETLoader",
    "CLIPTextEncode", "VAEDecode", "EmptyFlux2LatentImage",
    "RandomNoise", "KSamplerSelect", "SamplerCustomAdvanced",
    "CFGOverride", "DualModelGuider", "Ideogram4Scheduler",
    "ComfyMathExpression", "ComfyNumberConvert",
    "ResolutionSelector", "ConditioningZeroOut",
    "StringConcatenate", "StringReplace",
    "PrimitiveInt", "PrimitiveStringMultiline",
    "JsonExtractString", "CustomCombo",
    "MarkdownNote", "TextGenerate", "PreviewAny",
  ],
  "hidream-o1-comfyui": [
    "SaveImage", "CheckpointLoaderSimple", "CLIPTextEncode",
    "VAEDecode", "SamplerCustom", "BasicScheduler",
    "ModelNoiseScale", "KSamplerSelect", "EmptyHiDreamO1LatentImage",
    "HiDreamO1PatchSeamSmoothing",
  ],
  "hidream-o1-comfyui-ref": [
    "HiDreamO1ReferenceImages", "ComfySwitchNode", "PrimitiveBoolean",
    "LoadImage",
  ],
  "ernie-image-comfyui": [
    "SaveImage", "UNETLoader", "VAELoader", "CLIPLoader",
    "EmptyFlux2LatentImage", "CLIPTextEncode", "KSampler",
    "VAEDecode", "RandomNoise", "KSamplerSelect",
  ],
};

async function fetchJson(
  url: string,
  authHeaders: Record<string, string>,
  signal?: AbortSignal,
): Promise<[unknown, string | null]> {
  try {
    const res = await fetch(url, { headers: { ...authHeaders, Accept: "application/json" }, signal });
    if (!res.ok) return [null, `HTTP ${res.status}: ${res.statusText}`];
    return [await res.json(), null];
  } catch (err) {
    return [null, err instanceof Error ? err.message : String(err)];
  }
}

export async function checkComfyUIServer(
  serverUrl: string,
  authHeaders: Record<string, string> = {},
  timeoutMs = 5000,
): Promise<{ reachable: boolean; objectInfo: Record<string, unknown> | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const [data, err] = await fetchJson(`${serverUrl}/object_info`, authHeaders, controller.signal);
    if (err) return { reachable: false, objectInfo: null, error: err };
    return { reachable: true, objectInfo: data as Record<string, unknown>, error: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkComfyUIModels(
  serverUrl: string,
  requiredModels: ModelRef[],
  authHeaders: Record<string, string> = {},
  timeoutMs = 10000,
): Promise<string[]> {
  if (requiredModels.length === 0) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const [folders, foldersErr] = await fetchJson(`${serverUrl}/models`, authHeaders, controller.signal);
    if (foldersErr || !Array.isArray(folders)) return requiredModels.map((m) => m.path);

    const folderSet = new Set(folders as string[]);
    const modelIndex = new Map<string, Set<string>>();
    for (const folder of folders as string[]) {
      const [files, filesErr] = await fetchJson(
        `${serverUrl}/models/${encodeURIComponent(folder)}`,
        authHeaders,
        controller.signal,
      );
      if (!filesErr && Array.isArray(files)) {
        modelIndex.set(folder, new Set(files as string[]));
      }
    }

    const missing: string[] = [];
    for (const model of requiredModels) {
      const folder = LOADER_NODE_FOLDERS[model.type] || "";
      const modelFiles = modelIndex.get(folder);
      const modelName = basename(model.path);
      if (!modelFiles || !modelFiles.has(modelName)) {
        missing.push(model.path);
      }
    }
    return missing;
  } finally {
    clearTimeout(timer);
  }
}

export async function preflightWorkflow(
  serverUrl: string,
  workflowFamily: string,
  requiredModels: ModelRef[],
  authHeaders: Record<string, string> = {},
  extraNodeTypes?: string[],
): Promise<PreflightResult> {
  const result: PreflightResult = {
    ok: false,
    serverReachable: false,
    missingNodeTypes: [],
    missingModels: [],
    warnings: [],
    error: null,
  };

  const { reachable, objectInfo, error } = await checkComfyUIServer(serverUrl, authHeaders);
  if (!reachable || !objectInfo) {
    result.serverReachable = false;
    result.error = makeError(
      ErrorCodes.SERVER_UNAVAILABLE,
      `ComfyUI server at ${serverUrl} is unreachable: ${error}`,
    );
    return result;
  }
  result.serverReachable = true;

  const familyNodeTypes = WORKFLOW_NODE_REQUIREMENTS[workflowFamily] || [];
  const requiredNodeTypes = extraNodeTypes
    ? [...familyNodeTypes, ...extraNodeTypes]
    : familyNodeTypes;
  if (requiredNodeTypes.length > 0) {
    const registeredTypes = new Set(Object.keys(objectInfo));
    const missingNodeTypes = requiredNodeTypes.filter((t) => !registeredTypes.has(t));
    result.missingNodeTypes = missingNodeTypes;
    if (missingNodeTypes.length > 0) {
      result.error = makeError(
        ErrorCodes.MISSING_NODE_TYPES,
        `Missing ComfyUI node types (${workflowFamily}): ${missingNodeTypes.join(", ")}. Install required custom nodes.`,
      );
    }
  }

  if (requiredModels.length > 0) {
    const missingModels = await checkComfyUIModels(serverUrl, requiredModels, authHeaders);
    result.missingModels = missingModels;
    if (missingModels.length > 0) {
      const modelError = makeError(
        ErrorCodes.MISSING_MODELS,
        `Missing ComfyUI model files (${workflowFamily}): ${missingModels.join(", ")}`,
      );
      if (result.error) {
        result.warnings.push(modelError.message);
      } else {
        result.error = modelError;
      }
    }
  }

  result.ok = !result.error;
  return result;
}
