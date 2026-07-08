import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON, resolveLanguageModelConfig, resolveLanguageModelConfigs, supportsOpenAIJsonMode } from "@/lib/ai/ai-sdk";
import type { ProviderConfig } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { addImportLog, chunkText } from "@/lib/import-utils";
import {
  type StoryAssetAnalysis,
  type StoryMetaAnalysis,
} from "@/lib/asset-agent/analyze-script-assets";

export const maxDuration = 300;

interface ReviewIssue {
  category: "prohibited" | "logic" | "continuity" | "setting" | "other";
  severity: "high" | "medium" | "low";
  title: string;
  exactQuote: string;
  explanation: string;
  suggestion: string;
  replacement: string;
  replaceMode?: "first" | "all";
}

interface SensitiveTerm {
  term: string;
  replacement: string;
  severity: ReviewIssue["severity"];
  group: string;
  reason: string;
}

type ParsedReviewJson = { issues?: Partial<ReviewIssue>[] } | Partial<ReviewIssue>[];

const DEFAULT_REVIEW_CONCURRENCY = 3;
const MAX_REVIEW_CONCURRENCY = 6;

const SENSITIVE_TERMS: SensitiveTerm[] = [
  { term: "国徽", replacement: "虚构徽记", severity: "high", group: "国家标识/机关标志", reason: "涉及国家标志和机关形象" },
  { term: "国旗", replacement: "虚构旗帜", severity: "high", group: "国家标识/机关标志", reason: "涉及国家标志和机关形象" },
  { term: "党徽", replacement: "虚构标识", severity: "high", group: "国家标识/机关标志", reason: "涉及国家标志和机关形象" },
  { term: "军徽", replacement: "虚构单位标识", severity: "high", group: "国家标识/机关标志", reason: "容易生成真实军警政法标识" },
  { term: "警徽", replacement: "虚构单位标识", severity: "high", group: "国家标识/机关标志", reason: "容易生成真实执法标识" },
  { term: "法院徽", replacement: "虚构单位标识", severity: "high", group: "国家标识/机关标志", reason: "涉及真实司法机关形象" },
  { term: "检察徽", replacement: "虚构单位标识", severity: "high", group: "国家标识/机关标志", reason: "涉及真实司法机关形象" },
  { term: "真实部队番号", replacement: "虚构单位编号", severity: "high", group: "国家标识/机关标志", reason: "涉及真实部队体系" },
  { term: "军区", replacement: "训练基地", severity: "high", group: "军队/国防/国家安全", reason: "军事、国防和国家安全属于高敏题材" },
  { term: "军门", replacement: "名门", severity: "high", group: "军队/国防/国家安全", reason: "弱化真实军事体系和特权背书" },
  { term: "部队", replacement: "单位", severity: "high", group: "军队/国防/国家安全", reason: "军事体系表述需谨慎" },
  { term: "军营", replacement: "训练基地", severity: "high", group: "军队/国防/国家安全", reason: "军事场景需避免真实化" },
  { term: "军装", replacement: "制服", severity: "high", group: "军队/国防/国家安全", reason: "AI画面容易生成军徽肩章等敏感标识" },
  { term: "军官", replacement: "负责人", severity: "high", group: "军队/国防/国家安全", reason: "真实军职和军队形象高敏" },
  { term: "首长", replacement: "领导", severity: "high", group: "军队/国防/国家安全", reason: "真实军政称谓高敏" },
  { term: "司令", replacement: "负责人", severity: "high", group: "军队/国防/国家安全", reason: "真实军职称谓高敏" },
  { term: "政委", replacement: "负责人", severity: "high", group: "军队/国防/国家安全", reason: "真实军职称谓高敏" },
  { term: "特种兵", replacement: "专业安保人员", severity: "high", group: "军队/国防/国家安全", reason: "军事行动和特殊兵种高敏" },
  { term: "空军", replacement: "飞行团队", severity: "high", group: "军队/国防/国家安全", reason: "真实军种表述高敏" },
  { term: "试飞", replacement: "飞行测试", severity: "high", group: "军队/国防/国家安全", reason: "国防军工和涉密任务风险高" },
  { term: "绝密任务", replacement: "重要任务", severity: "high", group: "军队/国防/国家安全", reason: "涉密任务细节风险高" },
  { term: "军事基地", replacement: "训练基地", severity: "high", group: "军队/国防/国家安全", reason: "真实军事场景高敏" },
  { term: "军用直升机", replacement: "直升机", severity: "high", group: "军队/国防/国家安全", reason: "军用装备描写高敏" },
  { term: "军功章", replacement: "表彰", severity: "high", group: "军队/国防/国家安全", reason: "具体军队荣誉授予风险高" },
  { term: "一等功", replacement: "重要表彰", severity: "high", group: "军队/国防/国家安全", reason: "具体军功等级风险高" },
  { term: "派出所", replacement: "相关部门", severity: "high", group: "公安/司法/执法", reason: "公安司法属于特殊题材" },
  { term: "公安局", replacement: "相关部门", severity: "high", group: "公安/司法/执法", reason: "公安司法属于特殊题材" },
  { term: "警察", replacement: "工作人员", severity: "medium", group: "公安/司法/执法", reason: "真实执法形象和流程需谨慎" },
  { term: "抓捕", replacement: "依法处理", severity: "medium", group: "公安/司法/执法", reason: "避免展示执法流程细节" },
  { term: "审讯室", replacement: "调查室", severity: "high", group: "公安/司法/执法", reason: "审讯流程和司法细节风险高" },
  { term: "判刑", replacement: "受到处罚", severity: "medium", group: "公安/司法/执法", reason: "司法结果应克制概括" },
  { term: "入狱", replacement: "被依法处理", severity: "medium", group: "公安/司法/执法", reason: "司法流程需避免细节化" },
  { term: "越狱", replacement: "逃离看管", severity: "high", group: "公安/司法/执法", reason: "违法犯罪方法和司法漏洞风险高" },
  { term: "保释", replacement: "暂时离开", severity: "medium", group: "公安/司法/执法", reason: "司法程序表述容易不准确" },
  { term: "通缉", replacement: "被追查", severity: "medium", group: "公安/司法/执法", reason: "执法流程需谨慎" },
  { term: "犯罪团伙", replacement: "不法人员", severity: "high", group: "公安/司法/执法", reason: "犯罪组织描写需弱化" },
  { term: "黑社会", replacement: "不法势力", severity: "high", group: "公安/司法/执法", reason: "涉黑内容高敏" },
  { term: "邪教", replacement: "非法组织", severity: "high", group: "政治/历史/民族宗教", reason: "宗教极端和邪教内容高敏" },
  { term: "血浆", replacement: "受伤痕迹", severity: "high", group: "暴力血腥/恐怖惊悚", reason: "血腥恐怖画面需降级" },
  { term: "肢解", replacement: "严重伤害", severity: "high", group: "暴力血腥/恐怖惊悚", reason: "血腥暴力描写高危" },
  { term: "剖腹", replacement: "严重受伤", severity: "high", group: "暴力血腥/恐怖惊悚", reason: "血腥暴力描写高危" },
  { term: "割喉", replacement: "袭击", severity: "high", group: "暴力血腥/恐怖惊悚", reason: "血腥暴力描写高危" },
  { term: "自焚", replacement: "极端行为", severity: "high", group: "暴力血腥/恐怖惊悚", reason: "强刺激和模仿风险高" },
  { term: "炸弹", replacement: "危险物", severity: "high", group: "暴力血腥/恐怖惊悚", reason: "危害公共安全风险高" },
  { term: "虐杀", replacement: "伤害", severity: "high", group: "暴力血腥/恐怖惊悚", reason: "血腥暴力描写高危" },
  { term: "碎尸", replacement: "严重伤害", severity: "high", group: "暴力血腥/恐怖惊悚", reason: "血腥暴力描写高危" },
  { term: "烧死", replacement: "事故身亡", severity: "high", group: "暴力血腥/恐怖惊悚", reason: "死亡方式过于刺激" },
  { term: "撞死", replacement: "意外离世", severity: "high", group: "暴力血腥/恐怖惊悚", reason: "死亡方式过于直接刺激" },
  { term: "全身瘫痪", replacement: "身体严重受创", severity: "medium", group: "暴力血腥/身体羞辱", reason: "避免残障污名和强刺激表达" },
  { term: "精神病院", replacement: "接受治疗", severity: "medium", group: "暴力血腥/身体羞辱", reason: "避免精神疾病污名化" },
  { term: "下药", replacement: "设计陷害", severity: "high", group: "犯罪方法/违法交易", reason: "避免传授犯罪方法" },
  { term: "下泻药", replacement: "做手脚", severity: "high", group: "犯罪方法/违法交易", reason: "避免传授犯罪方法" },
  { term: "投毒", replacement: "暗中陷害", severity: "high", group: "犯罪方法/违法交易", reason: "避免传授犯罪方法" },
  { term: "绑架", replacement: "挟持", severity: "high", group: "犯罪方法/违法交易", reason: "犯罪行为需弱化，避免流程细节" },
  { term: "勒索", replacement: "威胁索要", severity: "high", group: "犯罪方法/违法交易", reason: "犯罪行为需弱化" },
  { term: "高利贷", replacement: "债务纠纷", severity: "medium", group: "犯罪方法/违法交易", reason: "违法交易和催收细节风险高" },
  { term: "卖人抵债", replacement: "逼迫还债", severity: "high", group: "犯罪方法/违法交易", reason: "违法交易和人口买卖风险高" },
  { term: "伪造病历", replacement: "编造材料", severity: "high", group: "犯罪方法/违法交易", reason: "避免具体违法方法" },
  { term: "破坏飞机零件", replacement: "在设备上做手脚", severity: "high", group: "犯罪方法/违法交易", reason: "危害公共安全和具体犯罪方法风险高" },
  { term: "偷公款", replacement: "挪用款项", severity: "medium", group: "犯罪方法/违法交易", reason: "违法行为需克制概括" },
  { term: "倒卖零件", replacement: "违规处理物资", severity: "medium", group: "犯罪方法/违法交易", reason: "违法交易需弱化" },
  { term: "洞房", replacement: "新婚夜", severity: "high", group: "色情低俗/性暗示", reason: "低俗和性暗示风险高" },
  { term: "听墙角", replacement: "偷听", severity: "high", group: "色情低俗/性暗示", reason: "低俗窥私表达风险高" },
  { term: "按在墙上", replacement: "靠近她", severity: "medium", group: "色情低俗/性暗示", reason: "容易形成擦边画面" },
  { term: "眼神拉丝", replacement: "眼神温柔", severity: "medium", group: "色情低俗/性暗示", reason: "擦边表达需弱化" },
  { term: "造人", replacement: "准备要孩子", severity: "high", group: "色情低俗/性暗示", reason: "性暗示表达需替换" },
  { term: "呻吟", replacement: "低声回应", severity: "high", group: "色情低俗/性暗示", reason: "性暗示表达高危" },
  { term: "叫床", replacement: "夜里声响", severity: "high", group: "色情低俗/性暗示", reason: "低俗性暗示高危" },
  { term: "强吻", replacement: "突然靠近", severity: "high", group: "色情低俗/性暗示", reason: "非自愿亲密行为风险高" },
  { term: "包养", replacement: "利益关系", severity: "high", group: "色情低俗/性暗示", reason: "不良婚恋和性交易导向风险高" },
  { term: "卖淫嫖娼", replacement: "违法交易", severity: "high", group: "色情低俗/性暗示", reason: "性交易内容高危" },
  { term: "绝嗣", replacement: "被传身体状况不适合婚育", severity: "medium", group: "婚育歧视/身体羞辱", reason: "生育羞辱和歧视表达" },
  { term: "不下蛋的母鸡", replacement: "被刻薄地羞辱", severity: "high", group: "婚育歧视/身体羞辱", reason: "严重性别和生育羞辱" },
  { term: "易孕体质", replacement: "身体调养较好", severity: "medium", group: "婚育歧视/身体羞辱", reason: "生育神化和物化表达" },
  { term: "极品易孕", replacement: "身体调养较好", severity: "high", group: "婚育歧视/身体羞辱", reason: "生育神化和低俗表达" },
  { term: "残废", replacement: "行动不便", severity: "medium", group: "婚育歧视/身体羞辱", reason: "身体羞辱和残障污名" },
  { term: "废物", replacement: "没用的人", severity: "low", group: "婚育歧视/身体羞辱", reason: "羞辱性表达，可按剧情弱化" },
  { term: "短命鬼", replacement: "身体不好的人", severity: "medium", group: "婚育歧视/身体羞辱", reason: "身体羞辱和诅咒表达" },
  { term: "丧门星", replacement: "扫兴的人", severity: "medium", group: "婚育歧视/身体羞辱", reason: "辱骂和迷信色彩表达" },
  { term: "神医", replacement: "医术不错", severity: "medium", group: "医疗神化/虚假功效", reason: "医疗功效神化风险" },
  { term: "国宝级神医", replacement: "经验丰富的医者", severity: "high", group: "医疗神化/虚假功效", reason: "医疗夸大和权威背书风险" },
  { term: "灵泉", replacement: "调养方法", severity: "medium", group: "医疗神化/虚假功效", reason: "超自然和医疗功效神化风险" },
  { term: "包治百病", replacement: "辅助调养", severity: "high", group: "医疗神化/虚假功效", reason: "虚假医疗功效高危" },
  { term: "起死回生", replacement: "转危为安", severity: "high", group: "医疗神化/虚假功效", reason: "医疗神化和超自然表达高危" },
  { term: "针灸救命", replacement: "及时处理", severity: "high", group: "医疗神化/虚假功效", reason: "医疗功效夸大风险" },
  { term: "非遗传人证书", replacement: "传统技艺证明", severity: "medium", group: "医疗神化/虚假功效", reason: "权威背书需谨慎" },
  { term: "药企神药", replacement: "合规药品", severity: "high", group: "医疗神化/虚假功效", reason: "医疗广告和虚假功效风险" },
  { term: "重生", replacement: "梦境记忆", severity: "medium", group: "封建迷信/超自然外挂", reason: "超自然设定需避免现实有效暗示" },
  { term: "前世", replacement: "梦中记忆", severity: "medium", group: "封建迷信/超自然外挂", reason: "超自然设定需弱化为幻想" },
  { term: "灵泉空间", replacement: "特殊调养空间", severity: "medium", group: "封建迷信/超自然外挂", reason: "超自然外挂和医疗神化风险" },
  { term: "锦鲤", replacement: "好运气", severity: "low", group: "封建迷信/超自然外挂", reason: "迷信色彩表达" },
  { term: "阎王爷也带不走", replacement: "一定能撑过去", severity: "medium", group: "封建迷信/超自然外挂", reason: "迷信和死亡戏谑表达" },
  { term: "命格", replacement: "性格和选择", severity: "medium", group: "封建迷信/超自然外挂", reason: "算命改命类表达风险" },
  { term: "附身", replacement: "意识混乱", severity: "medium", group: "封建迷信/超自然外挂", reason: "超自然迷信表达" },
  { term: "算命改命", replacement: "重新选择人生", severity: "medium", group: "封建迷信/超自然外挂", reason: "宣扬迷信风险" },
  { term: "京圈大佬", replacement: "事业有成的人", severity: "medium", group: "拜金炫富/不良价值", reason: "阶层崇拜和特权叙事风险" },
  { term: "高干子弟", replacement: "家世优越", severity: "medium", group: "拜金炫富/不良价值", reason: "特权背书风险" },
  { term: "首富", replacement: "事业成功的人", severity: "low", group: "拜金炫富/不良价值", reason: "过度拜金和炫富需克制" },
  { term: "金条", replacement: "礼物", severity: "medium", group: "拜金炫富/不良价值", reason: "炫富表达需弱化" },
  { term: "港交所敲钟", replacement: "公司上市", severity: "medium", group: "拜金炫富/不良价值", reason: "真实金融场景和炫富表达需谨慎" },
  { term: "包下庄园", replacement: "举办纪念仪式", severity: "medium", group: "拜金炫富/不良价值", reason: "过度炫富风险" },
  { term: "全网直播世纪婚礼", replacement: "举办婚礼", severity: "medium", group: "拜金炫富/不良价值", reason: "炫富和流量化婚恋表达需弱化" },
  { term: "AI真人", replacement: "AI生成内容", severity: "medium", group: "AI生成与平台标识", reason: "AI生成内容需显著标识，不得冒充真人" },
  { term: "虚拟角色", replacement: "AI生成角色", severity: "low", group: "AI生成与平台标识", reason: "需按平台要求标识AI生成" },
  { term: "仿真人声", replacement: "AI生成音色", severity: "medium", group: "AI生成与平台标识", reason: "不得混淆真实人声" },
  { term: "换脸", replacement: "AI合成画面", severity: "high", group: "AI生成与平台标识", reason: "深度合成和肖像风险高" },
  { term: "拟真新闻", replacement: "虚构资讯画面", severity: "high", group: "AI生成与平台标识", reason: "不得冒充真实新闻" },
  { term: "真实人物肖像", replacement: "虚构人物形象", severity: "high", group: "AI生成与平台标识", reason: "真实人物肖像和深度合成风险" },
];

