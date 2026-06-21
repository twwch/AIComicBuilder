import type { SigmaPreset, CameraControl } from "../types";

const NEGATIVE_PROMPT = "pc game, console game, video game, cartoon, childish, ugly, nsfw, 文字，水印，字幕，text, subtitles, captions, burned-in text, overlay text, watermark, logo, signature, numbers, letters, blurry text, garbage characters, unreadable symbols";

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

const SIGMA_PRESETS: Record<SigmaPreset, { main: string; refiner: string }> = {
  speed: {
    main: "1.0, 0.725, 0.421875, 0.0",
    refiner: "0.85, 0.4219, 0.0",
  },
  balanced: {
    main: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0",
    refiner: "0.85, 0.7250, 0.4219, 0.0",
  },
  quality: {
    main: "1.0, 0.996875, 0.99375, 0.990625, 0.9875, 0.984375, 0.98125, 0.978125, 0.975, 0.9375, 0.909375, 0.84375, 0.725, 0.574219, 0.421875, 0.253906, 0.0",
    refiner: "0.85, 0.75, 0.574219, 0.4219, 0.253906, 0.0",
  },
  quality_lite: {
    main: "1.0, 0.996875, 0.99375, 0.9875, 0.98125, 0.975, 0.9375, 0.909375, 0.84375, 0.725, 0.574219, 0.421875, 0.0",
    refiner: "0.85, 0.7250, 0.574219, 0.4219, 0.0",
  },
};

export function getSigmaSchedules(preset?: SigmaPreset): { main: string; refiner: string } {
  return SIGMA_PRESETS[preset ?? "balanced"];
}

const CAMERA_LORA_MAP: Record<CameraControl, string> = {
  "dolly-in": "ltx-2-19b-lora-camera-control-dolly-in.safetensors",
  "dolly-out": "ltx-2-19b-lora-camera-control-dolly-out.safetensors",
  "dolly-left": "ltx-2-19b-lora-camera-control-dolly-left.safetensors",
  "dolly-right": "ltx-2-19b-lora-camera-control-dolly-right.safetensors",
  "pan-left": "ltx-2-19b-lora-camera-control-pan-left.safetensors",
  "pan-right": "ltx-2-19b-lora-camera-control-pan-right.safetensors",
  "tilt-up": "ltx-2-19b-lora-camera-control-tilt-up.safetensors",
  "tilt-down": "ltx-2-19b-lora-camera-control-tilt-down.safetensors",
  "zoom-in": "ltx-2-19b-lora-camera-control-zoom-in.safetensors",
  "zoom-out": "ltx-2-19b-lora-camera-control-zoom-out.safetensors",
  "jib-up": "ltx-2-19b-lora-camera-control-jib-up.safetensors",
  "jib-down": "ltx-2-19b-lora-camera-control-jib-down.safetensors",
  "roll-ccw": "ltx-2-19b-lora-camera-control-roll-ccw.safetensors",
  "roll-cw": "ltx-2-19b-lora-camera-control-roll-cw.safetensors",
  "orbit-ccw": "ltx-2-19b-lora-camera-control-orbit-ccw.safetensors",
  "orbit-cw": "ltx-2-19b-lora-camera-control-orbit-cw.safetensors",
  static: "ltx-2-19b-lora-camera-control-static.safetensors",
};

export function getCameraLoRAName(control?: CameraControl): string | undefined {
  if (!control) return undefined;
  return CAMERA_LORA_MAP[control];
}

function addCameraLoRANode(
  workflow: Record<string, unknown>,
  modelNodeId: string,
  cameraLoraName: string,
  cameraNodeId: string,
  downstreamNodeIds: string[],
): void {
  const cameraNode = {
    class_type: "LoraLoaderModelOnly",
    inputs: {
      lora_name: cameraLoraName,
      strength_model: 0.5,
      model: [modelNodeId, 0],
    },
  };
  workflow[cameraNodeId] = cameraNode;

  for (const nodeId of downstreamNodeIds) {
    const node = workflow[nodeId] as { inputs: Record<string, unknown> } | undefined;
    if (node) {
      node.inputs.model = [cameraNodeId, 0];
    }
  }
}

