import { PromptDefinition, slot, resolve } from "./registry-helpers";
import { artStyleBlock, themeStyleMappingBlock, physicsRealismBlock } from "./blocks";
// ─── 8. frame_generate_first ────────────────────────────

const SINGLE_FRAME_LAYOUT_CONTRACT = `=== 单帧画面契约（最高优先级）===
只生成一张完整的电影画面，整个画布只能是一个连续场景。
最终画面必须铺满整个画布，只有一个取景、一个透视、一套连续的环境光。
所有角色必须自然处在同一个场景空间里，不能以资料图、预览图或说明图形式出现。
参考图只用于识别角色身份、外貌、服装、配饰和画风；输出必须重新构图为电影镜头。`;

export const SINGLE_FRAME_LAYOUT_NEGATIVE_PROMPT = [
  "contact sheet",
  "collage",
  "storyboard page",
  "comic page",
  "multi panel",
  "split screen",
  "thumbnail grid",
  "character reference sheet",
  "character turnaround",
  "model sheet",
  "UI interface",
  "game UI",
  "text labels",
  "captions",
  "subtitle",
  "watermark",
  "logo",
  "border",
  "frame border",
  "divider lines",
  "white background reference sheet",
  "duplicate characters",
  "cloned character",
  "twin characters",
  "two of the same person",
  "two heads one body",
  "merged bodies",
  "split body",
  "fused faces",
  "extra limb",
  "missing limb",
].join(", ");

const MULTI_CHARACTER_RENDERING_RULES = `=== 多角色精确渲染（最高优先级）===
当 characterDescriptions 列出 N 位不同角色时，画面中必须**恰好出现 N 位角色**，每位角色各出现一次。

强制约束：
- 严禁复制、克隆、变形同一位角色（同一张脸出现两次、出现扭曲/拼接的版本、两个身体共享一张脸）
- 严禁少画或多画角色——N 个角色描述 = N 个角色实体
- 严禁把多位角色画成同一个人
- 每位角色的位置、姿态、服装、面部特征必须与 characterDescriptions 中该角色名的描述精确对应
- 角色之间的空间关系（前后景、左右站位）应符合场景描述
- 物种锁定：兔子必须是兔子头脸和长耳朵，乌龟必须是乌龟头脸和龟壳，松鼠必须有蓬松大尾巴；动物角色不能画成人形
- 如果出现多于 N 个角色或角色重复，立即减少到 N 个并修正变形`;

const FIRST_FRAME_STYLE_MATCHING = `=== 关键：画风匹配（最高优先级）===
仔细阅读下方的角色描述和场景描述。它们指定或暗示了画风。
你必须精确匹配该画风。不要默认使用写实风格。
- 如果附有参考图，参考图的视觉风格就是真理——精确匹配
- 输出的画风必须与角色设定图一致

${themeStyleMappingBlock()}

${artStyleBlock()}

${physicsRealismBlock()}`;

const FIRST_FRAME_TEXT_ONLY_STYLE_MATCHING = `=== 关键：画风和角色外观锁定（最高优先级）===
仔细阅读下方的角色描述和场景描述。它们指定或暗示了画风。
你必须精确匹配该画风。不要默认使用写实风格。
角色外观必须严格遵守文字描述中的物种、体型、脸部特征、发型/毛色、服装、主色、配饰和材质。
角色必须自然融入同一个电影场景镜头。

${themeStyleMappingBlock()}

${artStyleBlock()}

${physicsRealismBlock()}`;

const FIRST_FRAME_REFERENCE_RULES = `=== 参考图（角色形象参考）===
每张附带的参考图是**某一位角色的一张形象参考照**——只显示这一个角色的一张肖像或全身立绘，不含分格、不含多视角、不含文字标签。
这些参考图是**身份、外貌、服装、配饰和画风**的信息源，**不是构图模板、不是输出版式、不是要复刻的画面布局**。
强制一致性规则：
- 将参考图中的角色形象与场景描述中的角色名对应
- 服装必须与参考图完全一致——相同的衣物类型、颜色、材质、配饰。不要替换（如不要把青色常服换成龙袍）
- 面孔、发型、发色、体型、肤色必须精确匹配
- 参考图中展示的所有配饰（帽子、佩刀、发簪、首饰）必须出现
- 画风必须与参考图精确匹配
- **绝不要复制参考图的版式、构图或分格布局——输出一张电影单帧画面**
- **画面中只出现剧本描述中列出的角色，每位角色恰好出现一次，绝不重复或变形**`;