const REVIEW_SYSTEM = `你是专业短剧/AI漫剧剧本审核编辑，负责在资产设定前审阅剧本。

重点检查：
1. 敏感词和平台风险表达：国家标识、军警政法、真实机关、军事国防、公安司法、政治历史民族宗教、暴力血腥、犯罪方法、色情低俗、婚育歧视、医疗神化、封建迷信、拜金炫富、未成年人风险、AI生成标识风险。
2. 剧情逻辑不合理：因果缺失、动机突兀、关键事件没有铺垫、角色行为不符合已有设定。
3. 连续性问题：角色死亡后无解释复活、入狱后无交代突然出现、地点/身份/关系/能力前后矛盾。
4. 设定凭空出现：关键道具、能力、背景身份、组织关系、世界观规则没有提前交代。
5. 给出可一键替换的局部文本，优先保留原剧情意图，只做降敏、补铺垫或逻辑修复。

敏感词参考方向：
- 国家标识/机关标志：国徽、国旗、党徽、军徽、警徽、法院徽、检察徽、真实机关牌匾、真实部队番号、真实警号。
- 军队/国防/国家安全：军区、军门、部队、军营、军装、军官、首长、司令、政委、特种兵、空军、试飞、绝密任务、军事基地、军用直升机、军功章、一等功、国家财产。
- 公安/司法/执法：派出所、公安局、警察、抓捕、审讯室、判刑、入狱、越狱、保释、通缉、犯罪团伙、黑社会。
- 暴力血腥/犯罪方法：血浆、肢解、剖腹、割喉、自焚、炸弹、虐杀、碎尸、烧死、撞死、下药、投毒、绑架、勒索、高利贷、伪造病历、破坏飞机零件、倒卖零件。
- 色情低俗/婚育羞辱：洞房、听墙角、按在墙上、眼神拉丝、造人、呻吟、叫床、强吻、包养、绝嗣、不下蛋的母鸡、极品易孕、残废、废物、短命鬼、丧门星。
- 医疗神化/迷信超自然：神医、国宝级神医、灵泉、包治百病、起死回生、针灸救命、重生、前世、灵泉空间、锦鲤、阎王爷也带不走、命格、附身、算命改命。
- 拜金炫富/AI标识：京圈大佬、高干子弟、首富、金条、港交所敲钟、包下庄园、全网直播世纪婚礼、AI真人、仿真人声、换脸、拟真新闻、真实人物肖像。

要求：
- 只输出一个有效 JSON object，严禁输出 markdown、标题、表格、代码块、解释性前后缀。
- 如果没有问题，必须返回 {"issues":[]}，不要写审阅报告。
- exactQuote 必须是剧本文本中连续出现的原文片段，尽量控制在 15 到 120 字。
- replacement 必须是可直接替换 exactQuote 的文本。
- 如果问题需要人工判断、无法直接改写，replacement 填写与 exactQuote 完全相同的原文，并在 suggestion 中说明“需人工处理”。
- 不要虚构剧本中不存在的原文。
- 每个分块最多返回 8 个最重要的问题。

JSON 格式：
{
  "issues": [
    {
      "category": "prohibited|logic|continuity|setting|other",
      "severity": "high|medium|low",
      "title": "简短标题",
      "exactQuote": "剧本中的连续原文",
      "explanation": "为什么这里有问题",
      "suggestion": "建议怎么改",
      "replacement": "用于一键替换的文本"
    }
  ]
}`;

