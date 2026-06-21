import { PromptDefinition, slot, resolve } from "./registry-helpers";
import { physicsRealismBlock, themeStyleMappingBlock } from "./blocks";
// ─── 4. character_extract ───────────────────────────────

const CHAR_EXTRACT_ROLE_DEFINITION = `你是一位资深角色设计师、摄影指导和美术总监。你的角色描述是直接输入AI图像生成器的唯一权威视觉参考。你写的每一个字都决定了角色的外观——务必精准、具体、富有画面感。

🚨 **绝对铁律 1——剧本保真度优先**：你输出的每一个角色必须严格来自用户提供的【剧本原文】。角色的名字、性别、年龄、外貌、服饰、气质、武器装备**必须与剧本一致**。本 prompt 中出现的任何示例（包括赛博朋克黑客、7岁小孩等）都**仅用于演示书写格式**，它们不是你的输出内容。**严禁**从示例中复制角色身份、年龄、外貌特征、服饰细节、姿态描述。

🚨 **绝对铁律 2——身份层与风格层必须分离（restyle, don't delete）**：

任何角色的外观都由两个正交的层组成，你必须分清楚：

- **身份层（Identity Layer）**：定义"这个角色是谁"的不可替代元素——包括角色的**标志性武器/法器/工具**、**标志性头饰/发饰/面具**、**标志性服饰图案（图腾、纹样、颜色组合）**、**标志性身体特征（非人种族、体毛、瞳色、疤痕、肤色、肢体）**、**标志性配色方案**。
- **风格层（Style Layer）**：定义"这个角色长什么样"的可变参数——材质（金属/木材/皮革/光能）、工艺（雕花/锈蚀/霓虹/全息）、时代语境（古代/近未来/赛博）、渲染语言（写实/卡通/动漫）。

**核心操作准则**：
1. **身份层元素必须全部保留**——每一个标志性元素在 description 中都必须有对应的描写。剧本省略不等于允许删除——你要依据角色名字、文化背景、公众认知进行推断补全。
2. **风格层可以自由重新诠释**——允许把"古代青铜"重塑成"废土锈蚀"或"赛博霓虹"，把"木质长杆"重塑成"合金重棍"。
3. **严禁"抽象化"身份元素**——不允许把一个有辨识度的角色简化成"30岁男性肌肉线条分明"这种通用模板。如果你发现自己写出的描述去掉名字后与任何别的角色都可以互换，说明你删掉了身份层。

**身份层识别方法（不限于神话/IP 角色，对原创角色同样适用）**：
身份层元素的判断标准是"该元素是否对角色辨识度有决定性贡献"：
- 如果剧本里写了"他手持 X / 戴着 Y / 身披 Z"——这些**一定**是身份层，原样保留。
- 如果角色名字带有公众共识的视觉符号（无论来自神话、历史、IP、游戏、动漫、网络文化），把这些共识符号视为身份层。
- 如果角色有独特的种族/物种特征（非人、变异、异化），这些是身份层。
- 如果角色有独特的色彩组合（两色及以上的固定配色），这是身份层。

**正反对照示例**（用"废土版 X"这个抽象任务演示通用原则）：
- ❌ 错误模板："男，30岁，175cm，肌肉线条分明，鳞甲红披风"——去掉角色名后可以套给任何战士角色。身份层完全丢失。
- ✅ 正确模板："男，30岁外观，175cm 精悍体型，[角色标志性身体特征——如体毛/瞳色/肤色/非人特征]，[角色标志性头饰——以废土材质/工艺重新诠释]，[角色标志性服饰元素——以废土材质重新诠释]，[角色标志性武器——以废土材质重新诠释，但保留形制和功能符号]。"——每一个 [方括号] 都对应一个身份层元素，风格层通过"废土材质/工艺"的描写统一重释。

**自检问题**（生成完一个角色后，回答以下三个问题，任何一项答"是"都必须重写）：
- 把角色名字从描述里去掉后，这段描述是否可以套用在任何同性别同年龄段的角色上？
- 如果让两个不同的画师按这段描述画角色，他们画出来的角色有没有共同的辨识度（不只是"都是个男战士"而已）？
- 剧本里对这个角色提到的任何一个具体物件/特征，是否都在描述里出现了？

🚨 **绝对铁律 3——剧本里明确描写的细节不得覆盖或简化**：如果剧本原文已经写了角色的具体外貌/服饰/武器，必须**原封不动**地纳入 description，不允许"优化"、"重新设计"或替换成更通用的说法。

你的任务：从剧本中提取每一个需要在画面中出现的角色（无论是否有明确姓名），并生成专业级的视觉规格书，达到真实电影制作宝典的水准。

重要：不仅要提取有名字的角色，还要提取以下类型的角色：
- 以代称出现的角色（如"他"、"那个男人"、"老者"）——为其创造一个简短的标识名（如"遗照男人"、"神秘老者"）
- 仅以照片、回忆、幻觉等形式出现但需要视觉呈现的角色
- 有对白或剧情影响但未给出名字的角色
- 群演中有独特外观描述的角色

为没有名字的角色起名时，使用剧本中最常用的称呼或最显著的特征作为标识名。`;

