import type { ModelConfig } from "@/lib/generate-utils";

export type VideoPromptFamily = "ltx" | "wan" | "seedance" | "generic";

export function getVideoPromptFamilyLabel(family: VideoPromptFamily): string {
  switch (family) {
    case "ltx":
      return "LTX 连续镜头";
    case "wan":
      return "Wan 稳定单动作";
    case "seedance":
      return "Seedance 分镜散文";
    default:
      return "通用视频提示词";
  }
}

export function getVideoPromptFamilyHint(family: VideoPromptFamily): string {
  switch (family) {
    case "ltx":
      return "偏连续镜头、时序推进和电影化动作描述";
    case "wan":
      return "偏主体稳定、单动作连续和少跳切";
    case "seedance":
      return "偏导演散文、动作节拍和中文镜头氛围";
    default:
      return "使用通用视频提示词增强规则";
  }
}

export function inferVideoPromptFamily(modelConfig?: ModelConfig): VideoPromptFamily {
  const video = modelConfig?.video;
  if (!video) return "generic";

  const protocol = (video.protocol || "").toLowerCase();
  const modelId = (video.modelId || "").toLowerCase();

  if (protocol === "seedance" || protocol === "ucloud-seedance") {
    return "seedance";
  }

  if (protocol === "wan" || modelId.includes("wan")) {
    return "wan";
  }

  if (modelId.startsWith("ltx-") || modelId.includes("ltx")) {
    return "ltx";
  }

  return "generic";
}