const STORY_ASSET_ANALYSIS_SYSTEM = `你是短剧/AI漫剧的剧本资产解析师。你要从完整剧本中抽取后续生成人物、场景、物品和统一视觉提示词所需的结构化信息。

核心判断规则：
- characters 只收录真实可复用人物资产。不要把“今生、前世、初期、中期、高潮、背景、性格、人物弧光、题材标签、男主角、女主角、黄金配角”等字段名/阶段名/角色类型当人物。
- “老板、民警、团长、医生、护士、前夫、婆婆”等泛称默认不要收录，除非剧本把它作为一个稳定反复出现的具体角色且没有姓名。
- scenes 只收录物理场景/地点/空间，例如“医院、沈家客厅、盘山公路”。不要收录剧情事件，例如“医院抓奸、医院确诊双胞胎、飙车去医院抱住老婆”；遇到这类表达，应归并成其中的物理地点“医院”。
- props 只收录实体物品/道具，不收录抽象概念、剧情标签、情绪、人物关系。
- storyMeta 要给后续所有生图提示词复用，简洁稳定，不要剧透式复述长剧情。

只输出一个有效 JSON object，严禁输出 markdown、代码块、解释性前后缀。`;

function buildReviewPrompt(chunk: string, index: number, total: number) {
  return `请审阅下面剧本分块，找出需要人工审核和可一键替换的问题。
分块：${index + 1}/${total}

返回要求再次强调：
- 只能返回 JSON object，第一字符必须是 {，最后字符必须是 }。
- 不要 Markdown 标题、列表、表格、代码围栏或自然语言说明。
- JSON 顶层只能包含 issues 字段。

剧本文本：
${chunk}`;
}