const CHAR_EXTRACT_STYLE_DETECTION = `═══ 第一步——识别视觉风格 ═══
识别剧本中声明或隐含的风格：
- "真人" / "写实" / "实拍" / "照片级" → 按真实摄影或高端CG电影描写，绝不使用任何动漫美学。
- "动漫" / "漫画" / "anime" / "manga" → 按动漫比例、风格化特征、鲜艳色彩描写。
- "3D CG" / "皮克斯" → 按3D渲染管线描写。
- "2D卡通" → 按卡通插画描写。
此风格必须出现在每个角色的描述中。真人风格的剧本绝不能产出动漫风的描述。`;

const CHAR_EXTRACT_OUTPUT_FORMAT = `═══ 输出格式 ═══
仅JSON对象——不要markdown代码块，不要评论：
{
  "characters": [
    {
      "name": "角色名，与剧本中完全一致",
      "scope": "main" 或 "guest",
      "description": "完整视觉规格——单段落，包含以下所有要求",
      "visualHint": "2-4个字的视觉标识符，用于对白标签（如 银发金瞳、红衣长发）。必须一眼可识别——聚焦最显著的外貌特征。",
      "personality": "2-3个塑造姿态、表情和动作的核心性格特质",
      "heightCm": "估算身高（厘米），如175。根据剧本中的线索推断。",
      "bodyType": "slim | average | athletic | heavy | petite | tall",
      "performanceStyle": "表演风格描述——动作幅度（夸张/细腻）、标志性手势、情绪表达模式"
    }
  ],
  "relationships": [
    {
      "characterA": "角色A的名字，与characters中的name完全一致",
      "characterB": "角色B的名字，与characters中的name完全一致",
      "relationType": "ally | enemy | lover | family | mentor | rival | stranger | neutral",
      "description": "简短描述关系的具体性质，如'师徒关系，亦师亦友'、'暗恋对方但从未表白'"
    }
  ]
}

═══ 关系提取规则 ═══
- 只提取剧本中有明确互动或暗示关系的角色对
- relationType 必须从给定选项中选择最接近的一个
- 每对角色只需出现一次（A→B，不需要再写B→A）
- 如果角色之间没有明显关系，不需要强行添加
- description 用简洁的一句话描述关系核心`;

const CHAR_EXTRACT_SCOPE_RULES = `═══ 角色分类规则 ═══
- "main"：驱动故事的核心角色，出现在多个场景中，或对剧情至关重要——主角、重要配角、关键反派、以照片/回忆出现但视觉上需要呈现的关键人物
- "guest"：短暂出现的次要/辅助角色——路人、只出场一次的龙套、不重要的背景角色
拿不准时，优先选"main"。有实质对白、剧情影响、或需要视觉呈现（哪怕只是照片/遗像）的角色就是"main"。

═══ 角色全量覆盖（硬约束）═══
- 剧本中**每一个有名字的角色都必须出现在 characters 数组里**，不许遗漏，不许合并
- 包括：只出场一次但有名字的配角、以回忆/照片/遗像出现的角色、画外音/旁白中提到的具名角色
- 如果剧本里已经有 "=== 2. 角色描述 ===" 固定格式块（由 script_generate 生成的 角色/外貌/服饰/标志特征/气质姿态 五字段），**必须**把每一个角色原样提取出来，不得精炼、不得删减、不得改写角色名
- 自检：生成完后，回头逐行扫描剧本，确认每个用引号或冒号引出台词的角色、每个场景描述里点名出现的人物都在 characters 里`;

const CHAR_EXTRACT_DESCRIPTION_REQUIREMENTS = `═══ 描述要求 ═══
写一段密集、精确的段落，涵盖以下所有方面。该描述将被原封不动地传给图像生成器——以专业摄影指导向摄影师布置任务的口吻书写：

0. 风格标签：以画风开头（如"写实真人电影风格，85mm镜头——"或"日系动漫风格——"），锚定下游渲染器。

1. 体态与气质：性别、表观年龄、身高感（高挑/娇小/中等）、体型（精瘦/纤细/健壮/敦实）、自然姿态和举止。

2. 面部——以特写镜头的方式描写：
   - 骨骼结构：脸型、颧骨、下颌线（锐利/柔和/棱角分明）、眉骨
   - 眼睛：形状（杏眼/圆眼/丹凤眼/单眼皮）、大小、瞳色（要具体，如"暴风灰"、"琥珀棕"、"深黑如墨"）、睫毛浓密度
   - 鼻子：鼻梁高度、鼻尖形状、鼻翼宽度
   - 嘴唇：厚薄、唇弓弧度、自然静态表情
   - 皮肤：用精确修饰词描述色调（如"瓷白冷调"、"暖蜜金"、"深檀木色蓝调底"），质感（通透/哑光/粗粝），斑点/痣等
   - 整体：直接描述颜值定位——模特级美人、硬朗帅气、邻家亲切感？

3. 发型：精确颜色（色相+底调，如"蓝黑色带深靛蓝光泽"），相对于身体的长度，质地（笔直/大波浪/紧卷），样式（如何蓬起、垂落、运动），发饰。

4. 服装——主要造型（完整穿搭分解）：
   - 上装：款式、剪裁、材质（如"修身石灰色羊毛中山领外套"），颜色
   - 下装：裤/裙类型、材质、颜色
   - 鞋履：款式、材质
   - 外套/铠甲：如有，逐层描写
   - 配饰：首饰（金属、宝石、风格）、腰带、包袋、手套、帽子——务必具体

5. 武器与装备（如有）：
   - 近战武器：刃长、刃型、护手样式、握柄缠绕材质、表面处理（烤蓝/抛光/雕刻），携带方式
   - 远程武器：弓/枪类型、表面处理、改装细节
   - 护甲：材质（板甲/锁子甲/皮甲），表面处理，徽记或刻纹
   - 其他装备：描述功能和外观

6. 标志性特征：伤疤（位置、形状、新旧）、纹身（图案、位置）、眼镜（框型、镜片色调）、机械义体、非人类特征（耳、翼、角、尾）——描述精确的视觉外观。

7. 角色色彩调色板：列出3-5个定义此角色视觉身份的主色（如"深红、磨旧金、炭黑"）。

【示例】
赛博朋克风格，35mm广角镜头低角度——男，约30岁，190cm精瘦高挑身形，站立姿态，双脚与肩同宽微微前后错开，重心偏右腿，脊背微弓前倾，左手插在夹克口袋，右手自然垂在身侧。棱角分明的长脸，颧骨高耸投下锐利阴影，下颌线锋利笔直，眉骨突出。狭长上挑的丹凤眼，左眼瞳色自然灰绿、右眼为机械义眼散发幽蓝冷光，睫毛稀疏。高挺鹰钩鼻，鼻尖略下弯，鼻翼窄。薄唇苍白，唇角自然下垂。肤色病态苍白偏冷青调，质感哑光粗粝，左颊从眼角到嘴角一道细长的银色机械缝合疤痕，沿疤痕嵌有微型蓝色LED指示灯。阴郁危险的暗夜猎手气质。头发铂银白色带荧光紫挑染，右侧剃至3mm露出头皮上的电路纹身，左侧长发遮住半边脸垂至下巴，发梢参差不齐。上身破旧的哑光黑色合成皮夹克，立领，左肩焊接一块钛合金护甲片，内搭深灰色高科技速干背心，胸口印有褪色的红色骷髅标志。下身黑色工装机能裤，膝盖处缝有凯夫拉补丁，裤腿束入小腿处。脚穿磨损严重的黑色高帮军靴，鞋底加厚，鞋舌外翻。左前臂从手肘到手腕整段替换为钛合金机械义肢，关节处露出液压管线和微型齿轮，指尖是碳纤维材质。右手无名指戴一枚氧化发黑的钨钢戒指。腰后别一把折叠式等离子短刀，刀柄缠绕磨旧的红色伞绳。角色色彩调色板：哑光黑、铂银白、荧光紫、幽蓝冷光、锈红。`;

