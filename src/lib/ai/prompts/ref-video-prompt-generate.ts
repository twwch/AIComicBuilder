/**
 * User-message builder for the `ref_video_prompt` AI call.
 *
 * NOTE: The system prompt is NOT defined here — it lives in
 * `registry.ts` under `refVideoPromptDef` (single source of truth, also
 * exposed in the prompt management UI so users can override it).
 * This file only builds the per-request user payload.
 *
 * Output style follows the official 即梦 / Seedance inline syntax:
 *   - References are written as `@图片N` (not `@图片N`)
 *   - Flowing natural-language prose, no structured mapping header, no
 *     "节拍 1/2/3" labels, no 【对白口型】tags
 *   - Dialogue inline as "角色台词：..." appended after the action prose
 */

export interface SceneFrameInfo {
  label: string;      // e.g. "宫殿外"、"竹林"
  index: number;      // 1-based position in the ordered reference list
}

export interface CharacterRefInfo {
  name: string;
  index: number;      // 1-based position in the ordered reference list
  visualHint?: string | null;
}

export function buildRefVideoPromptRequest(params: {
  motionScript: string;
  cameraDirection: string;
  duration: number;
  characters: CharacterRefInfo[];
  sceneFrames: SceneFrameInfo[];
  dialogues?: Array<{ characterName: string; text: string; offscreen?: boolean; visualHint?: string }>;
  visualStyle?: string;
  family?: "ltx" | "wan" | "seedance" | "generic";
  mode?: "default" | "comfyui";
}): string {
  const lines: string[] = [];
  const isComfyUI = params.mode === "comfyui";

  lines.push(
    `你会收到以下参考图（顺序严格对应 @图片1、@图片2、@图片3 ...，必须使用 \`@图片N\` 形式，**不能**写成 \`@图片N\`）：`
  );
  for (const c of params.characters) {
    const hint = c.visualHint ? `（${c.visualHint}）` : "";
    lines.push(`  @图片${c.index} = 角色：${c.name}${hint}`);
  }
  for (const s of params.sceneFrames) {
    lines.push(`  @图片${s.index} = 场景：${s.label}`);
  }
  lines.push(``);

  if (params.sceneFrames.length > 1) {
    lines.push(
      `本镜头有 ${params.sceneFrames.length} 张场景参考图，按顺序对应镜头内的空间切换。散文中要依次经过这些场景并写清楚过渡。`
    );
    lines.push(``);
  }

  if (params.characters.length === 0) {
    lines.push(
      `注意：本镜头没有角色登场，只描述场景环境变化和镜头运动，不要编造任何人物。`
    );
    lines.push(``);
  }

  lines.push(`剧本动作：${params.motionScript}`);
  if (params.visualStyle) lines.push(`视觉风格参考：${params.visualStyle}`);
  lines.push(`机位指令：${params.cameraDirection}`);
  const maxDur = 15;
  lines.push(`时长：${Math.min(params.duration, maxDur)}s`);

  if (params.dialogues?.length) {
    lines.push(
      `对白（保持原文语言，直接嵌入散文末尾，用"角色名台词：..."的格式）：${params.dialogues
        .map((d) => `${d.characterName}: "${d.text}"`)
        .join("; ")}`
    );
  }

  lines.push(``);
  lines.push(`严格要求：`);
  lines.push(`1. 使用 \`@图片N\` 形式引用所有角色和场景（例：@图片1、@图片2），禁止写成 \`@图片N\``);
  lines.push(`2. 写作风格为连贯的自然散文，把 @图片N 直接嵌入描述里，禁止"节拍 1/2/3"结构化标签`);
  lines.push(`3. 禁止提示词开头写"图像映射：@图片1是 X，@图片2是 Y" 这种单独映射声明行——信息要融进散文`);
  lines.push(`4. 每次 @图片N 后面都必须加括号注释角色/场景名，写成 @图片N（名字）的格式`);
  lines.push(`5. 对白（如有）直接写在散文末尾：角色名台词：原文台词（不要 【对白口型】 等标签）`);
  lines.push(`6. 仅输出提示词正文，无前言，无 markdown`);
  if (params.family === "wan") {
    lines.push(`7. 当前目标是 Wan 系列模型：优先保证单主体稳定、单动作连续、构图稳定，避免大幅场景跳切和复杂镜头切换。`);
  }
  if (params.family === "seedance") {
    lines.push(`7. 当前目标是 Seedance / 即梦模型：优先使用更自然的中文导演散文，允许 2-4 个动作节拍，但仍保持连贯流动。`);
  }
  if (isComfyUI) {
    lines.push(`8. 这是 ComfyUI Wan 2.2 图生视频提示词，时长范围 3-30 秒 ${params.duration > 10 ? `（当前 ${params.duration}s）` : ""}，动作保留一个核心连续动作，不超过两段跳切`);
    lines.push(`9. 构图按 480:832 或 832:480 画面设计，主体必须居中稳定，避免超出边缘，避免复杂转场与大范围场景切换`);
  }

  return lines.join("\n");
}