function buildStoryAssetAnalysisPrompt(text: string) {
  return `请解析下面剧本，输出故事元信息和资产草稿。

返回 JSON 格式：
{
  "storyMeta": {
    "time": "故事时间/年代/季节/昼夜倾向，不确定则写空字符串",
    "background": "世界观、职业背景、社会关系背景",
    "visualStyleBase": "统一视觉提示词基底，用于人物/场景/物品生图",
    "genre": "题材类型",
    "locationBackground": "主要地域或空间背景"
  },
  "assets": {
    "characters": [
      { "name": "真实人物姓名", "role": "男主角|女主角|主角|男配角|女配角|反派角色|配角", "description": "外形/身份/性格/关系摘要" }
    ],
    "scenes": [
      { "name": "物理地点或空间名", "type": "医疗场景|居住空间|道路|办公场景|其他", "description": "空间特征和剧情用途" }
    ],
    "props": [
      { "name": "实体物品名", "type": "通讯道具|文件|医疗物资|车辆|饰品|其他", "description": "物品用途和视觉特征" }
    ]
  }
}

数量建议：characters 最多 60 个，scenes 最多 80 个，props 最多 80 个。请尽量详细罗列剧本中可复用的具名人物、明确物理地点和有叙事功能的实体道具，但不要误收字段名、剧情事件、抽象概念。

剧本文本：
${text}`;
}

function normalizeIssue(issue: Partial<ReviewIssue>): ReviewIssue | null {
  const exactQuote = String(issue.exactQuote || "").trim();
  const replacement = String(issue.replacement || "").trim();
  const title = String(issue.title || "").trim();
  if (!exactQuote || !replacement || !title) return null;

  const categoryValues = new Set(["prohibited", "logic", "continuity", "setting", "other"]);
  const severityValues = new Set(["high", "medium", "low"]);

  return {
    category: categoryValues.has(String(issue.category)) ? issue.category as ReviewIssue["category"] : "other",
    severity: severityValues.has(String(issue.severity)) ? issue.severity as ReviewIssue["severity"] : "medium",
    title,
    exactQuote,
    explanation: String(issue.explanation || "").trim(),
    suggestion: String(issue.suggestion || "").trim(),
    replacement,
    replaceMode: issue.replaceMode === "all" ? "all" : "first",
  };
}

class ReviewJsonParseError extends Error {
  readonly snippet: string;

  constructor(message: string, snippet: string) {
    super(message);
    this.name = "ReviewJsonParseError";
    this.snippet = snippet;
  }
}