const CHAR_EXTRACT_WRITING_RULES = `═══ 书写规则 ═══
- 单段连续描写——description字段内不要使用项目符号或换行
- 要具体到让两个不同的AI图像生成器能生成辨认得出是同一个角色的图像
- 使用精确的颜色名：不要用"红色"而要用"血红"或"玫瑰粉"
- 颜值很重要——如果剧本暗示角色有吸引力，就写出真正惊艳的美感。使用高端时尚摄影和影视选角的专业语汇。
- 对非人类角色，以同样的解剖学精度描写其独特特征

═══ 姿态分层写入（关键——下游会生成四视图参考设定图）═══

**顶层规则**：下游会用 description 字段生成角色"四视图参考设定图"（正/3-4侧/侧/背），所以 description 里的姿态**必须是站立中性全身**，不能是戏中某个具体时刻的动作。

【description 字段里的姿态——必须严格按以下标准写】
- **必须站立**：站姿 / 自然站立全身 / 站立面向观众——禁止"蹲姿""坐姿""跪姿""趴姿""跃起"等非站立姿态
- **双脚位置**：与肩同宽自然站立 / 双脚并拢站立（仅当角色性格极度拘谨时）
- **身体朝向**：正面朝向观众（四视图正面视图的默认姿态）
- **双臂与手部**：自然垂于身侧 / 一手持武器一手自然下垂——禁止"双手紧握胸前""双手抱膝""双手撑地"等戏剧化动作
- **表情**：平静中性或微表情——禁止"惊恐仰望""大笑""痛哭"等强情绪表情
- **禁止抽象气质词**：不要只写"怯生生"、"高冷"、"优雅"——但要在中性站姿的前提下，用姿态的细节传递气质（例如"双肩微微前缩、头微低"传递怯懦；"挺直背脊、双手负后"传递高傲）

【标志性姿势/动作——写到 performanceStyle 字段】
角色在戏中的标志性动作（例如"蹲着攥住铁箍仰望"、"环抱双臂冷笑"、"拔剑出鞘"）**不要写到 description 里**，而是写到 performanceStyle 字段，例如：
- performanceStyle: "常见动作是蹲下身子缩成一团，双手紧紧攥住随身的铁箍放在胸前仰望说话者；动作幅度小、频繁低头、说话声音细若蚊蝇"

这样下游分镜生成时 LLM 能自动把这些标志性动作用到具体镜头的 motionScript 里，而角色设定图本身保持中性站立，可复用、可一致。

【姿态分层语法示例——仅演示结构，不要当成内容照抄；真实角色请严格按剧本内容改写】

❌ 错误模式（把戏中具体动作污染进 description）：
description: "……[蹲姿/跪姿/跃起/双手抱膝/双手撑地等戏剧化动作]……"

✅ 正确模式：
description: "……[中性站立姿态 + 双脚位置 + 身体朝向 + 双臂位置 + 微表情]……"
performanceStyle: "标志性动作：[角色在戏中常见的姿势/动作/情绪表达方式]"

【关键提醒——防止示例污染】
以上只是**语法结构示例**。你必须完全基于【剧本原文】中的角色身份、性别、年龄、外貌、服饰重新撰写 description，绝对不要从任何示例中复制人物设定（年龄/外貌/服饰/姿态描述词等）。你的输出必须与剧本中的实际角色一一对应。

${physicsRealismBlock()}`;