/**
 * Build LTX Video 2.3 image-to-video or text-to-video workflow.
 * When imagePath is provided → i2v mode (uses uploaded image).
 * When imagePath is null → t2v mode (uses empty image placeholder + switch).
 */
function getDimensions(ratio?: string): [number, number] {
  if (ratio === "9:16" || ratio === "portrait") return [720, 1280];
  return [1280, 720]; // default 16:9 landscape
}

export function buildLTXi2vT2vWorkflow(
  prompt: string,
  durationSec: number,
  fps: number,
  outputPrefix: string,
  imagePath?: string,
  ratio?: string,
  sigmaPreset?: SigmaPreset,
  cameraControl?: CameraControl,
): Record<string, unknown> {
  const seed = randomSeed();
  const isT2v = !imagePath;
  const [width, height] = getDimensions(ratio);
  const sigmas = getSigmaSchedules(sigmaPreset);
  const cameraLoraName = getCameraLoRAName(cameraControl);

  const workflow: Record<string, unknown> = {
    "75": {
      class_type: "SaveVideo",
      inputs: {
        filename_prefix: outputPrefix,
        format: "auto",
        codec: "auto",
        "video-preview": "",
        video: ["320:310", 0],
      },
    },
    "320:276": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed + 1 },
    },
    "320:277": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "320:278": {
      class_type: "LTXVConcatAVLatent",
      inputs: {
        video_latent: ["320:288", 0],
        audio_latent: ["320:307", 1],
      },
    },
    "320:279": {
      class_type: "LTXVAudioVAELoader",
      inputs: { ckpt_name: "LTX2.3\\ltx-2.3-22b-dev-fp8.safetensors" },
    },
    "320:280": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "euler_cfg_pp" },
    },
    "320:281": {
      class_type: "ManualSigmas",
      inputs: { sigmas: sigmas.refiner },
    },
    "320:282": {
      class_type: "CFGGuider",
      inputs: {
        cfg: 1,
        model: ["320:329", 0],
        positive: ["320:284", 0],
        negative: ["320:284", 1],
      },
    },
    "320:283": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["320:277", 0],
        guider: ["320:314", 0],
        sampler: ["320:291", 0],
        sigmas: ["320:306", 0],
        latent_image: ["320:318", 0],
      },
    },
    "320:284": {
      class_type: "LTXVCropGuides",
      inputs: {
        positive: ["320:304", 0],
        negative: ["320:304", 1],
        latent: ["320:307", 0],
      },
    },
    "320:285": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        lora_name: "ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
        strength_model: 0.5,
        model: ["320:328", 0],
      },
    },
    "320:326": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        lora_name: "Singularity-LTX-2.3_OmniCine_V1.safetensors",
        strength_model: 1.0,
        model: ["320:316", 0],
      },
    },
    "320:327": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        lora_name: "ltx2.3-ic-subtitles-remove-general.safetensors",
        strength_model: 1.0,
        model: ["320:326", 0],
      },
    },
    "320:328": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        lora_name: "ltx2.3-video-restoration-general.safetensors",
        strength_model: 1.0,
        model: ["320:327", 0],
      },
    },
    "320:329": {
      class_type: "NAGuidance",
      inputs: {
        nag_scale: 5,
        nag_alpha: 0.5,
        nag_tau: 1.5,
        model: ["320:285", 0],
      },
    },
    "320:286": {
      class_type: "ResizeImagesByLongerEdge",
      inputs: {
        longer_edge: 1536,
        images: ["320:290", 0],
      },
    },
    "320:287": {
      class_type: "LTXVLatentUpsampler",
      inputs: {
        samples: ["320:307", 0],
        upscale_model: ["320:311", 0],
        vae: ["320:316", 2],
      },
    },
    "320:288": {
      class_type: "LTXVImgToVideoInplace",
      inputs: {
        strength: 1,
        bypass: isT2v,
        vae: ["320:316", 2],
        image: ["320:289", 0],
        latent: ["320:287", 0],
      },
    },
    "320:289": {
      class_type: "LTXVPreprocess",
      inputs: {
        img_compression: 18,
        image: ["320:286", 0],
      },
    },
    "320:290": {
      class_type: "ResizeImageMaskNode",
      inputs: {
        resize_type: "scale dimensions",
        "resize_type.width": ["320:312", 0],
        "resize_type.height": ["320:299", 0],
        "resize_type.crop": "center",
        scale_method: "lanczos",
        input: isT2v ? ["320:325", 0] : ["269", 0],
      },
    },
    "320:291": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "euler_ancestral_cfg_pp" },
    },
    "320:292": {
      class_type: "ComfyMathExpression",
      inputs: {
        expression: "a/2",
        "values.a": ["320:312", 0],
      },
    },
    "320:294": {
      class_type: "ComfyMathExpression",
      inputs: {
        expression: "a/2",
        "values.a": ["320:299", 0],
      },
    },
    "320:295": {
      class_type: "EmptyLTXVLatentVideo",
      inputs: {
        width: ["320:292", 1],
        height: ["320:294", 1],
        length: ["320:323", 1],
        batch_size: 1,
      },
    },
    "320:296": {
      class_type: "LTXVImgToVideoInplace",
      inputs: {
        strength: 0.7,
        bypass: isT2v,
        vae: ["320:316", 2],
        image: ["320:289", 0],
        latent: ["320:295", 0],
      },
    },
    "320:297": {
      class_type: "LTXVAudioVAEDecode",
      inputs: {
        samples: ["320:309", 1],
        audio_vae: ["320:279", 0],
      },
    },
    "320:298": {
      class_type: "ComfyMathExpression",
      inputs: {
        expression: "a",
        "values.a": ["320:300", 0],
      },
    },
    "320:299": { class_type: "PrimitiveInt", inputs: { value: height } },
    "320:300": { class_type: "PrimitiveInt", inputs: { value: fps } },
    "320:301": { class_type: "PrimitiveInt", inputs: { value: durationSec } },
    "320:302": {
      class_type: "PrimitiveBoolean",
      inputs: { value: isT2v },
    },
    "320:303": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: ["320:319", 0],
        clip: ["320:317", 0],
      },
    },
    "320:304": {
      class_type: "LTXVConditioning",
      inputs: {
        frame_rate: ["320:298", 0],
        positive: ["320:303", 0],
        negative: ["320:313", 0],
      },
    },
    "320:305": {
      class_type: "LTXVEmptyLatentAudio",
      inputs: {
        frames_number: ["320:323", 1],
        frame_rate: ["320:298", 1],
        batch_size: 1,
        audio_vae: ["320:279", 0],
      },
    },
    "320:306": {
      class_type: "ManualSigmas",
      inputs: { sigmas: sigmas.main },
    },
    "320:307": {
      class_type: "LTXVSeparateAVLatent",
      inputs: { av_latent: ["320:283", 0] },
    },
    "320:308": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["320:276", 0],
        guider: ["320:282", 0],
        sampler: ["320:280", 0],
        sigmas: ["320:281", 0],
        latent_image: ["320:278", 0],
      },
    },
    "320:309": {
      class_type: "LTXVSeparateAVLatent",
      inputs: { av_latent: ["320:308", 0] },
    },
    "320:310": {
      class_type: "CreateVideo",
      inputs: {
        fps: ["320:298", 0],
        images: ["320:315", 0],
        audio: ["320:297", 0],
      },
    },
    "320:311": {
      class_type: "LatentUpscaleModelLoader",
      inputs: { model_name: "ltx-2.3-spatial-upscaler-x2-1.0.safetensors" },
    },
    "320:312": { class_type: "PrimitiveInt", inputs: { value: width } },
    "320:313": {
      class_type: "CLIPTextEncode",
      inputs: { text: NEGATIVE_PROMPT, clip: ["320:317", 0] },
    },
    "320:314": {
      class_type: "CFGGuider",
      inputs: {
        cfg: 1,
        model: ["320:329", 0],
        positive: ["320:304", 0],
        negative: ["320:304", 1],
      },
    },
    "320:315": {
      class_type: "VAEDecodeTiled",
      inputs: {
        tile_size: 768,
        overlap: 64,
        temporal_size: 4096,
        temporal_overlap: 4,
        samples: ["320:309", 0],
        vae: ["320:316", 2],
      },
    },
    "320:316": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "LTX2.3\\ltx-2.3-22b-dev-fp8.safetensors" },
    },
    "320:317": {
      class_type: "LTXAVTextEncoderLoader",
      inputs: {
        text_encoder: "gemma_3_12B_it_fp4_mixed.safetensors",
        ckpt_name: "LTX2.3\\ltx-2.3-22b-dev-fp8.safetensors",
        device: "default",
      },
    },
    "320:318": {
      class_type: "LTXVConcatAVLatent",
      inputs: {
        video_latent: ["320:296", 0],
        audio_latent: ["320:305", 0],
      },
    },
    "320:319": {
      class_type: "PrimitiveStringMultiline",
      inputs: { value: prompt },
    },
    "320:323": {
      class_type: "ComfyMathExpression",
      inputs: {
        expression: "a * b + 1",
        "values.a": ["320:301", 0],
        "values.b": ["320:300", 0],
      },
    },
  };

  if (cameraLoraName) {
    addCameraLoRANode(workflow, "320:285", cameraLoraName, "320:333", ["320:329"]);
  }

  if (isT2v) {
    workflow["320:325"] = {
      class_type: "EmptyImage",
      inputs: { width: 512, height: 512, batch_size: 1, color: 0 },
    };
  } else {
    workflow["269"] = {
      class_type: "LoadImage",
      inputs: { image: imagePath },
    };
  }

  return workflow;
}

