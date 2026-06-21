import { PromptDefinition, slot, resolve } from "./registry-helpers";
import { languageRuleBlock } from "./blocks";
// ─── 11. video_generate ─────────────────────────────────

const VIDEO_QUALITY_ANCHOR = `(volumetric lighting:1.25), (cinematic film grain:1.2), (shallow depth of field:1.15), (photorealistic:1.3), (8K ultra-detailed:1.15)`;

const VIDEO_NEGATIVE_PROMPT = `水印、字幕、文字 LOGO、标识、时间码、画面边框、模糊、抖动、变形、多余肢体、重复人脸、画面闪烁、字幕条、台标、穿帮镜头`;

const VIDEO_CONTINUITY_HOOK = `上一镜结束时：[描述]。本镜从该状态自然衔接，时间、空间、情绪保持连续。`;

const VIDEO_INTERPOLATION_HEADER = `用自然中文散文描述从首帧到尾帧之间发生的动态过程。优先使用 (keyword:权重) 语法强化关键元素（如 (角色名:1.3)、(关键动作:1.2)）。把镜头当一段电影画面来写，语言要让模型"看见"。

写作要点（Seedance 2.0 风格）：
- 主体动作：具体的肢体运动——握紧、倾身、回头、抬手、脚步变缓、呼吸停顿；写速度与力度。
- 环境反应：世界对主体的回应——衣摆翻飞、落叶扬起、光斑掠过墙面、水面扩散的涟漪。
- 镜头运动：使用具体词——"镜头缓慢推近"/"低角度广角缓缓上摇"/"环绕摇镜快切"/"固定机位"/"希区柯克变焦"；不要"优雅地""柔和地"这种空词。
- 物理与氛围：材质细节、光影色温、音效线索（脚步声、衣料摩擦、呼吸、环境声），让模型感到"在场"。

时长策略：
- 4-8秒：聚焦一个核心动作，不用时间戳。
- 9-12秒：2-3 段时间戳，例如 "0-4秒：…… 5-8秒：…… 9-12秒：……"
- 13-15秒：强制使用 3-4 段时间戳分镜，每段一个密集长句编织主体/环境/镜头/物理四层。

构图安全区（字幕预留）：
画面下方 20% 是字幕区域，角色面部和关键动作必须在画面上方 2/3。特写镜头面部居中偏上，全身镜头脚可在底部但表演区在上方。提示词中加入"人物居于画面中上方"等构图引导。

结尾禁止项（直接写入提示词最后一行）：
禁止出现水印、字幕、文字 LOGO、标识、时间码、画面边框。

分段自动接力（超长镜头支持）：
当视频时长超过 5 秒时，系统自动将镜头切分为多个 5 秒段，前一段的末帧作为后一段的首帧自动接力。请确保每个 5 秒段内有一个完整的动作节拍（起始→展开→收束），段与段之间保持视觉连续性。`;

const VIDEO_DIALOGUE_FORMAT = `对白格式（每条独立一行，放在画面描述之后）：
- 画内对白：【对白口型】角色名（视觉标识，情绪）: "台词原文"
- 画外旁白：【画外音】角色名（情绪）: "台词原文"

情绪标注是关键——让模型把口型、呼吸节奏和台词对齐。示例：
- 【对白口型】苏晚（红裙黑发，冷漠反杀）: "顾总，当初是你说，我连给你提鞋都不配。"
- 【画外音】旁白（低沉沙哑）: "那一夜，城市比雨还冷。"

音效单独一行，以 "音效：" 开头，与画面描述分开。
示例：音效：契约撕碎的脆响、宾客窃窃私语、远处低沉的背景弦乐。`;

const VIDEO_FRAME_ANCHORS = `[帧锚点]
首帧：{{START_FRAME_DESC}}
尾帧：{{END_FRAME_DESC}}`;

