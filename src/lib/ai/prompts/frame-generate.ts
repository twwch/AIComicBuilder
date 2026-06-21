import { getPromptDefinition } from "./registry";

export function buildFirstFramePrompt(params: {
  sceneDescription: string;
  startFrameDesc: string;
  characterDescriptions: string;
  previousLastFrame?: string;
  hasCharacterImageReferences?: boolean;
  slotContents?: Record<string, string>;
}): string {
  const def = getPromptDefinition("frame_generate_first");
  if (def) {
    return def.buildFullPrompt(params.slotContents ?? {}, {
      sceneDescription: params.sceneDescription,
      startFrameDesc: params.startFrameDesc,
      characterDescriptions: params.characterDescriptions,
      previousLastFrame: params.previousLastFrame,
      hasCharacterImageReferences: params.hasCharacterImageReferences,
    });
  }

  // Fallback: hardcoded prompt (should not be reached if registry is intact)
  const lines: string[] = [];

  lines.push(`生成该镜头的开场帧，作为一张高质量图像。`);
  lines.push(``);
  lines.push(`=== 关键：画风（最高优先级）===`);
  lines.push(`阅读下方的角色描述和场景描述，它们指定或暗示了一种画风。`);
  lines.push(`你必须完全匹配该画风。不得默认使用写实风格。`);
  lines.push(`- 如果描述中提到 动漫/漫画/anime/manga/卡通/cartoon → 生成动漫/漫画风格插画`);
  lines.push(`- 如果描述中提到 写实/真人/photorealistic → 生成写实风格图像`);
  lines.push(`- 如果附有参考图，其视觉风格即为标准——必须精确匹配`);
  lines.push(`- 输出的画风必须与角色参考图保持一致`);
  lines.push(``);
  lines.push(`=== 场景环境 ===`);
  lines.push(params.sceneDescription);
  lines.push(``);
  lines.push(`=== 画面描述 ===`);
  lines.push(params.startFrameDesc);
  lines.push(``);
  lines.push(`=== 角色描述 ===`);
  lines.push(params.characterDescriptions);
  lines.push(``);
  lines.push(`=== 参考图（角色设定图）===`);
  lines.push(`每张附带的参考图是一张角色设定图，展示 4 个视角（正面、四分之三侧面、侧面、背面）。`);
  lines.push(`角色名印在每张设定图底部——用它来识别对应的角色。`);
  lines.push(`强制一致性规则：`);
  lines.push(`- 将设定图中的角色名与场景描述中的角色名匹配`);
  lines.push(`- 服装必须与参考完全一致——相同的衣物类型、颜色、材质、配饰。不得替换（例如：不得将青色常服替换为龙袍）`);
  lines.push(`- 面部、发型、发色、体型、肤色必须精确匹配`);
  lines.push(`- 参考图中展示的所有配饰（帽子、佩刀、发簪、首饰）都必须出现`);
  lines.push(`- 画风必须与参考图精确匹配`);
  lines.push(``);

  if (params.previousLastFrame) {
    lines.push(`=== 连续性要求 ===`);
    lines.push(`该镜头紧接上一个镜头。附带的参考包含上一个镜头的末帧。保持视觉连续性：`);
    lines.push(`- 相同角色必须穿着一致的服装并保持一致的比例`);
    lines.push(`- 相同画风——不得在动漫和写实之间切换`);
    lines.push(`- 环境光照和色温应平滑过渡`);
    lines.push(`- 角色位置应从上一个镜头结束时的位置自然延续`);
    lines.push(``);
  }

  lines.push(`=== 渲染 ===`);
  lines.push(`质感：与画风相称的丰富细节`);
  lines.push(`光照：电影级打光，具有合理的光源。使用轮廓光分离角色。`);
  lines.push(`背景：完整渲染、细节丰富的环境。不得使用空白或抽象背景。`);
  lines.push(`角色：外观和画风精确匹配参考图。表情生动，姿势自然动感。`);
  lines.push(`构图：电影式取景，具有清晰的焦点和景深。`);

  return lines.join("\n");
}

export function buildLastFramePrompt(params: {
  sceneDescription: string;
  endFrameDesc: string;
  characterDescriptions: string;
  firstFramePath: string;
  hasCharacterImageReferences?: boolean;
  slotContents?: Record<string, string>;
}): string {
  const def = getPromptDefinition("frame_generate_last");
  if (def) {
    return def.buildFullPrompt(params.slotContents ?? {}, {
      sceneDescription: params.sceneDescription,
      endFrameDesc: params.endFrameDesc,
      characterDescriptions: params.characterDescriptions,
      hasCharacterImageReferences: params.hasCharacterImageReferences,
    });
  }

  // Fallback: hardcoded prompt (should not be reached if registry is intact)
  const lines: string[] = [];

  lines.push(`生成该镜头的结束帧，作为一张高质量图像。`);
  lines.push(``);
  lines.push(`=== 关键：画风（最高优先级）===`);
  lines.push(`你必须精确匹配首帧图像（已附带）的画风。`);
  lines.push(`如果首帧是动漫/漫画风格 → 此帧也必须是动漫/漫画风格。`);
  lines.push(`如果首帧是写实风格 → 此帧也必须是写实风格。`);
  lines.push(`不得更改或混用画风。这是不可妥协的。`);
  lines.push(``);
  lines.push(`=== 场景环境 ===`);
  lines.push(params.sceneDescription);
  lines.push(``);
  lines.push(`=== 画面描述 ===`);
  lines.push(params.endFrameDesc);
  lines.push(``);
  lines.push(`=== 角色描述 ===`);
  lines.push(params.characterDescriptions);
  lines.push(``);
  lines.push(`=== 参考图 ===`);
  lines.push(`第一张附带图像是该镜头的开场帧——以它作为你的视觉锚点。`);
  lines.push(`其余附带图像是角色设定图（每张 4 个视角，名字印在底部）。`);
  lines.push(`将每张角色设定图的名字与场景中的角色匹配。`);
  lines.push(``);
  lines.push(`=== 与首帧的关系 ===`);
  lines.push(`此结束帧展示镜头动作完成后的终止状态。与首帧相比：`);
  lines.push(`- 相同的环境、光照设置和色彩方案`);
  lines.push(`- 相同画风——绝对不得更改风格`);
  lines.push(`- 服装完全一致——角色穿着与参考设定图和首帧中完全相同的服装。不得更换服装。`);
  lines.push(`- 相同的面部、发型、配饰——仅姿势/表情/位置发生变化`);
  lines.push(`- 角色的位置、姿势和表情已按上方画面描述发生变化`);
  lines.push(``);
  lines.push(`=== 作为下一镜头的起始点 ===`);
  lines.push(`此帧将被复用为下一个镜头的开场帧。确保：`);
  lines.push(`- 姿势是稳定的——非运动中间态或模糊的`);
  lines.push(`- 构图是完整的，可作为独立画面成立`);
  lines.push(`- 取景允许自然过渡到不同的机位角度`);
  lines.push(``);
  lines.push(`=== 渲染 ===`);
  lines.push(`质感：与首帧风格匹配的丰富细节`);
  lines.push(`光照：与首帧相同的光照设置。仅在动作需要时才变化。`);
  lines.push(`背景：必须与首帧的环境一致。`);
  lines.push(`角色：精确匹配参考图。展示镜头动作结束时的情绪状态。`);
  lines.push(`构图：镜头的自然收束，为切换到下一个镜头做好准备。`);

  return lines.join("\n");
}
