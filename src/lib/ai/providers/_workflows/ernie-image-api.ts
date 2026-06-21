export const ERNIE_IMAGE_API_PROMPT = {
  "73": {
    inputs: {
      filename_prefix: "Ernie-Image",
      images: ["88:65", 0],
    },
    class_type: "SaveImage",
    _meta: { title: "保存图像" },
  },
  "88:71": {
    inputs: { width: 1024, height: 1024, batch_size: 1 },
    class_type: "EmptyFlux2LatentImage",
    _meta: { title: "空Latent图像（Flux2）" },
  },
  "88:66": {
    inputs: { unet_name: "ernie-image.safetensors", weight_dtype: "default" },
    class_type: "UNETLoader",
    _meta: { title: "UNet加载器" },
  },
  "88:65": {
    inputs: { samples: ["88:70", 0], vae: ["88:63", 0] },
    class_type: "VAEDecode",
    _meta: { title: "VAE解码" },
  },
  "88:70": {
    inputs: {
      seed: 138415388243612,
      steps: 20,
      cfg: 4,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 1,
      model: ["88:66", 0],
      positive: ["88:67", 0],
      negative: ["88:72", 0],
      latent_image: ["88:71", 0],
    },
    class_type: "KSampler",
    _meta: { title: "K采样器" },
  },
  "88:67": {
    inputs: { text: ["88:75", 0], clip: ["88:62", 0] },
    class_type: "CLIPTextEncode",
    _meta: { title: "CLIP文本编码" },
  },
  "88:72": {
    inputs: { text: "", clip: ["88:62", 0] },
    class_type: "CLIPTextEncode",
    _meta: { title: "CLIP文本编码" },
  },
  "88:83": {
    inputs: {
      string:
        '<s>[SYSTEM_PROMPT]你是一个专业的文生图 Prompt 增强助手。你将收到用户的简短图片描述及目标生成分辨率，请据此扩写为一段内容丰富、细节充分的视觉描述，以帮助文生图模型生成高质量的图片。仅输出增强后的描述，不要包含任何解释或前缀。[/SYSTEM_PROMPT][INST]{"prompt": "{prompt}", "width": {width}, "height": {height}}[/INST]',
      find: "{prompt}",
      replace: ["88:78", 0],
    },
    class_type: "StringReplace",
    _meta: { title: "替换" },
  },
  "88:78": {
    inputs: {
      value:
        "3D迪士尼动画风格，皮克斯式渲染——蚁后，体长约3.5厘米，乳白色半透明甲壳，腹部膨大，触角较短，黑色小圆眼，行动略迟缓。身体覆盖细密白色绒毛，头戴花瓣与树脂冠冕，颈挂一圈光滑小石子项链。腹部下方有6个蓝色荧光斑点（酸液腺），闪光时预示酸液喷射。沉稳威严，说话带粘滞感。在中性站立姿态下，六条腿自然支撑，腹部微微摆动，绒毛顺服，触角轻垂。角色色彩调色板：乳白、淡蓝荧光、花瓣粉、树脂黄、石子灰。要四视图结构,不要有任何文字",
    },
    class_type: "PrimitiveStringMultiline",
    _meta: { title: "String (Multiline - Prompt)" },
  },
  "88:74": {
    inputs: {
      prompt: ["88:95", 0],
      max_length: 2048,
      sampling_mode: "on",
      "sampling_mode.temperature": 0.6,
      "sampling_mode.top_k": 64,
      "sampling_mode.top_p": 0.8,
      "sampling_mode.min_p": 0.05,
      "sampling_mode.repetition_penalty": 1.05,
      "sampling_mode.seed": 0,
      "sampling_mode.presence_penalty": 0,
      thinking: false,
      use_default_template: true,
      clip: ["88:91", 0],
    },
    class_type: "TextGenerate",
    _meta: { title: "TextGenerate" },
  },
  "88:76": {
    inputs: { value: true },
    class_type: "PrimitiveBoolean",
    _meta: { title: "Enable prompt enhancement?" },
  },
  "88:75": {
    inputs: {
      switch: ["88:76", 0],
      on_false: ["88:78", 0],
      on_true: ["88:74", 0],
    },
    class_type: "ComfySwitchNode",
    _meta: { title: "切换" },
  },
  "88:62": {
    inputs: { clip_name: "ministral-3-3b.safetensors", type: "flux2", device: "default" },
    class_type: "CLIPLoader",
    _meta: { title: "加载CLIP" },
  },
  "88:63": {
    inputs: { vae_name: "flux2-vae.safetensors" },
    class_type: "VAELoader",
    _meta: { title: "加载VAE" },
  },
  "88:91": {
    inputs: { clip_name: "ernie-image-prompt-enhancer.safetensors", type: "flux2", device: "default" },
    class_type: "CLIPLoader",
    _meta: { title: "Load CLIP (PE)" },
  },
  "88:92": {
    inputs: { source: 1024 },
    class_type: "PreviewAny",
    _meta: { title: "Preview as Text (Int to String)" },
  },
  "88:93": {
    inputs: { source: 1024 },
    class_type: "PreviewAny",
    _meta: { title: "Preview as Text (Int to String)" },
  },
  "88:94": {
    inputs: {
      string: ["88:83", 0],
      find: "{width}",
      replace: ["88:92", 0],
    },
    class_type: "StringReplace",
    _meta: { title: "替换" },
  },
  "88:95": {
    inputs: {
      string: ["88:94", 0],
      find: "{height}",
      replace: ["88:93", 0],
    },
    class_type: "StringReplace",
    _meta: { title: "替换" },
  },
  "88:97": {
    inputs: { source: ["88:75", 0] },
    class_type: "PreviewAny",
    _meta: { title: "Preview as Text (Int to String)" },
  },
} as const;