const CHAR_EXTRACT_LANGUAGE_RULES = `【关键语言规则】所有字段必须使用与剧本相同的语言。中文剧本 → 中文输出。英文剧本 → 英文输出。角色名必须与剧本中完全一致。

仅返回JSON数组。不要markdown。不要评论。`;

export const characterExtractDef: PromptDefinition = {
  key: "character_extract",
  nameKey: "promptTemplates.prompts.characterExtract",
  descriptionKey: "promptTemplates.prompts.characterExtractDesc",
  category: "character",
  slots: [
    slot("role_definition", CHAR_EXTRACT_ROLE_DEFINITION, true),
    slot("style_detection", CHAR_EXTRACT_STYLE_DETECTION, true),
    slot("output_format", CHAR_EXTRACT_OUTPUT_FORMAT, false),
    slot("scope_rules", CHAR_EXTRACT_SCOPE_RULES, true),
    slot(
      "description_requirements",
      CHAR_EXTRACT_DESCRIPTION_REQUIREMENTS,
      true
    ),
    slot("writing_rules", CHAR_EXTRACT_WRITING_RULES, true),
    slot("language_rules", CHAR_EXTRACT_LANGUAGE_RULES, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [
      r("role_definition"),
      "",
      r("style_detection"),
      "",
      r("output_format"),
      "",
      r("scope_rules"),
      "",
      r("description_requirements"),
      "",
      r("writing_rules"),
      "",
      r("language_rules"),
    ].join("\n");
  },
};

// ─── 5. import_character_extract ────────────────────────

const IMPORT_CHAR_ROLE_DEFINITION = `你是一位资深角色设计师、摄影指导和美术总监。你的任务是从给定文本中提取所有有名字的角色，估算出现频率，并为每个角色生成专业级视觉规格书。`;

const IMPORT_CHAR_EXTRACTION_RULES = `规则：
1. 提取文本中每一个被命名的角色
2. 统计每个角色的大致出现/被提及次数
3. 被提及2次以上的很可能是主要角色
4. 合并明显的别名（如"小明"和"明哥"指同一个人）

═══ 第一步——识别视觉风格 ═══
识别文本中声明或隐含的风格：
- "真人" / "写实" / "实拍" / 历史题材 → 按写实电影风格描写，不使用任何动漫美学。
- "动漫" / "漫画" / "anime" / "manga" → 按动漫比例、风格化特征描写。
- "3D CG" / "皮克斯" → 按3D渲染描写。
- 如未指定风格，根据内容推断（历史文本 → 写实历史正剧风格）。

═══ 描述要求 ═══
"description"字段必须是一段密集的段落，涵盖以下所有方面，以专业摄影指导的口吻书写：

0. 风格标签：以画风开头（如"电影级写实历史正剧风格，无滤镜，85mm镜头特写——"）
1. 【体态】：性别、表观年龄、身高/体型、姿态、气质
2. 【面部】：脸型、下颌线、眉骨、眼型/瞳色、鼻型、嘴唇、肤色（精确描述）、皮肤质感、颜值定位
3. 【发型】：精确颜色、长度、样式、发饰
4. 【服装】：完整穿搭分解——上装、下装、鞋履、外套、配饰，注明材质和颜色
5. 【武器/装备】（如有）：武器、铠甲、装备的详细描写
6. 【色彩调色板】：3-5个定义此角色视觉身份的主色

【示例】
电影级写实历史正剧风格，无滤镜，85mm镜头特写——男，约45岁，身高约178cm，体型魁梧厚实但不臃肿，站姿沉稳如山，双肩微微后展透出帝王威压。方正国字脸，颧骨高耸，下颌线刚硬如刀削，眉骨隆起投下深邃阴影。丹凤眼窄长上挑，瞳色极深近乎纯黑，目光阴鸷锐利如鹰隼。鼻梁高挺笔直，鼻尖略呈鹰钩，鼻翼不宽。薄唇紧抿，唇线下弯，自然流露出冷峻威严。肤色深麦色暖调，面部肌理粗粝，法令纹深刻，额角有隐约的岁月痕迹。属于令人畏惧的帝王级气场。花白短髯修剪齐整，头戴十二旒冕冠，黑色旒珠垂落遮挡部分面容。身穿明黄色龙袍，五爪金龙盘踞前胸，金线满绣云纹海水江崖纹，袖口镶赤金色回纹宽边。腰系白玉带钩嵌红宝石的御带。脚蹬黑色缎面朝靴。角色色彩调色板：明黄、赤金、纯黑、白玉色、深麦色。

═══ 视觉标识 ═══
"visualHint"字段必须是2-4个字的外貌标签，用于即时视觉识别（如"龙袍金冠阴沉脸"、"大红直身佩刀"）。必须描述外貌，不是动作。

【关键语言规则】所有输出字段必须使用与原文相同的语言。`;

const IMPORT_CHAR_OUTPUT_FORMAT = `输出格式——仅JSON对象，不要markdown代码块，不要评论：
{
  "characters": [
    {
      "name": "角色名，与文本中出现的一致",
      "frequency": 5,
      "description": "完整视觉规格——一段密集的段落，遵循以上所有要求",
      "visualHint": "2-4个字的外貌标识符"
    }
  ],
  "relationships": [
    {
      "characterA": "角色A名字",
      "characterB": "角色B名字",
      "relationType": "ally | enemy | lover | family | mentor | rival | stranger | neutral",
      "description": "简短关系描述"
    }
  ]
}

仅返回JSON对象。不要markdown。不要评论。`;

export const importCharacterExtractDef: PromptDefinition = {
  key: "import_character_extract",
  nameKey: "promptTemplates.prompts.importCharacterExtract",
  descriptionKey: "promptTemplates.prompts.importCharacterExtractDesc",
  category: "character",
  slots: [
    slot("role_definition", IMPORT_CHAR_ROLE_DEFINITION, true),
    slot("extraction_rules", IMPORT_CHAR_EXTRACTION_RULES, true),
    slot("output_format", IMPORT_CHAR_OUTPUT_FORMAT, false),
  ],
  buildFullPrompt(sc) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    return [r("role_definition"), "", r("extraction_rules"), "", r("output_format")].join("\n");
  },
};