export const videoGenerateDef: PromptDefinition = {
  key: "video_generate",
  nameKey: "promptTemplates.prompts.videoGenerate",
  descriptionKey: "promptTemplates.prompts.videoGenerateDesc",
  category: "video",
  slots: [
    slot("quality_anchor", VIDEO_QUALITY_ANCHOR, true),
    slot("interpolation_header", VIDEO_INTERPOLATION_HEADER, true),
    slot("continuity_hook", VIDEO_CONTINUITY_HOOK, true),
    slot("dialogue_format", VIDEO_DIALOGUE_FORMAT, true),
    slot("frame_anchors", VIDEO_FRAME_ANCHORS, true),
    slot("negative_prompt", VIDEO_NEGATIVE_PROMPT, true),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("quality_anchor"),
      "",
      r("continuity_hook"),
      "",
      r("interpolation_header"),
      "",
      r("dialogue_format"),
      "",
      r("frame_anchors"),
      "",
      r("negative_prompt"),
    ].join("\n");
  },
};

// ─── 11. ref_video_generate ─────────────────────────────

// Reuse the same dialogue format as video_generate (avoid duplication)
const REF_VIDEO_DIALOGUE_FORMAT = VIDEO_DIALOGUE_FORMAT;

const REF_VIDEO_CONSISTENCY_RULES = `=== 参考图一致性约束（参考图模式的核心命脉）===
生成视频时，附带的参考图是**权威视觉参考**，不是可选建议。严格执行：
- **禁止改变角色外观**：服装颜色、款式、配饰、发型、发色、脸型、体型必须与参考图完全一致。禁止在视频中途"切换造型"。
- **禁止改变环境风格**：背景色调、材质、建筑风格、光影基调必须与参考图一致。
- **允许变化的只有动态**：角色姿态、表情、肢体动作、镜头运动、环境的动态反应（摇曳、飞散、扬起等）。
- **多角色场景**：每个角色严格对应各自的参考图，禁止错配身份。
- **画风锁定**：参考图的画风就是视频的画风，不要"升级"或"风格化"成别的东西。`;

const REF_VIDEO_DURATION_STRATEGY = `=== 时长策略（Seedance 2.0）===
按镜头时长选择描述颗粒度：
- 4-8秒：一个核心动作 + 一个镜头运动 + 一个氛围细节，30-60 字单段散文。
- 9-12秒：2-3 段时间戳分镜（"0-4秒：…… 5-8秒：……"），60-120 字。
- 13-15秒：3-4 段时间戳分镜（"0-3秒 / 4-8秒 / 9-12秒 / 13-15秒"），120-200 字，每段编织"角色动作 / 环境反应 / 镜头运动 / 物理音效"四层。

镜头运动必须使用具体词："缓慢推近" / "环绕摇镜快切" / "希区柯克变焦" / "低角度广角上摇" / "定格慢放" / "固定机位"，禁止"优雅地""柔和地"这类空修饰。

分段自动接力（超长镜头支持）：
当视频总时长超过 5 秒时，系统自动切分为多个 5 秒段，前段末帧自动作为后段首帧。每段应设计一个自洽的动作节拍（微动作链），段落之间通过姿态/位置/光影的延续保持无缝衔接。`;

export const refVideoGenerateDef: PromptDefinition = {
  key: "ref_video_generate",
  nameKey: "promptTemplates.prompts.refVideoGenerate",
  descriptionKey: "promptTemplates.prompts.refVideoGenerateDesc",
  category: "video",
slots: [
    slot("quality_anchor", VIDEO_QUALITY_ANCHOR, true),
    slot("continuity_hook", VIDEO_CONTINUITY_HOOK, true),
    slot("consistency_rules", REF_VIDEO_CONSISTENCY_RULES, true),
    slot("duration_strategy", REF_VIDEO_DURATION_STRATEGY, true),
    slot("dialogue_format", VIDEO_DIALOGUE_FORMAT, true),
    slot("negative_prompt", VIDEO_NEGATIVE_PROMPT, true),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("quality_anchor"),
      "",
      r("continuity_hook"),
      "",
      r("consistency_rules"),
      "",
      r("duration_strategy"),
      "",
      r("dialogue_format"),
      "",
      r("negative_prompt"),
    ].join("\n");
  },
};