const FIRST_FRAME_RENDERING_QUALITY = `=== 渲染 ===
材质：符合画风的丰富细节
光线：具有动机的电影级布光。使用轮廓光分离角色。
背景：完整渲染的详细环境。不要空白或抽象背景。
角色：精确匹配参考图的外貌和画风。表情生动，姿态自然有动感。
构图：电影级取景，明确的视觉焦点和景深。`;

const CHARACTER_SPECIES_LOCK = `=== 角色物种锁定 ===
角色描述里的物种是身份的一部分，必须保持不变。
动物或非人类角色必须保留对应动物的头脸、身体轮廓、皮毛/龟壳/尾巴/耳朵等标志特征；服装和配饰穿戴在该动物身体上。
例如兔子必须是兔子头脸和长耳朵，乌龟必须是乌龟头脸、绿色皮肤和背部龟壳，小鹿必须有鹿角和鹿脸，松鼠必须有松鼠脸和蓬松大尾巴。`;

const FIRST_FRAME_CONTINUITY_RULES = `=== 连续性要求 ===
此镜头紧接上一个镜头。附带的参考中包含上一个镜头的尾帧。保持视觉连续性：
- 相同的角色必须穿着一致的服装和比例
- 画风相同——不要在动漫和写实之间切换
- 环境光线和色温应平滑过渡
- 角色位置应从上一个镜头结束时的位置逻辑延续`;