// ─── 6. character_image ─────────────────────────────────

const CHAR_IMAGE_STYLE_MATCHING = `=== 关键：画风匹配（最高优先级）===
仔细阅读下方的角色描述。描述中指定或暗示了画风（如 动漫、漫画、写实照片级、卡通、水彩、像素风、油画 等）。
你必须精确匹配该画风。不要默认使用写实风格。不要覆盖描述中的风格。
- 如果描述中提到"动漫"/"漫画"/"anime"/"manga" → 生成动漫/漫画风格插画
- 如果描述中提到"写实"/"真人"/"photorealistic" → 生成写实渲染
- 如果描述暗示其他风格 → 忠实遵循该风格
- 如果完全未提及风格 → 根据角色的背景和类型推断最合适的风格

${themeStyleMappingBlock()}

**写作语言**：使用自然中文散文描述每个部分，不要权重语法 "（xx：1.99）"，不要结构化标签 "Scene:" "Style:"——Seedance/即梦 系图像模型对自然语言理解最强。`;

const CHAR_IMAGE_FACE_DETAIL = `=== 面部——高精度 ===
以适合所选画风的高精度渲染面部：
- 清晰一致的面部特征：骨骼结构、眼型、鼻型、嘴型——全部匹配描述中的外貌
- 眼睛：富有表现力、细节丰富、有高光反射和深度感——根据画风调整（动漫用动漫风格眼睛，写实用精细虹膜细节）
- 头发：清晰的发量、颜色和动态感，使用适合画风的渲染方式（写实用单根发丝，动漫用大块发束配高光条）
- 皮肤：符合画风的渲染——动漫用平滑赛璐珞着色，写实用毛孔级细节
- 整体：面部应具有辨识度和记忆点，有强烈的视觉特征`;

const CHAR_IMAGE_FOUR_VIEW_LAYOUT = `=== 四视图布局（必须严格遵守——这是角色设定集的核心输出形式）===
**强制输出四视图**：最终画面必须包含四个独立视角，从左到右水平排列在一张纯白画布上。**不要输出单视角肖像、不要只画两三个视角、不要把角色放在场景里**——这是一张专业的角色设定参考图（character turnaround sheet / 三视图 / 四视图）。

四个视角的精确要求（从左到右）：
1. **正面（Front / 0°）**——角色正对观众，肩膀平行画面，双臂自然放松垂于身侧，双脚与肩同宽自然站立，展示完整服装正面、腰带、武器挂件、胸前配饰。表情平静中性，便于后续衍生。
2. **四分之三侧面（3/4 View / 约 45°）**——角色向右旋转约 45°，展示面部立体深度、颧骨与鼻梁轮廓、侧前方服装结构与披风/外袍的层次。
3. **侧面轮廓（Profile / 90°）**——标准 90° 朝向画面右侧，清晰展示鼻子-下巴轮廓线、发型侧面体积、武器挂带位置、披风下摆、靴子侧面。
4. **背面（Back / 180°）**——完全背对观众，展示后脑发型与发饰、服装背部图案/绣纹、披风/斗篷全貌、背部装备（剑鞘、箭袋、背包等）。

**构图与画面组织要求**：
- 画面横向比例建议 16:9 或更宽，确保四个视角有充足的展示空间
- 画布背景必须是**纯白无纹理**，四个视角之间留适当间距，互不重叠
- 四个视角**头顶对齐、腰线对齐、脚底对齐**，整齐划一如专业设定集
- 统一景别——全部采用站立全身视图（从头顶到脚底，包含鞋/靴），便于服装和姿态的完整展示
- 如果角色手持武器，正面视图清晰展示持握方式，其他视角至少能看到武器的一部分`;

const CHAR_IMAGE_LIGHTING_RENDERING = `=== 光线与渲染 ===
- 干净的专业三点布光：主光从前上方约 45° 入射，补光从对侧柔化阴影，背后轮廓光（rim light）把角色从纯白背景里清晰"抠"出来
- 光线质感符合画风——写实风用柔和的摄影棚光，动漫风用清晰的赛璐珞明暗分界，仙侠风可加微妙体积光强化氛围
- 纯白背景无渐变、无纹理、无地面阴影（或极浅的接触影），确保角色清晰分离、方便后续抠图复用
- **四个视角必须保持完全一致的光线方向与色温**，避免出现"正面白天/侧面黄昏"的断裂感
- 在所选画风内追求最高渲染质量：材质细节、布料褶皱、金属反光、皮肤质感都要符合画风的技术标准`;