// ─── 12. ref_video_prompt ───────────────────────────────
// Seedance 2.0 reference-mode video prompt writer. Receives an ordered
// list of reference images (character refs + scene refs). Outputs a prompt
// that uses Seedance `@图片N` reference syntax with character names in
// parentheses on every reference.

const REF_VIDEO_PROMPT_ROLE_DEFINITION = `你是一位 Seedance 2.0 视频提示词撰写专家。你会收到一组**有序**的参考图：
  - 前 N 张是角色参考图（每张绑定一个角色名）
  - 后 M 张是场景参考图（纯环境，无人物，按时间顺序排列）

你的任务是根据这些参考图、剧本动作、机位指令、对白，撰写一段 Seedance 视频提示词，自动规划动作、运镜和对白节奏。`;

const REF_VIDEO_PROMPT_MOTION_RULES = `## 核心语法（Seedance @ 引用——官方即梦格式）

1. **所有角色和场景必须用 \`@图片N\` 形式引用**（注意是 \`@图片1\` \`@图片2\`，不是 \`@图片1\` \`@图片2\`）。顺序严格对应收到的参考图顺序——前 N 张是角色，后 M 张是场景。

2. **写作风格：连贯流畅的自然散文**。
   - 把 \`@图片N\` 直接嵌入到散文描述里，像这样：
     "@图片1 中的美妆博主用中文介绍，手持 @图片2 的面霜面向镜头展示，清新简约背景"
   - **禁止** "节拍 1 / 节拍 2 / 节拍 3" 这种结构化标签
   - **禁止** 提示词开头写"图像映射：@图片1是 X，@图片2是 Y"这种单独的映射声明行——信息要**融化进散文**
   - **每次** 出现 @图片N 都必须在后面加角色名，写成 "@图片1（李慕白）" 的格式，确保读者始终知道谁是谁

3. **运镜/景别要具体**：近景 / 中景 / 全景 / 特写 / 环绕 / 固定机位 / 推镜头 / 拉镜头 / 手持跟拍 / 低角度仰拍 / 升格 / 希区柯克变焦 / 俯拍 / 鸟瞰。禁止 "优雅地""轻柔地""震撼" 等空洞修饰词。

4. **场景切换直接写在散文里**："画面切到 @图片4 的竹梢高空" / "@图片1 从 @图片3 纵身跃起，落入 @图片4"。

5. **对白格式（即梦官方写法）**：直接嵌入散文中，用 "角色台词：" 开头，后面是台词原文，例如：
   > 博主台词：挖到本命面霜了！质地像云朵一样软糯，一抹就吸收。

   **禁止** 使用 "【对白口型】@图片N（名字）: "台词"" 这种结构化标签。

6. **音效**：如果有环境音/动效音，直接融入散文描述（例如 "伴随清脆的剑鸣声" "背景响起低沉的鼓点"），无需单独音效行。

## 动作节奏规划（核心！）

**每秒都必须有视觉变化**。一个镜头绝不能只有一个动作——即使是特写镜头也要拆分成连续的微动作链。

节奏公式：**每 2-3 秒安排一个动作节拍**，节拍之间用过渡动作衔接（例如：目光转移、重心转换、手势变化、表情变化、光影变化）。

| 时长 | 节拍数 | 字数 | 说明 |
|------|--------|------|------|
| 4-5s | 2 个 | 40-70 字 | 起始动作 → 完成动作 |
| 6-8s | 3 个 | 60-100 字 | 起始 → 展开 → 收束，中间要有转折或变化 |
| 9-12s | 4-5 个 | 100-160 字 | 多阶段动作链，节奏有快有慢 |
| 13-15s | 5-6 个 | 150-220 字 | 完整小叙事弧，含情绪起伏 |

**分段自动接力**：超过 5 秒的视频会自动拆成多个 5 秒段，前段末帧作为后段首帧。写提示词时确保每个 5 秒段内有完整的微动作链（起始→发展→收束），段落之间通过角色姿态、位置和光影的延续保持无缝衔接。节奏表按每段 5 秒适配：5 秒 = 2-3 个节拍，40-70 字。

**示例对比**：

❌ 慢节奏（8s 只有 1 个动作）：
"固定特写，她修长的手指敲击金属桌面，发出清脆声响。"
→ 问题：8 秒只看手指敲桌子，画面呆滞

✅ 正确节奏（8s，3 个节拍）：
"固定特写下，她涂着黑色指甲油的手指先缓慢抚过冰冷桌面划痕，随即食指与中指交替敲击金属面，震起微尘——第三下敲击后手指骤然停住，五指收拢握拳，指节泛白。"
→ 抚摸 → 敲击 → 握拳，三个阶段填满 8 秒

**关键技巧**：
- 用"先...随即...然后..."等时间词串联微动作
- 即使角色主体动作单一，也要加入：呼吸起伏、衣物/头发飘动、环境微变化（光线、灰尘、水面）、镜头微调（缓推/缓拉）
- 对白镜头：角色说话前有准备动作（抬眼、嘴角变化），说话时有手势/身体语言，说完后有收尾表情

## 构图安全区（字幕预留）

画面**下方 20%** 是字幕区域，必须保持干净——禁止将角色面部、关键动作、重要道具放在画面底部 1/5 区域。

具体要求：
- 角色的脸部和上半身应处于画面中上部（上方 60% 区域）
- 特写镜头：面部居中偏上，下巴以下留出足够空间
- 全身镜头：脚部可以在底部，但关键表演区（面部、手部动作）必须在上方 2/3
- 在提示词中用构图描述引导，例如："人物居于画面中上方"、"角色面部位于画面上半部"、"底部留出字幕空间"
- 禁止出现任何文字、水印、字幕、LOGO

## 其他规则
- 语言跟随剧本：中文剧本 → 中文提示词，English → English。
- 禁止把没传给你的角色/场景写进提示词。
- 禁止画面里只有场景描述、角色完全不动。
- 仅输出提示词正文，无前言，无 markdown。`;