function hasUnescapedQuote(value: string) {
  let escaped = false;
  for (const ch of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") return true;
  }
  return false;
}

function repairJsonStringLines(json: string) {
  return json
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(\s*"[^"]+"\s*:\s*")([\s\S]*?)\s*$/);
      if (!match) return line;

      const [, prefix, value] = match;
      if (!value || hasUnescapedQuote(value)) return line;

      const commaMatch = value.match(/^(.*?)(,?)$/);
      if (!commaMatch) return line;

      return `${prefix}${commaMatch[1]}"${commaMatch[2]}`;
    })
    .join("\n");
}

function escapeLooseStringQuotes(json: string) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (!inString) {
      if (ch === "\"") inString = true;
      result += ch;
      continue;
    }

    if (escaped) {
      escaped = false;
      result += ch;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      result += ch;
      continue;
    }

    if (ch === "\"") {
      let nextIndex = i + 1;
      while (nextIndex < json.length && /\s/.test(json[nextIndex])) {
        nextIndex++;
      }
      const next = json[nextIndex];
      const isClosingQuote = next === ":" || next === "," || next === "}" || next === "]" || next === undefined;

      if (isClosingQuote) {
        inString = false;
        result += ch;
      } else {
        result += "\\\"";
      }
      continue;
    }

    result += ch;
  }

  return result;
}

function parseJsonObject(text: string) {
  const json = extractJSON(text)
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'");

  try {
    return JSON.parse(json) as unknown;
  } catch (firstError) {
    const repaired = repairJsonStringLines(json)
      .replace(/,\s*([}\]])/g, "$1");

    try {
      return JSON.parse(repaired) as unknown;
    } catch {
      // Continue to quote repair below.
    }

    const quoteRepaired = escapeLooseStringQuotes(repaired)
      .replace(/,\s*([}\]])/g, "$1");

    try {
      return JSON.parse(quoteRepaired) as unknown;
    } catch {
      const message = firstError instanceof Error ? firstError.message : "Invalid review JSON";
      throw new ReviewJsonParseError(message, json.slice(0, 1000));
    }
  }
}

function parseReviewJson(text: string) {
  return parseJsonObject(text) as ParsedReviewJson;
}

function formatUsage(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}) {
  if (!usage) return "";
  const parts = [
    typeof usage.inputTokens === "number" ? `输入 ${usage.inputTokens}` : null,
    typeof usage.outputTokens === "number" ? `输出 ${usage.outputTokens}` : null,
    typeof usage.totalTokens === "number" ? `合计 ${usage.totalTokens}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `，token：${parts.join(" / ")}` : "";
}

function stripMarkdownInline(value: string) {
  return value
    .replace(/[*_`]+/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQuotedMarkdownCandidates(text: string) {
  const candidates: string[] = [];
  const patterns = [
    /"([^"\n]{6,220})"/g,
    /“([^”\n]{6,220})”/g,
    /「([^」\n]{6,220})」/g,
    /『([^』\n]{6,220})』/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      candidates.push(stripMarkdownInline(match[1]));
    }
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    for (const cell of line.split("|").slice(1, -1)) {
      const cleaned = stripMarkdownInline(cell);
      if (cleaned.length >= 10 && !/^[-:\s]+$/.test(cleaned)) {
        candidates.push(cleaned);
      }
    }
  }

  return candidates;
}

function findExactSourceQuote(candidate: string, sourceText: string) {
  const cleaned = stripMarkdownInline(candidate)
    .replace(/^["“”「」『』]+|["“”「」『』]+$/g, "")
    .trim();
  if (!cleaned) return null;

  if (sourceText.includes(cleaned)) return cleaned;

  const parts = cleaned
    .split(/(?:……|…|\.{3,}|——|--)/)
    .map((part) => stripMarkdownInline(part))
    .filter((part) => part.length >= 10)
    .sort((a, b) => b.length - a.length);

  for (const part of parts) {
    if (sourceText.includes(part)) return part;
  }

  const compact = cleaned.replace(/\s+/g, "");
  if (compact.length >= 10 && sourceText.includes(compact)) return compact;

  return null;
}

function parseMarkdownFallbackIssues(text: string, sourceText: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const seen = new Set<string>();

  for (const candidate of extractQuotedMarkdownCandidates(text)) {
    if (issues.length >= 8) break;
    const exactQuote = findExactSourceQuote(candidate, sourceText);
    if (!exactQuote || seen.has(exactQuote)) continue;
    seen.add(exactQuote);

    issues.push({
      category: "continuity",
      severity: "medium",
      title: "AI 返回了非 JSON 报告中的疑似问题片段",
      exactQuote,
      explanation: "模型本次没有按要求返回 JSON，而是返回了 Markdown 审阅报告；系统已从报告中提取到剧本原文片段，保留给人工定位检查。",
      suggestion: "需人工处理：请结合上下文判断该段是否为错位插入、时间线冲突或设定矛盾。为避免误改，系统不会自动生成改写文本。",
      replacement: exactQuote,
      replaceMode: "first",
    });
  }

  return issues;
}

function parseIssues(text: string, sourceText: string): ReviewIssue[] {
  let parsed: { issues?: Partial<ReviewIssue>[] } | Partial<ReviewIssue>[];
  try {
    parsed = parseReviewJson(text);
  } catch (err) {
    if (err instanceof ReviewJsonParseError) {
      const fallbackIssues = parseMarkdownFallbackIssues(text, sourceText);
      if (fallbackIssues.length > 0) return fallbackIssues;
    }
    throw err;
  }

  const rawIssues = Array.isArray(parsed) ? parsed : parsed.issues || [];
  return rawIssues
    .map(normalizeIssue)
    .filter((issue): issue is ReviewIssue => issue !== null && sourceText.includes(issue.exactQuote));
}