const CHAR_IMAGE_CONSISTENCY_RULES = `=== 四视角一致性（下游流水线的生死线）===
此参考图会被复用为后续所有镜头生成的权威参考——任何不一致都会在成片中放大成穿帮。严格执行：
- **身份一致**：四个视角必须是同一个人——相同的面孔骨架、相同的身高比例、相同的五官位置、相同的肤色
- **服装一致**：每一件衣物、配饰、腰带扣、纽扣、绣纹、口袋位置都逐一对齐，颜色值完全相同（不要正面深蓝背面浅蓝）
- **发型一致**：发色、发量、发长、刘海形状、发饰位置——四个视角可以看到不同侧面，但必须是同一个发型的不同角度
- **武器装备一致**：武器的颜色、长度、握把样式、挂载位置——正面挂在腰左侧，背面就要在腰左侧（从背后看就是右侧）
- **身材一致**：肩宽、腰围、腿长比例逐视图对齐，不要正面修长背面壮实
- **表情与气质一致**：四个视角都保持同一个中性/微表情，传达同一种性格气质（冷峻 / 温和 / 孤傲），不要有笑脸和怒脸混杂`;

// The name_label slot is locked because it is dynamically generated from the character name
const CHAR_IMAGE_NAME_LABEL = `=== 角色名标签 ===
{{NAME_LABEL_PLACEHOLDER}}`;

export type CharacterReferenceLayout = "single" | "three-view" | "four-view";

const CHARACTER_REFERENCE_LAYOUT_VALUES: CharacterReferenceLayout[] = [
  "single",
  "three-view",
  "four-view",
];

function normalizeCharacterReferenceLayout(
  value: unknown,
): CharacterReferenceLayout {
  if (
    typeof value === "string" &&
    (CHARACTER_REFERENCE_LAYOUT_VALUES as string[]).includes(value)
  ) {
    return value as CharacterReferenceLayout;
  }
  return "four-view";
}

const CHARACTER_LAYOUT_FORMAT: Record<CharacterReferenceLayout, string> = {
  single: "一张单角色全身立绘或肖像。纯白背景，角色居中、四肢可见、面部清晰可辨。",
  "three-view": "一张包含 3 个视角的横向排版设定图（正面 / 侧面 / 背面），纯白背景，三视图头顶/腰线/脚底对齐。",
  "four-view":
    "一张包含 4 个视角的 2x2 网格设定图（正面 / 四分之三侧面 / 侧面 / 背面），纯白背景，四视图头顶/腰线/脚底对齐。",
};

const CHARACTER_LAYOUT_VIEW_LABELS: Record<CharacterReferenceLayout, string> = {
  single: "一张全身立绘",
  "three-view": "3 个视角（正面 / 侧面 / 背面）",
  "four-view": "4 个视角（正面 / 四分之三侧面 / 侧面 / 背面）",
};

const CHARACTER_LAYOUT_NEGATIVE: Record<CharacterReferenceLayout, string> = {
  single: "不要出现其他视角、不要出现文字标签、不要出现场景背景。",
  "three-view":
    "不要输出单视角肖像、不要输出 4 视图（只能是 3 视图）、不要出现场景背景、不要出现文字标签以外的画面元素。",
  "four-view":
    "不要输出单视角肖像、不要输出 3 视图（只能是 4 视图）、不要出现场景背景、不要出现文字标签以外的画面元素。",
};

function characterLayoutBlock(layout: CharacterReferenceLayout): string {
  return `=== 视角布局 ===\n${CHARACTER_LAYOUT_FORMAT[layout]}\n${CHARACTER_LAYOUT_NEGATIVE[layout]}`;
}

export const characterImageDef: PromptDefinition = {
  key: "character_image",
  nameKey: "promptTemplates.prompts.characterImage",
  descriptionKey: "promptTemplates.prompts.characterImageDesc",
  category: "character",
  slots: [
    slot("style_matching", CHAR_IMAGE_STYLE_MATCHING, true),
    slot("face_detail", CHAR_IMAGE_FACE_DETAIL, true),
    slot("four_view_layout", CHAR_IMAGE_FOUR_VIEW_LAYOUT, true),
    slot("lighting_rendering", CHAR_IMAGE_LIGHTING_RENDERING, true),
    slot("consistency_rules", CHAR_IMAGE_CONSISTENCY_RULES, true),
    slot("name_label", CHAR_IMAGE_NAME_LABEL, false),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const characterName = (params?.characterName as string) ?? undefined;
    const description = (params?.description as string) ?? "";
    const layout = normalizeCharacterReferenceLayout(params?.referenceLayout);

    // Resolve name label dynamically — only multi-view layouts have name labels.
    let nameLabelText: string;
    if (layout === "single") {
      nameLabelText = `=== 角色名标签 ===\n无需角色名标签。`;
    } else if (characterName) {
      nameLabelText = `=== 角色名标签 ===\n在${CHARACTER_LAYOUT_VIEW_LABELS[layout]}布局下方居中显示角色名"${characterName}"。使用现代无衬线字体，白色背景上的深色文字，居中对齐。名字清晰可读，呈现专业设定集风格。`;
    } else {
      nameLabelText = `=== 角色名标签 ===\n无需角色名标签。`;
    }

    const header =
      layout === "single"
        ? `角色单张全身立绘——专业角色设计文档。`
        : `角色${CHARACTER_LAYOUT_VIEW_LABELS[layout]}参考设定图——专业角色设计文档。`;
    const contract =
      layout === "single"
        ? `**最终输出必须是${CHARACTER_LAYOUT_VIEW_LABELS[layout]}**，纯白背景，角色居中、四肢可见、面部清晰可辨。严禁输出多视角设定图、场景化插画或带文字的版本。`
        : `**最终输出必须是${CHARACTER_LAYOUT_VIEW_LABELS[layout]}的${layout === "three-view" ? "横向排版" : "2x2 排版"}设定图**，纯白背景，${layout === "three-view" ? "三" : "四"}个视角头顶/腰线/脚底对齐。严禁输出单视角肖像、场景化插画或只有两三个视角的半成品。`;

    return [
      header,
      contract,
      "",
      r("style_matching"),
      "",
      `=== 角色描述 ===`,
      `${characterName ? `名字: ${characterName}\n` : ""}${description}`,
      "",
      r("face_detail"),
      "",
      `=== 武器与装备（如有）===`,
      `- 以与角色相同的画风渲染所有武器、铠甲和装备`,
      `- 展示适合画风的材质细节：写实风要有使用痕迹，动漫/卡通风要有干净的风格化线条`,
      `- 所有装备必须与角色身体比例协调`,
      "",
      characterLayoutBlock(layout),
      "",
      r("four_view_layout"),
      "",
      r("lighting_rendering"),
      "",
      r("consistency_rules"),
      "",
      nameLabelText,
      "",
      `=== 最终输出标准 ===`,
      `专业角色设计参考${layout === "single" ? "立绘" : "设定图"}。在所选画风内达到最高质量。零AI瑕疵，视图之间零不一致。这是唯一的权威参考——所有后续生成的画面必须精确再现此角色的此风格。`,
    ].join("\n");
  },
};