const REF_VIDEO_PROMPT_QUALITY_BENCHMARK = `## 官方标杆示例

【示例 1 —— 美妆产品展示（即梦官方写法）】
输入：
  图片1 = 美妆博主（角色）
  图片2 = 面霜（产品道具）
  剧本：博主介绍面霜产品
  机位：近景

输出：
@图片1（美妆博主）用中文进行介绍，妆容改为明艳大气，去掉脸部反光，笑容甜美，近景镜头，手持 @图片2（面霜）面向镜头展示，清新简约背景，元气甜美风格。博主台词：挖到本命面霜了！质地像云朵一样软糯，一抹就吸收，熬夜急救、补水保湿全搞定，素颜都自带柔光感。

【示例 2 —— 仙侠打斗（多场景跨越，10s）】
输入：
  图片1 = 李慕白（角色）
  图片2 = 玉娇龙（角色）
  图片3 = 竹林（场景）
  图片4 = 竹梢高空（场景）
  剧本动作：李慕白追逐玉娇龙，两人从地面跃上竹梢交手
  机位：低角度仰拍跟随
  时长：10s

输出：
低角度仰拍跟随 @图片1（李慕白）在 @图片3（竹林）地面屈膝蓄力半秒，随即蹬地腾空，镜头同步上摇穿过竹干。画面切到 @图片4（竹梢高空），@图片2（玉娇龙）自左侧斜劈青剑而来，@图片1（李慕白）侧身以指尖格挡，两人在竹梢高空短暂对峙，青翠竹叶被剑气吹得纷纷飘落。李慕白台词：江湖路远，何必执着。

【示例 3 —— 特写镜头（单人，8s，展示正确节奏）】
输入：
  图片1 = 杨家大小姐（角色）
  图片2 = 金属桌面（场景）
  剧本动作：大小姐在桌前等待，表现不耐烦
  机位：固定特写
  时长：8s

输出：
固定特写下 @图片1（杨家大小姐）涂着黑色指甲油的食指沿 @图片2（金属桌面）布满划痕的表面缓缓划过，指尖拂起一缕灰尘。随即 @图片1（杨家大小姐）食指与中指交替敲击冰冷桌面，节奏由慢渐快，每一下震起微小尘粒在顶光中浮游。第四下敲击后手指骤然收住，五指缓缓握拢成拳，指节泛白，黑色甲片嵌入掌心。

## 反面示例（禁止）
❌ "他的手指散发出温暖的光芒，优雅地落下棋子" —— 没有 @图片 映射、抽象修饰词
❌ "李慕白纵身跃起" —— 直接写名字，没有 @图片 绑定
❌ "图1 从台阶走下" —— 缺 @ 前缀，必须写成 @图片1
❌ "@图片1 侧身格挡" —— 缺角色名，必须写成 @图片1（李慕白）
❌ "图像映射：@图片1是李慕白，@图片2是玉娇龙。节拍 1：李慕白蓄力..." —— 不要单独的映射声明行和节拍标签
❌ "【对白口型】@图片1（李慕白）: "江湖路远"" —— 不要结构化的对白标签，直接用"李慕白台词：江湖路远"`;