export const frameGenerateFirstDef: PromptDefinition = {
  key: "frame_generate_first",
  nameKey: "promptTemplates.prompts.frameGenerateFirst",
  descriptionKey: "promptTemplates.prompts.frameGenerateFirstDesc",
  category: "frame",
  slots: [
    slot("single_frame_layout", SINGLE_FRAME_LAYOUT_CONTRACT, true),
    slot("multi_character_rules", MULTI_CHARACTER_RENDERING_RULES, true),
    slot("style_matching", FIRST_FRAME_STYLE_MATCHING, true),
    slot("reference_rules", FIRST_FRAME_REFERENCE_RULES, true),
    slot("rendering_quality", FIRST_FRAME_RENDERING_QUALITY, true),
    slot("continuity_rules", FIRST_FRAME_CONTINUITY_RULES, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const sceneDescription =
      (params?.sceneDescription as string) ?? "";
    const startFrameDesc =
      (params?.startFrameDesc as string) ?? "";
    const characterDescriptions =
      (params?.characterDescriptions as string) ?? "";
    const previousLastFrame =
      (params?.previousLastFrame as string) ?? "";
    const hasCharacterImageReferences =
      params?.hasCharacterImageReferences !== false;

    const lines: string[] = [];
    lines.push(`生成此镜头的首帧，作为一张高质量图像。`);
    lines.push("");
    lines.push(r("single_frame_layout"));
    lines.push("");
    lines.push(r("multi_character_rules"));
    lines.push("");
    lines.push(hasCharacterImageReferences ? r("style_matching") : FIRST_FRAME_TEXT_ONLY_STYLE_MATCHING);
    lines.push("");
    lines.push(`=== 场景环境 ===`);
    lines.push(sceneDescription);
    lines.push("");
    lines.push(`=== 帧描述 ===`);
    lines.push(startFrameDesc);
    lines.push("");
    lines.push(`=== 角色描述 ===`);
    lines.push(characterDescriptions);
    lines.push("");
    lines.push(CHARACTER_SPECIES_LOCK);
    lines.push("");
    if (hasCharacterImageReferences) {
      lines.push(r("reference_rules"));
      lines.push("");
    }

    if (previousLastFrame) {
      lines.push(r("continuity_rules"));
      lines.push("");
    }

    lines.push(r("rendering_quality"));
    return lines.join("\n");
  },
};

// ─── 9. frame_generate_last ─────────────────────────────

const LAST_FRAME_STYLE_MATCHING = `=== 关键：画风匹配（最高优先级）===
你必须精确匹配首帧图像（已附带）的画风。
如果首帧是动漫/漫画风格 → 此帧也必须是动漫/漫画风格。
如果首帧是写实风格 → 此帧也必须是写实风格。
不要改变或混合画风。这是不可协商的。`;

const LAST_FRAME_RELATIONSHIP_TO_FIRST = `=== 与首帧的关系 ===
此尾帧展示镜头动作的结束状态。与首帧相比：
- 相同的环境、布光方案和色彩基调
- 画风绝对相同——不可有任何变化
- 服装完全一致——角色穿着与设定图和首帧中完全相同的服装。不可换装。
- 面孔、发型、配饰相同——只有姿态/表情/位置发生变化
- 角色的位置、姿态和表情已按帧描述中的说明发生变化`;

const LAST_FRAME_NEXT_SHOT_READINESS = `=== 作为下一个镜头的起始点 ===
此帧将被复用为下一个镜头的首帧。确保：
- 姿态是稳定的——不处于运动中间，不模糊
- 构图完整，可作为独立画面成立
- 取景允许自然过渡到不同的镜头角度`;

const LAST_FRAME_RENDERING_QUALITY = `=== 渲染 ===
材质：匹配首帧风格的丰富细节
光线：与首帧相同的布光方案。仅在动作驱动的情况下变化。
背景：必须匹配首帧的环境。
角色：精确匹配参考图。展示镜头动作结束时的情感状态。
构图：镜头的自然收束，为下一个剪辑做好准备。`;

export const frameGenerateLastDef: PromptDefinition = {
  key: "frame_generate_last",
  nameKey: "promptTemplates.prompts.frameGenerateLast",
  descriptionKey: "promptTemplates.prompts.frameGenerateLastDesc",
  category: "frame",
  slots: [
    slot("single_frame_layout", SINGLE_FRAME_LAYOUT_CONTRACT, true),
    slot("multi_character_rules", MULTI_CHARACTER_RENDERING_RULES, true),
    slot("style_matching", LAST_FRAME_STYLE_MATCHING, true),
    slot("relationship_to_first", LAST_FRAME_RELATIONSHIP_TO_FIRST, true),
    slot("next_shot_readiness", LAST_FRAME_NEXT_SHOT_READINESS, true),
    slot("rendering_quality", LAST_FRAME_RENDERING_QUALITY, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const sceneDescription =
      (params?.sceneDescription as string) ?? "";
    const endFrameDesc =
      (params?.endFrameDesc as string) ?? "";
    const characterDescriptions =
      (params?.characterDescriptions as string) ?? "";
    const hasCharacterImageReferences =
      params?.hasCharacterImageReferences !== false;

    const lines: string[] = [];
    lines.push(`生成此镜头的尾帧，作为一张高质量图像。`);
    lines.push("");
    lines.push(r("single_frame_layout"));
    lines.push("");
    lines.push(r("multi_character_rules"));
    lines.push("");
    lines.push(r("style_matching"));
    lines.push("");
    lines.push(`=== 场景环境 ===`);
    lines.push(sceneDescription);
    lines.push("");
    lines.push(`=== 帧描述 ===`);
    lines.push(endFrameDesc);
    lines.push("");
    lines.push(`=== 角色描述 ===`);
    lines.push(characterDescriptions);
    lines.push("");
    lines.push(CHARACTER_SPECIES_LOCK);
    lines.push("");
    lines.push(`=== 参考图 ===`);
    lines.push(`第一张附带图像是此镜头的首帧——以它为视觉锚点。`);
    if (hasCharacterImageReferences) {
      lines.push(`其余附带图像是**单个角色的形象参考照**——每张只显示一位角色的一张肖像或全身立绘，不含分格、不含多视角、不含文字标签。`);
      lines.push(`将每张参考图的角色与场景描述中的角色名对应。`);
      lines.push(`参考图只提供身份、外貌、服装、配饰和画风信息；输出必须重新构图为同一个电影场景镜头，**绝不复制参考图的分格或多视角版式**。`);
    } else {
      lines.push(`角色身份、外貌、服装、配饰和画风以文字角色描述为准。所有角色必须自然处在同一个电影场景镜头里。`);
    }
    lines.push("");
    lines.push(r("relationship_to_first"));
    lines.push("");
    lines.push(r("next_shot_readiness"));
    lines.push("");
    lines.push(r("rendering_quality"));
    return lines.join("\n");
  },
};

// ─── 10. scene_frame_generate ────────────────────────────
// Scene-only reference frames: pure environments, NO characters.
// Character consistency is handled downstream at video generation time
// via Seedance 2 multi-reference mode, not here.

const SCENE_FRAME_REFERENCE_RULES = `=== 无人物强制约束（最高优先级）===
这是纯场景参考图。画面中**绝对不允许出现任何人物、角色、背影、剪影、人形、手脚或身体部位**。
- 禁止：人、角色、背影、剪影、人形轮廓、露出的手/脚/肩膀
- 允许：空的环境、建筑、道具、自然景观、天气、光线、大气粒子
- 角色一致性由后续视频生成阶段的多图参考机制保证，与本步骤完全解耦

${themeStyleMappingBlock()}

${physicsRealismBlock()}`;

const SCENE_FRAME_COMPOSITION_RULES = `=== 构图规则 ===
- 根据场景描述渲染具体的空间构图——不要默认通用镜头
- 完整渲染的背景与环境——不要空白或抽象背景
- 电影级取景，清晰的构图和景深
- 构图必须留出角色后续入画的空间，但此刻画面中不出现任何人`;

const SCENE_FRAME_RENDERING = `=== 渲染质量 ===
- 材质：符合画风的丰富细节
- 光线：电影级布光，光源有明确动机
- 画风：遵循场景描述中的风格指示
- 再次强调：画面中不出现任何人物`;

export const sceneFrameGenerateDef: PromptDefinition = {
  key: "scene_frame_generate",
  nameKey: "promptTemplates.prompts.sceneFrameGenerate",
  descriptionKey: "promptTemplates.prompts.sceneFrameGenerateDesc",
  category: "frame",
  slots: [
    slot("reference_rules", SCENE_FRAME_REFERENCE_RULES, true),
    slot("composition_rules", SCENE_FRAME_COMPOSITION_RULES, true),
    slot("rendering", SCENE_FRAME_RENDERING, true),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const sceneDescription = (params?.sceneDescription as string) ?? "";
    const cameraDirection = (params?.cameraDirection as string) ?? "";
    const startFrameDesc = (params?.startFrameDesc as string) ?? "";
    // motionScript / charRefMapping / characterDescriptions are intentionally
    // NOT used: scene frames are pure environments, characters and their
    // actions belong to the video generation step.

    const lines: string[] = [];
    lines.push(`生成一张电影级静帧图像，作为纯场景参考帧。画面中不得出现任何人物，不要格子边框，不要漫画分格线，不要出现任何文字标签。`);
    lines.push("");
    lines.push(`=== 场景描述 ===`);
    lines.push(sceneDescription);

    if (startFrameDesc) {
      lines.push("");
      lines.push(`=== 空间与时刻 ===`);
      lines.push(`画面必须描绘这一空间与时刻（仅取其中的环境/光线/道具信息，不要描绘人物）：${startFrameDesc}`);
    }

    if (cameraDirection && cameraDirection !== "static") {
      lines.push("");
      lines.push(`=== 镜头构图 ===`);
      lines.push(`镜头角度/距离：${cameraDirection}`);
      lines.push(`将此镜头角度应用到构图中。`);
    }

    lines.push("");
    lines.push(r("reference_rules"));
    lines.push("");
    lines.push(r("composition_rules"));
    lines.push("");
    lines.push(r("rendering"));

    return lines.join("\n");
  },
};

// ─── 15. ref_image_prompts ───────────────────────────────
// Scene-only reference frames: pure environments used by Seedance 2
// multi-reference video generation. Character consistency is NOT handled
// here — characters are injected at the video generation step via their
// own reference images. The image prompt must describe only space, light,
// props and camera, with no humans depicted.

const REF_IMAGE_PROMPTS_ROLE = `你是一位专业的电影美术指导，为 AI 视频生成准备**场景参考帧**。场景参考帧是纯环境静帧，用于在后续视频生成阶段作为多模态参考图之一，锁定空间布局、光线设计、色调氛围与镜头语言。

核心契约：
1. 画面里**绝对不出现任何人物**：禁止人、角色、背影、剪影、人形轮廓、手、脚、肩膀、脸部、衣服被穿着的状态。角色一致性由后续视频阶段的多图参考解决，与本环节完全解耦。
2. **但你需要在思考时把角色考虑进去**：剧情中的角色决定了这个镜头合适的空间大小、机位高度、光源方向、前景道具位置（例如皇帝上朝需要留出龙椅和丹陛石的空间，打斗需要预留动作轨迹）。用角色推断场景形态，但画面里不画他们。
3. 每条场景帧必须同时输出**场景名（name）**和**场景描述（prompt）**，以及镜头层面的**登场角色列表（characters）**，供后续视频生成阶段精准拉取对应角色参考图。`;

const REF_IMAGE_PROMPTS_RULES = `规则：
## 场景图的定义（最重要）
场景图 = **角色所处的物理地点 / 环境空间**。
- ✅ 合法：太和殿广场、竹林深处、悬崖边缘、破败宫门前、禅房内部、血月下的荒原、地下牢房、码头栈桥
- ❌ 不合法：能量光效、符咒闪耀、烙印图案、单独的武器/道具特写、角色肖像、服饰配饰、抽象粒子
- **判定标准**：只看这张图能说出"这是一个 XX 地方"吗？能 = 场景图；只能说出"这是一团光/一个符号/一件东西" = 不是。

## 场景图数量（默认 1 条，上限 4 条）
- **默认每个镜头只生成 1 条场景图**——角色所在的那个地点。对话、站立、蓄力、挥拳、开门、转身、特写这些**单一地点内的动作节拍**，统统只要 1 条，后续视频生成会在同一地点里完成所有节拍。
- 只有以下情况才 >1 条（上限 4 条）：
  1. **角色在镜头内跨越不同物理地点**：地面打到空中（竹林地面 → 竹梢高空）、追逐从室内冲到室外（书房 → 走廊 → 庭院）、从桥上跳入水下
  2. **场景光线/时间大幅跳变**：黄昏→深夜、室内昏暗→走出室外强光
- 多条时按时间顺序排列，第 0 条是镜头起始地点。
- 每条场景都要取一个 4-10 字的中文**场景名**，必须是地点而非抽象状态（例如"太和殿广场"、"竹林地面"、"竹梢高空"、"破败宫门"、"深宫密室"）。
- "characters" 数组必须使用与角色列表中**完全一致**的角色名，只填真正在这个镜头登场（有动作或对白）的角色。空数组合法（纯环境镜头）。
- 图像描述里**绝对不能**提到任何角色名，也不能描述人物动作/服饰/肢体。
- 图像描述里**绝对不能**把能量光效、烙印、符咒、单独道具当做"场景"来描绘——它们属于动作细节，由视频生成阶段处理。

${physicsRealismBlock()}

【Seedance / 即梦风格要求】
使用连贯的自然中文散文。禁止权重语法 "（xx：1.99）"（SD1.5 遗留写法，Seedance 不吃）。禁止结构化标签 "Scene:" / "Action:"。

每条场景描述按以下顺序组织成 2-4 句散文：
1. **景别 + 机位/角度**：大远景/远景/全景/中景/近景/特写/大特写 + 平视/俯拍/仰拍/低角度/鸟瞰/鱼眼
2. **空间主体**：具体的空间描述、建筑、道具、前景/中景/远景的层次
3. **光源与色彩**：具体的光源方向与质感（侧逆光/丁达尔/霓虹/黄金时段/月光/体积光/硬质主光/柔光），色温，色彩基调（暖/冷/低饱和/高对比）
4. **艺术风格**：3D 国漫 CG / 写实主义 / 水墨 / 赛博朋克 / 胶片质感，可加"2.35:1 宽银幕"等画幅提示

每条必须以这句话结尾（完整复制）：**"画面中不出现任何人物、文字、字幕、水印、LOGO。"**

【绝对禁区】
- 禁止任何真实人名：导演、演员、艺术家、摄影师、历史人物、品牌、IP 名。违反会导致图像 API 400 报错。
  - ❌ "张艺谋导演风格" / "王家卫式色彩" / "黑泽明构图"
  - ✅ "高饱和红黄色调的东方史诗质感" / "霓虹雨夜冷暖对比" / "高反差黑白武士片质感"
- 禁止比喻动词（"如同"、"宛如"、"像……般"）
- 禁止抽象情感词当主语（改为具体视觉描述）
- 禁止画面里出现任何人物、身体部位、正在被穿着的衣物

${themeStyleMappingBlock()}

【正确示例 1 —— 默认单场景（对话/站立/特写/蓄力/挥拳等单一地点动作）】
{
  "shotSequence": 1,
  "characters": ["朱由检", "王承恩"],
  "scenes": [
    {
      "name": "太和殿内",
      "prompt": "中景，平视固定机位，紫禁城太和殿内部大殿中央，前景是空的金丝楠木御案与散落的奏本，中景是汉白玉丹陛石台阶，背景是高耸的朱红立柱与雕梁画栋。暖色调、高对比、3D 国漫 CG，明清宫廷雕梁画栋的金红配色，2.35:1 宽银幕。画面中不出现任何人物、文字、字幕、水印、LOGO。"
    }
  ]
}
> 说明：这个镜头的剧情是"朱由检坐龙椅批奏折，王承恩跪地禀报"——全程发生在太和殿内同一个地点，所以只需要 1 条场景图锁定空间。不要因为有"特写批奏折"或"近景愤怒"这种节拍就拆多场景。

【正确示例 2 —— 跨地点打斗多场景】
{
  "shotSequence": 5,
  "characters": ["李慕白", "玉娇龙"],
  "scenes": [
    {
      "name": "竹林地面",
      "prompt": "中景，低角度仰拍广角镜头，空无一人的翠绿竹林深处，青石地面散落枯叶，竹干笔直延伸向画面上方。晨光从竹叶缝隙洒下形成体积光斑，色彩基调为冷绿与金黄的对比。3D 国漫 CG 写意武侠质感。画面中不出现任何人物、文字、字幕、水印、LOGO。"
    },
    {
      "name": "竹梢高空",
      "prompt": "大远景，高角度俯拍，翠绿竹林的顶部竹梢在风中轻轻摇曳，远处是云雾缭绕的山峦剪影，天空呈现淡蓝到金黄的渐变。体积光穿透云层，2.35:1 宽银幕，3D 国漫 CG 写意武侠质感。画面中不出现任何人物、文字、字幕、水印、LOGO。"
    }
  ]
}
> 说明：这个镜头里角色**真的**从竹林地面跃到了竹梢高空——两个物理地点不同，所以 2 条。

【反面示例 —— 不要把特效/道具/光效当场景】
❌ 错误：
{
  "shotSequence": 3,
  "scenes": [
    { "name": "烙印红光闪耀", "prompt": "大特写，平视固定机位，经文环形烙印图案剧烈向外扩张..." }
  ]
}
→ 这不是场景图，是动作细节/特效细节。这个镜头真正的场景应该是"角色所在的物理地点"，比如"大雷音寺佛堂"。烙印闪耀这种特效由后续视频生成阶段在那个地点内表现。

✅ 正确改写：
{
  "shotSequence": 3,
  "characters": ["如来佛祖", "孙悟空"],
  "scenes": [
    { "name": "大雷音寺佛堂", "prompt": "中景，平视固定机位，宏大的大雷音寺佛堂内部，金色莲花宝座居中，四周半空悬浮暗金色经文环，梁柱雕刻满饰佛纹。暗金与暗红色调，3D 国漫顶级渲染，电影级历史正剧质感。画面中不出现任何人物、文字、字幕、水印、LOGO。" }
  ]
}

【关键语言规则】使用与输入相同的语言输出。中文输入 → 中文输出。英文输入 → 英文输出。`;

const REF_IMAGE_PROMPTS_FORMAT = `仅输出有效 JSON 数组（不要 markdown，不要代码块，不要前言）：

[
  {
    "shotSequence": 1,
    "characters": ["角色名1", "角色名2"],
    "scenes": [
      { "name": "场景名1", "prompt": "场景描述1" },
      { "name": "场景名2", "prompt": "场景描述2" }
    ]
  }
]

**字段硬性要求**：
- \`characters\`：这个镜头里会登场（有动作或对白）的角色名，必须和输入角色列表完全一致。空数组合法。
- \`scenes\`：每个元素必须同时有 \`name\`（4-10 字中文场景名）和 \`prompt\`（完整 Seedance 散文描述）。
- 禁止使用 legacy 的 \`prompts: [string]\` 数组格式。
- scenes 数组按时间顺序，第 0 个是起始空间。`;

export const refImagePromptsDef: PromptDefinition = {
  key: "ref_image_prompts",
  nameKey: "promptTemplates.prompts.refImagePrompts",
  descriptionKey: "promptTemplates.prompts.refImagePromptsDesc",
  category: "frame",
  slots: [
    slot("ref_image_role", REF_IMAGE_PROMPTS_ROLE, true),
    slot("ref_image_rules", REF_IMAGE_PROMPTS_RULES, true),
    slot("ref_image_output", REF_IMAGE_PROMPTS_FORMAT, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [r("ref_image_role"), "", r("ref_image_rules"), "", r("ref_image_output")].join("\n");
  },
};