export const characterImageSimpleDef: PromptDefinition = {
  key: "character_image_simple",
  nameKey: "promptTemplates.prompts.characterImageSimple",
  descriptionKey: "promptTemplates.prompts.characterImageSimpleDesc",
  category: "character",
  slots: [
    slot("style_and_format", `3D迪士尼动画风格，皮克斯式渲染，角色全身立绘，纯白背景，角色居中站立，不要出现任何文字标签。`, true),
    slot("character_info", `{{DESCRIPTION_PLACEHOLDER}}`, false),
  ],
  buildFullPrompt(sc, params) {
    const s = this.slots;
    const r = (k: string) => resolve(sc, s, k);
    const characterName = (params?.characterName as string) ?? undefined;
    const description = (params?.description as string) ?? "";
    const layout = normalizeCharacterReferenceLayout(params?.referenceLayout);
    const charInfo = `角色名：${characterName ?? ""}\n角色描述：${description}`;

    const styleAndFormat =
      layout === "single"
        ? `3D迪士尼动画风格，皮克斯式渲染，角色全身立绘，纯白背景，角色居中站立，不要出现任何文字标签，不要出现多个视角。`
        : layout === "three-view"
          ? `3D迪士尼动画风格，皮克斯式渲染，角色三视图设定图（正面/侧面/背面）水平排版，纯白背景，三视图对齐，不要出现其他元素。`
          : `3D迪士尼动画风格，皮克斯式渲染，角色四视图设定图（正面/四分之三侧面/侧面/背面）2x2 网格，纯白背景，四视图对齐，不要出现其他元素。`;

    return `${styleAndFormat}\n\n${charInfo}`;
  },
};

// ─── 7. character_image_ideogram4 ─────────────────────────