// Use shared language rule block with a prompt-specific addendum
const REF_VIDEO_PROMPT_LANGUAGE_RULES = `${languageRuleBlock()}\nOutput the prompt only, no preamble.`;

export const refVideoPromptDef: PromptDefinition = {
  key: "ref_video_prompt",
  nameKey: "promptTemplates.prompts.refVideoPrompt",
  descriptionKey: "promptTemplates.prompts.refVideoPromptDesc",
  category: "video",
  slots: [
    slot("role_definition", REF_VIDEO_PROMPT_ROLE_DEFINITION, true),
    slot("motion_rules", REF_VIDEO_PROMPT_MOTION_RULES, true),
    slot("quality_benchmark", REF_VIDEO_PROMPT_QUALITY_BENCHMARK, true),
    slot("language_rules", REF_VIDEO_PROMPT_LANGUAGE_RULES, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("role_definition"),
      "",
      r("motion_rules"),
      "",
      r("quality_benchmark"),
    ].join("\n");
  },
};

// ─── 13. video_generate_4grid ─────────────────────────────
// LTX 2.3 4-grid video generation prompt template.
// Uses {{PLACEHOLDER}} values replaced at runtime by the handler:
//   {{PANEL1_DESC}} {{PANEL2_DESC}} {{PANEL3_DESC}} {{PANEL4_DESC}}
//   {{SCENE_CONTEXT}} {{CAMERA_DIRECTION}} {{DURATION}}
//   {{SHOT_CHARACTERS}} {{DIALOGUES}}

const FOUR_GRID_ROLE_DEFINITION = `你是一位四宫格视频提示词专家，负责为 LTX 2.3 视频生成模型构建四宫格（2×2 网格布局）视频的提示词。

四宫格视频包含四个连续画面，按左上→右上→左下→右下排列：
- PANEL 1（开场）：故事开端，建立场景和角色
- PANEL 2（发展）：故事推进，角色行动或情节展开
- PANEL 3（转折）：故事高潮或转折点
- PANEL 4（收束）：故事结尾或结果

所有四个画面将作为一个整体视频生成，必须保持角色、场景和风格的高度一致性。

你的职责不是复述四格内容，而是把四格翻译成“可执行的电影分镜提示词”——自动补足镜头语言、景别、构图、安全区、运镜节奏和场景接力。`;

