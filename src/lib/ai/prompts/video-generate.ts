export function buildVideoPrompt(params: {
  sceneDescription: string;
  motionScript: string;
  cameraDirection: string;
  duration?: number;
  characterDescriptions?: string;
}): string {
  const timePrefix = params.duration ? `0-${params.duration}s：` : "";
  const charSection = params.characterDescriptions
    ? `\n角色参考：${params.characterDescriptions}`
    : "";
  return `${timePrefix}${params.sceneDescription}，${params.motionScript}，镜头${params.cameraDirection}。${charSection}`;
}