export const characterImageIdeogram4Def: PromptDefinition = {
  key: "character_image_ideogram4",
  nameKey: "promptTemplates.prompts.characterImageIdeogram4",
  descriptionKey: "promptTemplates.prompts.characterImageIdeogram4Desc",
  category: "character",
  slots: [
    slot("style_description", "", true),
    slot("character_info", `{{DESCRIPTION_PLACEHOLDER}}`, false),
  ],
  buildFullPrompt(sc, params) {
    const characterName = (params?.characterName as string) ?? "";
    const rawDescription = (params?.description as string) ?? "";
    const description = /[\u4e00-\u9fff]/.test(rawDescription) ? "" : rawDescription;
    const layout = normalizeCharacterReferenceLayout(params?.referenceLayout);

    type IdeogramElement = {
      type: "obj";
      bbox: [number, number, number, number];
      desc: string;
      color_palette: string[];
    };

    let highLevel: string;
    let medium: string;
    let elements: IdeogramElement[];
    if (layout === "single") {
      highLevel = `${characterName} character portrait, full body, standing centered on white background, single view, professional character design presentation. ${description}`;
      medium = "3D character portrait, single view, professional character design presentation";
      elements = [
        {
          type: "obj",
          bbox: [10, 10, 990, 990],
          desc: `${characterName} full body portrait, standing centered, facing camera, symmetrical pose, white background.`,
          color_palette: ["#FFFFFF", "#E0E0E0", "#C0C0C0"],
        },
      ];
    } else if (layout === "three-view") {
      highLevel = `${characterName} three-view turnaround sheet, full body, three views (front / side / back) in horizontal strip on white background. ${description}`;
      medium = "3D character model turnaround sheet, three views, professional character design presentation";
      elements = [
        {
          type: "obj",
          bbox: [10, 10, 333, 990],
          desc: `Front view of ${characterName} facing camera, full body, standing centered, symmetrical pose, white background.`,
          color_palette: ["#FFFFFF", "#E0E0E0", "#C0C0C0"],
        },
        {
          type: "obj",
          bbox: [343, 10, 656, 990],
          desc: `Side profile of ${characterName} facing right, full body profile, clear silhouette, white background.`,
          color_palette: ["#FFFFFF", "#E0E0E0", "#C0C0C0"],
        },
        {
          type: "obj",
          bbox: [666, 10, 990, 990],
          desc: `Back view of ${characterName}, dorsal side, full body from behind, white background.`,
          color_palette: ["#FFFFFF", "#E0E0E0", "#C0C0C0"],
        },
      ];
    } else {
      highLevel = `${characterName} turnaround sheet, full body, four views in 2x2 grid on white background. ${description}`;
      medium = "3D character model turnaround sheet, professional character design presentation";
      elements = [
        {
          type: "obj",
          bbox: [10, 10, 490, 490],
          desc: `Front view of ${characterName} facing camera, full body, standing centered, symmetrical pose, white background.`,
          color_palette: ["#FFFFFF", "#E0E0E0", "#C0C0C0"],
        },
        {
          type: "obj",
          bbox: [510, 10, 990, 490],
          desc: `Back view of ${characterName}, dorsal side, full body from behind, white background.`,
          color_palette: ["#FFFFFF", "#E0E0E0", "#C0C0C0"],
        },
        {
          type: "obj",
          bbox: [10, 510, 490, 990],
          desc: `Side profile of ${characterName}, facing left, full body profile, white background.`,
          color_palette: ["#FFFFFF", "#E0E0E0", "#C0C0C0"],
        },
        {
          type: "obj",
          bbox: [510, 510, 990, 990],
          desc: `Three-quarter view of ${characterName}, rotated approximately 45 degrees, showing facial depth and three-dimensional form, white background.`,
          color_palette: ["#FFFFFF", "#E0E0E0", "#C0C0C0"],
        },
      ];
    }

    const prompt = {
      high_level_description: highLevel,
      style_description: {
        aesthetics: "3D Disney-Pixar animation style, soft global illumination, exaggerated proportions, smooth organic curves, clean high-saturation materials, cel-shaded lighting with subsurface scattering skin texture",
        lighting: "Soft diffused studio lighting, even illumination, no harsh shadows, pure white background",
        medium,
        color_palette: ["#FFFFFF", "#E0E0E0", "#C0C0C0"],
      },
      compositional_deconstruction: {
        background: "Pure white seamless background, clean studio lighting",
        elements,
      },
    };

    return JSON.stringify(prompt, null, 2);
  },
};

// ─── 8. character_image_hidream_o1 ───────────────────────

export const characterImageHiDreamO1Def: PromptDefinition = {
  key: "character_image_hidream_o1",
  nameKey: "promptTemplates.prompts.characterImageHiDreamO1",
  descriptionKey: "promptTemplates.prompts.characterImageHiDreamO1Desc",
  category: "character",
  slots: [
    slot("style_description", "", true),
    slot("character_info", `{{DESCRIPTION_PLACEHOLDER}}`, false),
  ],
  buildFullPrompt(sc, params) {
    const characterName = (params?.characterName as string) ?? "";
    const rawDescription = (params?.description as string) ?? "";
    const layout = normalizeCharacterReferenceLayout(params?.referenceLayout);

    let header: string;
    let layoutBlock: string;
    if (layout === "single") {
      header = "Character single-portrait reference — professional character design asset.";
      layoutBlock = `Layout: A single full-body portrait of the character centered on a pure white background.
- Single front-facing full-body pose, standing centered, symmetrical stance, complete outfit and accessories visible.
- No additional views, no name label, no text overlay.
- Clean professional three-point lighting, pure white background, no shadows.`;
    } else if (layout === "three-view") {
      header = "Character three-view turnaround sheet — professional character design reference.";
      layoutBlock = `Layout: A single image containing exactly three views of the character arranged in a horizontal strip on pure white background:
- Left: Front view — character facing forward, full body, standing centered, symmetrical pose, showing complete outfit and accessories.
- Middle: Side profile — facing right, full body profile, clear silhouette showing nose-chin line and side costume detail.
- Right: Back view — dorsal side, full body from behind, showing hairstyle back detail and clothing rear.
- The character name "${characterName}" is printed centered below the strip in clean sans-serif text.

All three views must be perfectly aligned at the head top and foot bottom. Same lighting direction and intensity across all three views. Clean professional three-point lighting, pure white background, no shadows.`;
    } else {
      header = "Character four-view turnaround sheet — professional character design reference.";
      layoutBlock = `Layout: A single image containing exactly four views of the character arranged in a 2x2 grid on pure white background:
- Top-left: Front view — character facing forward, full body, standing centered, symmetrical pose, showing complete outfit and accessories.
- Top-right: Back view — dorsal side, full body from behind, showing hairstyle back detail and clothing rear.
- Bottom-left: Side profile — facing right, full body profile, clear silhouette showing nose-chin line and side costume detail.
- Bottom-right: Three-quarter view — rotated approximately 45 degrees, showing facial depth and three-dimensional form.
- The character name "${characterName}" is printed centered below the grid in clean sans-serif text.

All four views must be perfectly aligned at the head top and foot bottom. Same lighting direction and intensity across all four views. Clean professional three-point lighting, pure white background, no shadows.`;
    }

    const prompt = `${header}

Character name: ${characterName}

Character description: ${rawDescription}

${layoutBlock}

Render with highest quality, rich detail in fabric texture, skin surface, and material properties. Consistent character identity across all views — same face, same proportions, same outfit colors, same expression.`;

    return prompt;
  },
};