function cleanAssetLabel(value: unknown) {
  return String(value || "")
    .replace(/[“”"「」『』《》【】（）()]/g, "")
    .replace(/[，。！？；、,.!?;：:\s]+/g, "")
    .trim()
    .slice(0, 24);
}

function cleanMetaText(value: unknown, max = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function looksLikeBadCharacterName(name: string) {
  return (
    !name ||
    name.length < 2 ||
    name.length > 8 ||
    /^(今生|前世|重生前|重生后|前期|初期|中期|后期|高潮|开端|结尾|尾声|背景|性格|人设|设定|剧情|简介|梗概|主题|主线|支线|卖点|看点|题材标签|核心看点|人物弧光|角色弧光|性格反差|高光时刻)$/.test(name) ||
    /(标签|看点|弧光|反差|时刻|阶段|背景|设定|剧情|简介|梗概|主题|主线|支线|卖点|金手指)$/.test(name) ||
    /^(男主角?|女主角?|男一|女一|男配|女配|主角|配角|反派|黄金配角|渣男前夫)$/.test(name) ||
    /^(老板|老首长|团长|民警|医生|护士|警察|司机|保镖|助理|秘书|律师|老师|学生|记者|军官|士兵|下属|领导|同事)$/.test(name) ||
    /^(前夫|前妻|丈夫|妻子|老婆|老公|婆婆|公公|岳父|岳母|父亲|母亲|爸爸|妈妈|爷爷|奶奶|哥哥|姐姐|弟弟|妹妹|孩子|儿子|女儿)$/.test(name)
  );
}

function looksLikePlotEventName(name: string) {
  return /(抓奸|确诊|怀了|生下|抱住|击打|带婆婆去|想看|发现|赶走|晕倒|死亡|去世|重生|逆袭|抢了|护妻|团灭|复仇|表白|结婚|离婚|争吵|打脸|揭穿|威胁|绑架|逃跑|追车|开会|冲突|反派|男主|女主|老婆|婆婆|孩子|双胞胎|二胎|五感共享|外挂|剧本|剧情|把脉)/.test(name);
}

function normalizeSceneLabel(name: string) {
  const sceneKeywords = [
    "军区一号会议室", "军区医院", "医院中医科", "医院楼顶", "第一医院", "第二医院", "医院", "沈家客厅", "沈家厨房",
    "盘山公路", "客厅", "卧室", "厨房", "餐厅", "会议室", "办公室", "走廊", "病房", "手术室", "急诊室",
    "学校", "教室", "公司", "街道", "公路", "车站", "机场", "酒店", "天台", "楼顶",
  ];
  const keyword = sceneKeywords.sort((a, b) => b.length - a.length).find((item) => name.includes(item));
  if (keyword && (looksLikePlotEventName(name) || name.length > keyword.length + 4)) return keyword;
  if (looksLikePlotEventName(name)) return "";
  return name;
}

function normalizeStoryAssetAnalysis(value: unknown): StoryAssetAnalysis | null {
  const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const storyMetaObj = obj.storyMeta && typeof obj.storyMeta === "object" ? obj.storyMeta as Record<string, unknown> : {};
  const assetsObj = obj.assets && typeof obj.assets === "object" ? obj.assets as Record<string, unknown> : {};

  const storyMeta: StoryMetaAnalysis = {
    time: cleanMetaText(storyMetaObj.time, 120),
    background: cleanMetaText(storyMetaObj.background, 180),
    visualStyleBase: cleanMetaText(storyMetaObj.visualStyleBase, 220),
    genre: cleanMetaText(storyMetaObj.genre, 80),
    locationBackground: cleanMetaText(storyMetaObj.locationBackground, 120),
  };

  const characters = Array.isArray(assetsObj.characters) ? assetsObj.characters : [];
  const scenes = Array.isArray(assetsObj.scenes) ? assetsObj.scenes : [];
  const props = Array.isArray(assetsObj.props) ? assetsObj.props : [];

  const seenCharacters = new Set<string>();
  const seenScenes = new Set<string>();
  const seenProps = new Set<string>();

  const normalized: StoryAssetAnalysis = {
    storyMeta,
    assets: {
      characters: characters
        .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          name: cleanAssetLabel(item.name),
          role: cleanMetaText(item.role, 40),
          description: cleanMetaText(item.description, 180),
        }))
        .filter((item) => {
          if (looksLikeBadCharacterName(item.name) || seenCharacters.has(item.name)) return false;
          seenCharacters.add(item.name);
          return true;
        })
        .slice(0, 60),
      scenes: scenes
        .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          name: normalizeSceneLabel(cleanAssetLabel(item.name)),
          type: cleanMetaText(item.type, 60),
          description: cleanMetaText(item.description, 180),
        }))
        .filter((item) => {
          if (!item.name || seenScenes.has(item.name)) return false;
          seenScenes.add(item.name);
          return true;
        })
        .slice(0, 80),
      props: props
        .map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          name: cleanAssetLabel(item.name),
          type: cleanMetaText(item.type, 60),
          description: cleanMetaText(item.description, 180),
        }))
        .filter((item) => {
          if (!item.name || item.name.length < 2 || seenProps.has(item.name)) return false;
          seenProps.add(item.name);
          return true;
        })
        .slice(0, 80),
    },
  };

  const hasMeta = Object.values(storyMeta).some(Boolean);
  const hasAssets = Boolean(normalized.assets?.characters?.length || normalized.assets?.scenes?.length || normalized.assets?.props?.length);
  return hasMeta || hasAssets ? normalized : null;
}