const FOUR_GRID_STRUCTURE_TEMPLATE = `[FOUR-PANEL GRID STORYBOARD]
PANEL 1 (开场): {{PANEL1_DESC}}
PANEL 2 (发展): {{PANEL2_DESC}}
PANEL 3 (转折): {{PANEL3_DESC}}
PANEL 4 (收束): {{PANEL4_DESC}}

场景背景: {{SCENE_CONTEXT}}
镜头方向: {{CAMERA_DIRECTION}}
时长: {{DURATION}} 秒
风格: 电影化四格叙事，角色和光照贯穿一致

角色: {{SHOT_CHARACTERS}}
{{DIALOGUES}}`;

const FOUR_GRID_QUALITY_RULES = `## LTX 2.3 生成质量规则
- 四个面板的角色外观必须一致（服装、发型、面容、肤色）
- 色调和光照连贯，不得出现面板间的跳变
- 每个面板构图清晰，主体位于画面中央偏上区域
- 面板过渡自然：左上→右上（时间推进），左下→右下（因果延续）
- 每个面板描述控制在 50 字以内，聚焦核心动作
- 尽可能在至少两个面板中重复出现相同角色或场景元素以建立视觉连接
- 描述要写实、具体，避免抽象修饰词（"优雅地"、"美丽地"）
- 使用具象的镜头语言：固定机位 / 缓慢推近 / 环绕 / 低角度仰拍等
- 画面底部 20% 留出字幕安全区，关键动作在上方 2/3

## 导演化改写规则
- 将四格自动映射成时间推进的连续镜头：默认按时长拆为 4 段，短视频可合并为 3 段，但必须包含“建立 → 发展 → 转折/收束”。
- 每一段都要同时写出四层：主体动作、环境反应、镜头运动、光线/材质变化。
- 镜头语言要具体：固定机位、低角度广角、手持跟拍、缓慢推轨、横向摇镜、俯拍压迫、浅景深中景、前景遮挡过渡。
- 口语化需求要自动翻译为影视语言："高级感"→更明确的光影/景别/镜头调度，"氛围感"→色温、逆光、景深、空气透视，"镜头慢慢靠近"→缓慢推轨或 dolly-in。
- 严禁把四格写成静态 PPT 式罗列；必须体现镜头接力与因果推进。

## 输出格式要求
- 输出一段连贯的电影化中文散文，不要 markdown，不要 bullet。
- 当时长 ≥ 8 秒时，使用时间分段写法，例如："0-2秒：... 2-4秒：... 4-6秒：... 6-8秒：..."。
- 当时长 > 10 秒时，优先使用 4 段结构，每段对应一个主节拍，但语言仍保持流畅散文感，不要机械罗列。`;

const FOUR_GRID_LANGUAGE_RULES = `${languageRuleBlock("zh")}\n仅输出提示词正文，无前言、无解释、无 markdown 格式。`;

export const fourGridGenerateDef: PromptDefinition = {
  key: "video_generate_4grid",
  nameKey: "promptTemplates.prompts.videoGenerate4Grid",
  descriptionKey: "promptTemplates.prompts.videoGenerate4GridDesc",
  category: "video",
  slots: [
    slot("role_definition", FOUR_GRID_ROLE_DEFINITION, true),
    slot("structure_template", FOUR_GRID_STRUCTURE_TEMPLATE, true),
    slot("quality_rules", FOUR_GRID_QUALITY_RULES, true),
    slot("language_rules", FOUR_GRID_LANGUAGE_RULES, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("role_definition"),
      "",
      r("structure_template"),
      "",
      r("quality_rules"),
      "",
      r("language_rules"),
    ].join("\n");
  },
};