/**
 * Build LTX Video 2.3 first-frame/last-frame workflow.
 */
export function buildLTXFlf2vWorkflow(
  prompt: string,
  firstFrame: string,
  lastFrame: string,
  durationSec: number,
  fps: number,
  outputPrefix: string,
  sigmaPreset?: SigmaPreset,
  cameraControl?: CameraControl,
): Record<string, unknown> {
  const seed = randomSeed();
  const width = 720;
  const height = 1280;
  const sigmas = getSigmaSchedules(sigmaPreset);
  const cameraLoraName = getCameraLoRAName(cameraControl);

  const workflow: Record<string, unknown> = {
    "31": {
      class_type: "LoadImage",
      inputs: { image: firstFrame },
    },
    "39": {
      class_type: "LoadImage",
      inputs: { image: lastFrame },
    },
    "68": {
      class_type: "SaveVideo",
      inputs: {
        filename_prefix: outputPrefix,
        format: "auto",
        codec: "auto",
        "video-preview": "",
        video: ["129:122", 0],
      },
    },
    "129:99": {
      class_type: "LTXVPreprocess",
      inputs: { img_compression: 25, image: ["129:125", 0] },
    },
    "129:100": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "129:101": {
      class_type: "LTXVEmptyLatentAudio",
      inputs: {
        frames_number: ["129:130", 1],
        frame_rate: ["129:114", 0],
        batch_size: 1,
        audio_vae: ["129:126", 0],
      },
    },
    "129:102": {
      class_type: "PrimitiveInt",
      inputs: { value: durationSec },
    },
    "129:104": {
      class_type: "LTXVPreprocess",
      inputs: { img_compression: 25, image: ["129:124", 0] },
    },
    "129:106": {
      class_type: "LTXVCropGuides",
      inputs: {
        positive: ["129:111", 0],
        negative: ["129:111", 1],
        latent: ["129:121", 0],
      },
    },
    "129:108": {
      class_type: "EmptyLTXVLatentVideo",
      inputs: {
        width: ["129:110", 0],
        height: ["129:110", 1],
        length: ["129:130", 1],
        batch_size: 1,
      },
    },
    "129:109": {
      class_type: "LTXVConditioning",
      inputs: {
        frame_rate: ["129:123", 0],
        positive: ["129:128", 0],
        negative: ["129:112", 0],
      },
    },
    "129:110": {
      class_type: "GetImageSize",
      inputs: { image: ["129:124", 0] },
    },
    "129:111": {
      class_type: "LTXVAddGuide",
      inputs: {
        frame_idx: -1,
        strength: 0.7,
        positive: ["129:115", 0],
        negative: ["129:115", 1],
        vae: ["129:127", 2],
        latent: ["129:115", 2],
        image: ["129:99", 0],
      },
    },
    "129:114": {
      class_type: "PrimitiveInt",
      inputs: { value: fps },
    },
    "129:115": {
      class_type: "LTXVAddGuide",
      inputs: {
        frame_idx: 0,
        strength: 0.7,
        positive: ["129:109", 0],
        negative: ["129:109", 1],
        vae: ["129:127", 2],
        latent: ["129:108", 0],
        image: ["129:104", 0],
      },
    },
    "129:116": {
      class_type: "CFGGuider",
      inputs: {
        cfg: 1,
        model: ["129:127", 0],
        positive: ["129:111", 0],
        negative: ["129:111", 1],
      },
    },
    "129:117": {
      class_type: "SamplerEulerAncestral",
      inputs: { eta: 0, s_noise: 1 },
    },
    "129:118": {
      class_type: "ManualSigmas",
      inputs: { sigmas: sigmas.main },
    },
    "129:119": {
      class_type: "LTXVConcatAVLatent",
      inputs: {
        video_latent: ["129:111", 2],
        audio_latent: ["129:101", 0],
      },
    },
    "129:120": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["129:100", 0],
        guider: ["129:116", 0],
        sampler: ["129:117", 0],
        sigmas: ["129:118", 0],
        latent_image: ["129:119", 0],
      },
    },
    "129:121": {
      class_type: "LTXVSeparateAVLatent",
      inputs: { av_latent: ["129:120", 1] },
    },
    "129:123": {
      class_type: "ComfyMathExpression",
      inputs: {
        expression: "a",
        "values.a": ["129:114", 0],
      },
    },
    "129:124": {
      class_type: "ResizeImageMaskNode",
      inputs: {
        resize_type: "scale dimensions",
        "resize_type.width": ["129:113", 0],
        "resize_type.height": ["129:98", 0],
        "resize_type.crop": "center",
        scale_method: "nearest-exact",
        input: ["31", 0],
      },
    },
    "129:125": {
      class_type: "ResizeImageMaskNode",
      inputs: {
        resize_type: "scale dimensions",
        "resize_type.width": ["129:113", 0],
        "resize_type.height": ["129:98", 0],
        "resize_type.crop": "center",
        scale_method: "nearest-exact",
        input: ["39", 0],
      },
    },
    "129:113": { class_type: "PrimitiveInt", inputs: { value: width } },
    "129:98": { class_type: "PrimitiveInt", inputs: { value: height } },
    "129:112": {
      class_type: "CLIPTextEncode",
      inputs: { text: NEGATIVE_PROMPT, clip: ["129:103", 0] },
    },
    "129:122": {
      class_type: "CreateVideo",
      inputs: {
        fps: ["129:123", 0],
        images: ["129:105", 0],
        audio: ["129:107", 0],
      },
    },
    "129:105": {
      class_type: "VAEDecodeTiled",
      inputs: {
        tile_size: 768,
        overlap: 64,
        temporal_size: 4096,
        temporal_overlap: 64,
        samples: ["129:106", 2],
        vae: ["129:127", 2],
      },
    },
    "129:107": {
      class_type: "LTXVAudioVAEDecode",
      inputs: {
        samples: ["129:121", 1],
        audio_vae: ["129:126", 0],
      },
    },
    "129:128": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["129:103", 0] },
    },
    "129:127": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "LTX2.3\\ltx-2.3-22b-dev-fp8.safetensors" },
    },
    "129:126": {
      class_type: "LTXVAudioVAELoader",
      inputs: { ckpt_name: "LTX2.3\\ltx-2.3-22b-dev-fp8.safetensors" },
    },
    "129:103": {
      class_type: "LTXAVTextEncoderLoader",
      inputs: {
        text_encoder: "gemma_3_12B_it_fp4_mixed.safetensors",
        ckpt_name: "LTX2.3\\ltx-2.3-22b-dev-fp8.safetensors",
        device: "default",
      },
    },
    "129:130": {
      class_type: "ComfyMathExpression",
      inputs: {
        expression: "a * b + 1",
        "values.a": ["129:102", 0],
        "values.b": ["129:114", 0],
      },
    },
  };

  if (cameraLoraName) {
    addCameraLoRANode(workflow, "129:127", cameraLoraName, "129:131", ["129:116"]);
  }

  return workflow;
}