async function analyzeStoryAssets(
  configs: ProviderConfig[],
  pickModelConfig: () => ProviderConfig,
  textModelAttempts: number,
  text: string
) {
  const chunks = chunkText(text, 12000);
  const targets = chunks.length > 1 ? chunks : [text.slice(0, 60000)];
  const analyses: StoryAssetAnalysis[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  for (const [index, chunk] of targets.entries()) {
    const result = await runWithTextModelRetries(configs, pickModelConfig, textModelAttempts, async (modelConfig) => generateText({
      model: createLanguageModel(modelConfig),
      system: STORY_ASSET_ANALYSIS_SYSTEM,
      prompt: [
        targets.length > 1
          ? `这是完整剧本的第 ${index + 1}/${targets.length} 块。只抽取本块中实际出现的资产，名称保持原文一致。`
          : "",
        buildStoryAssetAnalysisPrompt(chunk),
      ].filter(Boolean).join("\n\n"),
      providerOptions: supportsOpenAIJsonMode(modelConfig)
        ? { openai: { response_format: { type: "json_object" as const } } }
        : undefined,
      temperature: 0.1,
      maxRetries: 1,
      maxOutputTokens: 12000,
    }));

    usage.inputTokens += result.usage.inputTokens ?? 0;
    usage.outputTokens += result.usage.outputTokens ?? 0;
    usage.totalTokens += result.usage.totalTokens ?? 0;

    const normalized = normalizeStoryAssetAnalysis(parseJsonObject(result.text));
    if (normalized) analyses.push(normalized);
  }

  return {
    analysis: mergeStoryAssetAnalyses(analyses),
    usage: {
      inputTokens: usage.inputTokens || undefined,
      outputTokens: usage.outputTokens || undefined,
      totalTokens: usage.totalTokens || undefined,
    },
  };
}

function positiveIntEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function describeTextModelConfig(config: ProviderConfig) {
  let host = "";
  try {
    host = config.baseUrl ? new URL(config.baseUrl).host : "";
  } catch {
    host = "";
  }
  return [config.protocol, host, config.modelId].filter(Boolean).join(":");
}

async function runWithTextModelRetries<T>(
  configs: ProviderConfig[],
  pickConfig: () => ProviderConfig,
  attempts: number,
  runner: (config: ProviderConfig) => Promise<T>
) {
  const maxAttempts = Math.max(1, Math.min(configs.length, attempts));
  const errors: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const config = pickConfig();
    try {
      return await runner(config);
    } catch (error) {
      errors.push(`${describeTextModelConfig(config)}: ${getFriendlyModelError(error, config)}`);
    }
  }

  throw new Error(`Failed after ${maxAttempts} text model config attempt(s). Last error: ${errors.at(-1) || "Unknown error"}`);
}

function mergeStoryAssetAnalyses(analyses: StoryAssetAnalysis[]) {
  const storyMeta: StoryMetaAnalysis = {};
  const characters = new Map<string, { name: string; role?: string; description?: string }>();
  const scenes = new Map<string, { name: string; type?: string; description?: string }>();
  const props = new Map<string, { name: string; type?: string; description?: string }>();

  for (const analysis of analyses) {
    const meta = analysis.storyMeta || {};
    storyMeta.time ||= meta.time;
    storyMeta.background ||= meta.background;
    storyMeta.visualStyleBase ||= meta.visualStyleBase;
    storyMeta.genre ||= meta.genre;
    storyMeta.locationBackground ||= meta.locationBackground;

    for (const item of analysis.assets?.characters || []) {
      mergeStoryAssetItem(characters, item);
    }
    for (const item of analysis.assets?.scenes || []) {
      mergeStoryAssetItem(scenes, item);
    }
    for (const item of analysis.assets?.props || []) {
      mergeStoryAssetItem(props, item);
    }
  }

  const merged: StoryAssetAnalysis = {
    storyMeta,
    assets: {
      characters: [...characters.values()].slice(0, 60),
      scenes: [...scenes.values()].slice(0, 80),
      props: [...props.values()].slice(0, 80),
    },
  };

  return normalizeStoryAssetAnalysis(merged);
}

function mergeStoryAssetItem<T extends { name: string; role?: string; type?: string; description?: string }>(
  map: Map<string, T>,
  item: T
) {
  const key = item.name;
  if (!key) return;

  const existing = map.get(key);
  if (!existing) {
    map.set(key, { ...item });
    return;
  }

  if (!existing.role && item.role) existing.role = item.role;
  if (!existing.type && item.type) existing.type = item.type;
  if ((item.description || "").length > (existing.description || "").length) {
    existing.description = item.description;
  }
}

function findSensitiveTermIssues(text: string): ReviewIssue[] {
  return SENSITIVE_TERMS
    .map((item) => ({ item, index: text.indexOf(item.term) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => {
      const severityRank = { high: 0, medium: 1, low: 2 };
      return severityRank[a.item.severity] - severityRank[b.item.severity] || a.index - b.index;
    })
    .map(({ item }) => ({
      category: "prohibited",
      severity: item.severity,
      title: `${item.group}: ${item.term}`,
      exactQuote: item.term,
      explanation: `${item.reason}。该词属于“${item.group}”排雷项，建议在剧名、简介、台词、字幕、画面提示词和角色设定中统一降级。`,
      suggestion: `建议替换为“${item.replacement}”，并同步弱化相关镜头、音效和画面提示词。`,
      replacement: item.replacement,
      replaceMode: "all",
    }));
}

function dedupeIssues(issues: ReviewIssue[]) {
  const deduped: ReviewIssue[] = [];
  const seen = new Set<string>();

  for (const issue of issues) {
    const key = `${issue.category}:${issue.exactQuote}:${issue.replacement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(issue);
  }

  return deduped;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );

  return results;
}

function getFriendlyModelError(err: unknown, config: ProviderConfig): string {
  const error = err as {
    message?: string;
    statusCode?: number;
    lastError?: { statusCode?: number; responseHeaders?: Record<string, string> };
  };
  const statusCode = error.statusCode ?? error.lastError?.statusCode;
  const message = error.message || "";
  const requestId = error.lastError?.responseHeaders?.["x-api-request-id"];

  if (statusCode === 503) {
    return `模型 ${config.modelId} 调用失败：中转站返回 503，当前没有可用渠道、额度不足，或模型 ID 与中转站不匹配。请在设置里换一个可用文本模型，或确认中转站后台是否支持这个模型。${requestId ? ` Request ID: ${requestId}` : ""}`;
  }

  if (/Cannot connect to API|other side closed|ECONNRESET|socket|fetch failed/i.test(message)) {
    return `模型 ${config.modelId} 连接被中断：${message}。我已按顺序分块调用，若仍失败，请换一个更稳定的文本模型或稍后重试。`;
  }

  return err instanceof Error ? err.message : "Unknown error";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    text: string;
    modelConfig?: { text: ProviderConfig | null };
    reviewConcurrency?: number;
  };

  const textModelConfigs = resolveLanguageModelConfigs(body.modelConfig?.text);
  const textModelConfig = textModelConfigs[0] ?? resolveLanguageModelConfig(body.modelConfig?.text);
  if (!textModelConfig) {
    return NextResponse.json({ error: "No text model" }, { status: 400 });
  }
  const activeTextModelConfigs = textModelConfigs.length > 0 ? textModelConfigs : [textModelConfig];

  const chunks = chunkText(body.text, 6000);
  const perKeyConcurrency = positiveIntEnv("IMPORT_TEXT_PER_KEY_CONCURRENCY", 2);
  const maxReviewConcurrency = positiveIntEnv("IMPORT_REVIEW_MAX_CONCURRENCY", Math.max(MAX_REVIEW_CONCURRENCY, 16));
  const poolConcurrency = Math.max(1, activeTextModelConfigs.length * perKeyConcurrency);
  const textModelAttempts = positiveIntEnv("IMPORT_TEXT_MODEL_ATTEMPTS", activeTextModelConfigs.length);
  const reviewConcurrency = Math.max(
    1,
    Math.min(
      maxReviewConcurrency,
      Math.max(
        Number.isFinite(body.reviewConcurrency) ? Number(body.reviewConcurrency) : DEFAULT_REVIEW_CONCURRENCY,
        poolConcurrency,
      )
    )
  );
  let modelCursor = 0;
  const pickModelConfig = () => {
    const config = activeTextModelConfigs[modelCursor % activeTextModelConfigs.length];
    modelCursor += 1;
    return config;
  };
  const termIssues = findSensitiveTermIssues(body.text);

  await addImportLog(projectId, 2, "running", `开始 AI 剧情审阅，共 ${chunks.length} 块，敏感词预扫描命中 ${termIssues.length} 项，并发 ${reviewConcurrency}，文本 key ${activeTextModelConfigs.length} 个`);

  try {
    const aiIssues: ReviewIssue[] = [];
    let storyAnalysis: StoryAssetAnalysis | null = null;
    let skippedChunks = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;

    try {
      await addImportLog(projectId, 2, "running", "AI 正在解析故事时间、背景和视觉基调...");
      const result = await analyzeStoryAssets(activeTextModelConfigs, pickModelConfig, textModelAttempts, body.text);
      storyAnalysis = result.analysis;
      totalInputTokens += result.usage.inputTokens ?? 0;
      totalOutputTokens += result.usage.outputTokens ?? 0;
      totalTokens += result.usage.totalTokens ?? 0;
      await addImportLog(
        projectId,
        2,
        "running",
        storyAnalysis
          ? `故事元信息解析完成${formatUsage(result.usage)}`
          : `故事元信息解析未返回可用结构${formatUsage(result.usage)}`
      );
    } catch (err) {
      console.warn("[ImportReview] Story meta analysis failed:", err);
      await addImportLog(projectId, 2, "running", "故事元信息解析失败，不影响剧情审阅；资产将在资产设定阶段统一提取。");
    }

    storyAnalysis = storyAnalysis?.storyMeta ? { storyMeta: storyAnalysis.storyMeta } : null;

    const chunkResults = await mapWithConcurrency(
      chunks,
      reviewConcurrency,
      async (chunk, idx) => {
        await addImportLog(projectId, 2, "running", `AI 正在审阅第 ${idx + 1}/${chunks.length} 块...`);

        const result = await runWithTextModelRetries(activeTextModelConfigs, pickModelConfig, textModelAttempts, async (modelConfig) => generateText({
          model: createLanguageModel(modelConfig),
          system: REVIEW_SYSTEM,
          prompt: buildReviewPrompt(chunk, idx, chunks.length),
          providerOptions: supportsOpenAIJsonMode(modelConfig)
            ? { openai: { response_format: { type: "json_object" as const } } }
            : undefined,
          temperature: 0.1,
          maxRetries: 1,
        }));

        try {
          const parsedIssues = parseIssues(result.text, chunk);
          const usedMarkdownFallback = parsedIssues.some((issue) => issue.title === "AI 返回了非 JSON 报告中的疑似问题片段");
          await addImportLog(
            projectId,
            2,
            "running",
            usedMarkdownFallback
              ? `第 ${idx + 1}/${chunks.length} 块 AI 返回非 JSON，已从报告中本地提取 ${parsedIssues.length} 条可定位片段${formatUsage(result.usage)}`
              : `第 ${idx + 1}/${chunks.length} 块审阅完成${formatUsage(result.usage)}`
          );
          return { issues: parsedIssues, skipped: false, usage: result.usage };
        } catch (err) {
          if (err instanceof ReviewJsonParseError) {
            console.error(`[ImportReview] Chunk ${idx + 1} JSON parse failed. Raw:\n${err.snippet}...`);
            await addImportLog(
              projectId,
              2,
              "running",
              `第 ${idx + 1} 块 AI 返回的 JSON 格式异常，已跳过该块 AI 结果并继续审阅${formatUsage(result.usage)}。`
            );
            return { issues: [] as ReviewIssue[], skipped: true, usage: result.usage };
          }
          throw err;
        }
      }
    );

    for (const chunkResult of chunkResults) {
      aiIssues.push(...chunkResult.issues);
      if (chunkResult.skipped) skippedChunks++;
      totalInputTokens += chunkResult.usage.inputTokens ?? 0;
      totalOutputTokens += chunkResult.usage.outputTokens ?? 0;
      totalTokens += chunkResult.usage.totalTokens ?? 0;
    }

    const deduped = dedupeIssues([...termIssues, ...aiIssues]);
    const skippedSuffix = skippedChunks > 0 ? `，其中 ${skippedChunks} 块 AI 返回格式异常已跳过` : "";
    const usage = {
      inputTokens: totalInputTokens || undefined,
      outputTokens: totalOutputTokens || undefined,
      totalTokens: totalTokens || undefined,
    };
    const usageSuffix = formatUsage(usage);

    await addImportLog(
      projectId,
      2,
      "done",
      deduped.length > 0
        ? `AI 剧情审阅完成，发现 ${deduped.length} 个问题${skippedSuffix}${usageSuffix}`
        : `AI 剧情审阅完成，未发现明显问题${skippedSuffix}${usageSuffix}`,
      { issues: deduped, usage, skippedChunks, reviewConcurrency, storyAnalysis }
    );

    return NextResponse.json({ issues: deduped, skippedChunks, usage, reviewConcurrency, storyAnalysis });
  } catch (err) {
    const msg = getFriendlyModelError(err, textModelConfig);
    console.error("[ImportReview] Story review failed:", err);
    await addImportLog(projectId, 2, "error", `AI 剧情审阅失败: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
