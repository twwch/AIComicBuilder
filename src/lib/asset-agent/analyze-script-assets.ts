import {
  buildAssetImagePrompt,
  defaultAssetStyleSpec,
  defaultAssetVisualSpec,
  type AssetStyleSpec,
} from "@/lib/asset-prompt-builder";

type AssetCategory = "characters" | "props" | "scenes" | "voices";

interface AnalyzeScriptAssetsInput {
  title: string;
  script: string;
  storyAnalysis?: StoryAssetAnalysis | null;
  aspectRatio?: string;
  targetSize?: string;
  style?: string;
}

type AssetPromptSettings = Required<Pick<AnalyzeScriptAssetsInput, "aspectRatio" | "targetSize" | "style">> & {
  eraConstraint: string;
  genreConstraint: string;
  visualStyleGuide: string;
};

export interface StoryMetaAnalysis {
  time?: string;
  background?: string;
  visualStyleBase?: string;
  genre?: string;
  locationBackground?: string;
}

export interface StoryAssetAnalysis {
  storyMeta?: StoryMetaAnalysis;
  assets?: {
    characters?: Array<{ name: string; role?: string; description?: string }>;
    scenes?: Array<{ name: string; type?: string; description?: string }>;
    props?: Array<{ name: string; type?: string; description?: string }>;
  };
}

interface FaceTemplate {
  label: string;
  url: string;
  note: string;
}

export interface AssetAgentVariant {
  name: string;
  variantType?: string;
  description?: string;
  prompt?: string;
  imageUrl?: string;
  history?: Array<Record<string, unknown>>;
}

export interface AssetAgentAsset {
  id: string;
  category: AssetCategory;
  name: string;
  mainImageName?: string;
  role?: string;
  roleKey?: string;
  faceTemplate?: FaceTemplate | null;
  tags: string[];
  status: "draft";
  confirmed: boolean;
  score: number;
  appearances: number;
  episodes: string[];
  description: string;
  background?: string;
  visualConstraints: string;
  prompt: string;
  negativePrompt: string;
  promptMetadata?: Record<string, unknown>;
  styleSpec?: AssetStyleSpec;
  variants: AssetAgentVariant[];
  imageUrl: string;
  audioUrl?: string;
  history: Array<Record<string, unknown>>;
}

export interface AssetAgentProject {
  id: string;
  title: string;
  sourceLength: number;
  createdAt: string;
  settings: {
    aspectRatio: string;
    targetSize: string;
    style: string;
    eraConstraint?: string;
    genreConstraint?: string;
  };
  summary: {
    output: string;
    scriptLength: number;
    lineCount: number;
    storyMeta?: StoryMetaAnalysis;
    counts: {
      characters: number;
      props: number;
      scenes: number;
      voices: number;
    };
    note: string;
  };
  assets: {
    characters: AssetAgentAsset[];
    props: AssetAgentAsset[];
    scenes: AssetAgentAsset[];
    voices: AssetAgentAsset[];
  };
  stages: Array<{
    id: string;
    label: string;
    status: "completed" | "review" | "pending";
    metrics: string[];
  }>;
}

interface SceneBucket {
  heading: string;
  rawHeading: string;
  timeTags: string[];
  lines: string[];
  index: number;
}

interface CharacterSeed {
  name: string;
  score: number;
  role: string;
  explicitRole?: string;
  contexts: string[];
  variantHints?: CharacterVariantHint[];
  assetKind?: "named" | "unnamed_support" | "group";
}

interface CharacterVariantHint {
  name: string;
  description: string;
  promptDetail: string;
  variantType: "costume" | "emotion" | "injury" | "body_state" | "group_state" | "appearance";
  evidenceText?: string;
}

interface NamedSeed {
  name: string;
  score: number;
  type: string;
  contexts: string[];
  times?: string[];
  variantHints?: AssetVariantHint[];
}

interface AssetVariantHint {
  name: string;
  description: string;
  promptDetail: string;
  variantType: string;
  evidenceText?: string;
}

const FACE_TEMPLATES: Record<string, FaceTemplate> = {
  maleLead: {
    label: "男主角真人模板",
    url: "/templates/male-lead-template.jpg",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态，禁止漫画风、二次元和插画感。",
  },
  femaleLead: {
    label: "女主角真人模板",
    url: "/templates/female-lead-template.png",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态，禁止漫画风、二次元和插画感。",
  },
  maleSupport: {
    label: "男配角真人模板",
    url: "/templates/male-support-template.png",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态，禁止漫画风、二次元和插画感。",
  },
  femaleSupport: {
    label: "女配角真人模板",
    url: "/templates/female-support-template.png",
    note: "主图与全部变体必须严格保持模板的脸型、五官、眉眼鼻唇比例、骨相和面部辨识度一致；只允许改变发型、服装、妆造强弱和剧情状态，禁止漫画风、二次元和插画感。",
  },
};

const BANNED_CHARACTER_NAMES = new Set([
  "时间",
  "地点",
  "场景",
  "镜头",
  "视觉",
  "内景",
  "外景",
  "旁白",
  "字幕",
  "音效",
  "音乐",
  "特写",
  "全景",
  "中景",
  "近景",
  "道具",
  "服装",
  "动作",
  "画面",
  "黑屏",
  "转场",
  "制作提示",
  "转场字幕",
  "监狱画面",
  "客观",
  "客观视角",
  "人物",
  "角色",
  "剧名",
  "主题",
  "正文",
  "大纲",
  "众人",
  "所有人",
  "工作人员",
  "系统",
  "系统音",
  "男主",
  "女主",
  "男配",
  "女配",
  "主角",
  "配角",
  "反派",
  "男人",
  "女人",
  "女孩",
  "男孩",
  "老人",
  "孩子",
  "医生",
  "护士",
  "警察",
  "士兵",
  "丧尸",
  "今生",
  "前世",
  "初期",
  "中期",
  "后期",
  "前期",
  "高潮",
  "开端",
  "结尾",
  "背景",
  "性格",
  "题材标签",
  "人物弧光",
  "角色弧光",
  "性格反差",
  "性格与金手指",
  "高光时刻",
  "男主角",
  "女主角",
  "黄金配角",
  "渣男前夫",
  "老板",
  "老首长",
  "团长",
  "民警",
  "婆婆",
  "前夫",
  "丈夫",
  "妻子",
  "老婆",
  "老公",
  "母亲",
  "父亲",
]);

const PROP_KEYWORDS: Array<{ keyword: string; type: string }> = [
  { keyword: "重卡", type: "车辆" },
  { keyword: "卡车", type: "车辆" },
  { keyword: "汽车", type: "车辆" },
  { keyword: "轿车", type: "车辆" },
  { keyword: "摩托", type: "车辆" },
  { keyword: "枪", type: "武器" },
  { keyword: "手枪", type: "武器" },
  { keyword: "步枪", type: "武器" },
  { keyword: "刀", type: "武器" },
  { keyword: "剑", type: "武器" },
  { keyword: "匕首", type: "武器" },
  { keyword: "弓", type: "武器" },
  { keyword: "钥匙", type: "随身物品" },
  { keyword: "手机", type: "电子设备" },
  { keyword: "电脑", type: "电子设备" },
  { keyword: "芯片", type: "电子设备" },
  { keyword: "录音笔", type: "电子设备" },
  { keyword: "对讲机", type: "电子设备" },
  { keyword: "地图", type: "文件" },
  { keyword: "文件", type: "文件" },
  { keyword: "照片", type: "文件" },
  { keyword: "信", type: "文件" },
  { keyword: "合同", type: "文件" },
  { keyword: "戒指", type: "饰品" },
  { keyword: "项链", type: "饰品" },
  { keyword: "玉佩", type: "饰品" },
  { keyword: "令牌", type: "标识物" },
  { keyword: "玻璃杯", type: "容器" },
  { keyword: "水杯", type: "容器" },
  { keyword: "茶杯", type: "容器" },
  { keyword: "酒杯", type: "容器" },
  { keyword: "杯子", type: "容器" },
  { keyword: "杯", type: "容器" },
  { keyword: "箱", type: "容器" },
  { keyword: "背包", type: "容器" },
  { keyword: "药", type: "医疗物资" },
  { keyword: "针剂", type: "医疗物资" },
  { keyword: "医疗箱", type: "医疗物资" },
  { keyword: "面具", type: "服饰" },
  { keyword: "制服", type: "服饰" },
  { keyword: "外套", type: "服饰" },
  { keyword: "炸药", type: "危险品" },
  { keyword: "炸弹", type: "危险品" },
  { keyword: "手电", type: "工具" },
  { keyword: "手电筒", type: "工具" },
  { keyword: "工具箱", type: "工具" },
  { keyword: "遥控器", type: "工具" },
  { keyword: "水箱", type: "物资" },
  { keyword: "物资箱", type: "物资" },
  { keyword: "罐头", type: "物资" },
];

const SCENE_KEYWORDS: Array<{ keyword: string; type: string }> = [
  { keyword: "会议室", type: "办公场景" },
  { keyword: "指挥部", type: "军事场景" },
  { keyword: "军区", type: "军事场景" },
  { keyword: "营房", type: "军事场景" },
  { keyword: "宿舍", type: "居住空间" },
  { keyword: "医院", type: "医疗场景" },
  { keyword: "病房", type: "医疗场景" },
  { keyword: "诊室", type: "医疗场景" },
  { keyword: "急诊室", type: "医疗场景" },
  { keyword: "手术室", type: "医疗场景" },
  { keyword: "科室", type: "医疗场景" },
  { keyword: "学校", type: "公共建筑" },
  { keyword: "教室", type: "公共建筑" },
  { keyword: "公司", type: "办公场景" },
  { keyword: "办公室", type: "办公场景" },
  { keyword: "交易大厅", type: "商业空间" },
  { keyword: "证券交易所", type: "商业空间" },
  { keyword: "交易所", type: "商业空间" },
  { keyword: "客厅", type: "居住空间" },
  { keyword: "卧室", type: "居住空间" },
  { keyword: "厨房", type: "居住空间" },
  { keyword: "书房", type: "居住空间" },
  { keyword: "院子", type: "居住空间" },
  { keyword: "庭院", type: "居住空间" },
  { keyword: "地下室", type: "封闭空间" },
  { keyword: "仓库", type: "工业空间" },
  { keyword: "工厂", type: "工业空间" },
  { keyword: "厂房", type: "工业空间" },
  { keyword: "车间", type: "工业空间" },
  { keyword: "实验室", type: "科研空间" },
  { keyword: "基地", type: "据点" },
  { keyword: "天台", type: "屋顶空间" },
  { keyword: "楼顶", type: "屋顶空间" },
  { keyword: "走廊", type: "过渡空间" },
  { keyword: "街道", type: "城市外景" },
  { keyword: "盘山公路", type: "道路" },
  { keyword: "公路", type: "道路" },
  { keyword: "高速服务区", type: "道路" },
  { keyword: "高速", type: "道路" },
  { keyword: "车站", type: "交通场景" },
  { keyword: "码头", type: "交通场景" },
  { keyword: "机场", type: "交通场景" },
  { keyword: "商场", type: "商业空间" },
  { keyword: "超市", type: "商业空间" },
  { keyword: "酒吧", type: "商业空间" },
  { keyword: "餐厅", type: "商业空间" },
  { keyword: "酒店", type: "住宿空间" },
  { keyword: "旅馆", type: "住宿空间" },
  { keyword: "警局", type: "公共机构" },
  { keyword: "派出所", type: "公共机构" },
  { keyword: "民政局", type: "公共机构" },
  { keyword: "法院", type: "公共机构" },
  { keyword: "法庭", type: "公共机构" },
  { keyword: "审讯室", type: "公共机构" },
  { keyword: "监狱", type: "禁闭空间" },
  { keyword: "拘留室", type: "禁闭空间" },
  { keyword: "牢房", type: "禁闭空间" },
  { keyword: "森林", type: "自然外景" },
  { keyword: "荒野", type: "自然外景" },
  { keyword: "山林", type: "自然外景" },
  { keyword: "河边", type: "自然外景" },
  { keyword: "城堡", type: "幻想建筑" },
  { keyword: "王府", type: "古装建筑" },
  { keyword: "宫殿", type: "古装建筑" },
  { keyword: "客栈", type: "古装建筑" },
  { keyword: "避难所", type: "据点" },
  { keyword: "营地", type: "据点" },
  { keyword: "操场", type: "公共空间" },
  { keyword: "广场", type: "公共空间" },
];

const FEMALE_LEAD_MARKERS = /女主|女主人公|女一|女主角/;
const MALE_LEAD_MARKERS = /男主|男主人公|男一|男主角/;
const GENERAL_LEAD_MARKERS = /主角|主人公|核心人物|第一视角|主要人物/;
const LEAD_RELATION_MARKERS = /结为夫妻|成婚|结婚|订婚|婚约|夫妻|伴侣|恋人|爱人/;
const FEMALE_STATUS_MARKERS = /妻子|老婆|女友|未婚妻|夫人|太太|小姐|姑娘|少女|公主|王妃|女官/;
const MALE_STATUS_MARKERS = /丈夫|老公|男友|未婚夫|夫君|郎君|先生|少爷|公子|王爷|世子|将军|少帅|总裁|总工|军官|军区高官|警官|首长|队长/;

export function analyzeScriptAssets(input: AnalyzeScriptAssetsInput): AssetAgentProject {
  const aspectRatio = input.aspectRatio || "16:9";
  const targetSize = input.targetSize || "1536x1024";
  const style = input.style || "真人实拍";
  const normalized = normalizeScript(input.script);
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const episodes = extractEpisodes(normalized);
  const sceneBuckets = collectSceneBuckets(lines);
  const storyMeta = normalizeStoryMeta(input.storyAnalysis?.storyMeta);
  const aiCharacterSeeds = buildCharacterSeedsFromAnalysis(input.storyAnalysis);
  const ruleCharacterSeeds = collectCharacterSeeds(lines, normalized);
  const characterSeeds = rebalanceCharacterRoles(
    normalizeCharacterSeeds(mergeCharacterSeeds(aiCharacterSeeds, ruleCharacterSeeds)),
    normalized,
    storyMeta,
  );
  const characterNames = characterSeeds.map((seed) => seed.name);
  const aiPropSeeds = buildPropSeedsFromAnalysis(input.storyAnalysis);
  const aiSceneSeeds = buildSceneSeedsFromAnalysis(input.storyAnalysis, characterNames);
  const rulePropSeeds = collectPropSeeds(lines, normalized, characterNames);
  const ruleSceneSeeds = collectSceneSeeds(sceneBuckets, lines, normalized, characterNames);
  const propSeeds = normalizePropSeeds(mergeNamedSeeds(aiPropSeeds, rulePropSeeds));
  const sceneSeeds = normalizeSceneSeeds(mergeNamedSeeds(aiSceneSeeds, ruleSceneSeeds));

  const settings: AssetPromptSettings = {
    aspectRatio,
    targetSize,
    style,
    eraConstraint: inferAssetEraConstraint(storyMeta, normalized),
    genreConstraint: inferAssetGenreConstraint(storyMeta),
    visualStyleGuide: buildProjectStyleGuide(storyMeta, normalized, style),
  };
  const characters = characterSeeds.slice(0, 80).map((seed, index) =>
    makeCharacterAsset(seed, index, normalized, episodes, settings)
  );
  const props = propSeeds.slice(0, 120).map((seed, index) =>
    makePropAsset(seed, index, normalized, episodes, settings)
  );
  const scenes = sceneSeeds.slice(0, 120).map((seed, index) =>
    makeSceneAsset(seed, index, normalized, episodes, settings)
  );
  const voices = characters.map((character, index) =>
    makeVoiceAsset(character, index, normalized, episodes)
  );

  return {
    id: `proj_${Date.now()}`,
    title: input.title || "未命名剧本",
    sourceLength: normalized.length,
    createdAt: new Date().toISOString(),
    settings,
    summary: buildSummary(normalized, characters, props, scenes, voices, episodes, storyMeta),
    assets: { characters, props, scenes, voices },
    stages: [
      {
        id: "script",
        label: "剧本解析",
        status: "completed",
        metrics: [`剧本 ${normalized.length} 字`, `${episodes.length || 1} 集/段`, `${sceneBuckets.length} 个场景段`],
      },
      {
        id: "assets",
        label: "资产设定",
        status: "review",
        metrics: [`角色 ${characters.length}`, `物品 ${props.length}`, `场景 ${scenes.length}`, `音色 ${voices.length}`],
      },
      {
        id: "generation",
        label: "设定图生成",
        status: "pending",
        metrics: ["等待确认后批量生图"],
      },
    ],
  };
}

function normalizeScript(script: string) {
  return String(script || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractEpisodes(text: string) {
  const chineseMatches = [...text.matchAll(/第\s*([0-9一二两三四五六七八九十百]+)\s*[集幕场章]/g)];
  const epMatches = [...text.matchAll(/\bEP\s*0*([0-9]{1,3})\b/gi)];
  const ids = [
    ...chineseMatches.map((match) => `EP${toArabic(match[1]) || match[1]}`),
    ...epMatches.map((match) => `EP${Number(match[1])}`),
  ];
  return [...new Set(ids)].slice(0, 100);
}

function collectSceneBuckets(lines: string[]) {
  const buckets: SceneBucket[] = [];
  let current: SceneBucket | null = null;

  for (const line of lines) {
    if (isSceneHeading(line)) {
      current = {
        heading: cleanSceneName(line),
        rawHeading: line,
        timeTags: extractTimeTags(line),
        lines: [],
        index: buckets.length + 1,
      };
      buckets.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  if (!buckets.length) {
    buckets.push({
      heading: "主要叙事空间",
      rawHeading: "主要叙事空间",
      timeTags: [],
      lines: lines.slice(0, 160),
      index: 1,
    });
  }

  return buckets;
}

function collectCharacterSeeds(lines: string[], text: string) {
  const score = new Map<string, number>();
  const contexts = new Map<string, string[]>();
  const explicitRoles = new Map<string, string>();

  for (const line of lines) {
    const rolePrefix = line.match(/^(男主|女主|男配|女配|反派|主角)[：:\s]+([\u4e00-\u9fa5A-Za-z0-9·]{2,12})/);
    if (rolePrefix) {
      const name = cleanCharacterName(rolePrefix[2]);
      if (isLikelyCharacterName(name)) {
        const role = normalizeRole(rolePrefix[1]);
        bump(score, name, role.includes("主") ? 40 : 22);
        remember(contexts, name, line);
        explicitRoles.set(name, role);
      }
    }

    const castLine = line.match(/(?:人物|角色|主要角色|出场人物)[：:]\s*(.{2,120})$/);
    if (castLine) {
      const names = castLine[1].split(/[、，,/\s]+/).map((item) => cleanCharacterName(item)).filter(Boolean);
      for (const name of names) {
        if (isLikelyCharacterName(name)) {
          bump(score, name, 5);
          remember(contexts, name, line);
        }
      }
    }

    const dialogue = line.match(/^([\u4e00-\u9fa5A-Za-z0-9·]{2,12})\s*[：:]\s*(.{1,180})$/);
    if (dialogue) {
      const name = cleanCharacterName(dialogue[1]);
      const body = dialogue[2];
      if (isLikelyCharacterName(name)) {
        const explicitRole = explicitRoleFromText(body);
        bump(score, name, explicitRole ? 16 : 4);
        remember(contexts, name, body);
        if (explicitRole) explicitRoles.set(name, explicitRole);
      }
    }

    const inlineRole = line.match(/([\u4e00-\u9fa5A-Za-z0-9·]{2,12})[（(]?(男主|女主|男配|女配|反派|主角)[）)]?/);
    if (inlineRole) {
      const name = cleanCharacterName(inlineRole[1]);
      if (isLikelyCharacterName(name)) {
        const role = normalizeRole(inlineRole[2]);
        bump(score, name, role.includes("主") ? 28 : 14);
        remember(contexts, name, line);
        explicitRoles.set(name, role);
      }
    }
  }

  for (const name of [...score.keys()]) {
    const count = countOccurrences(text, name);
    score.set(name, (score.get(name) || 0) + count);
  }

  const ranked = [...score.entries()]
    .filter(([name, value]) => value >= 4 && isProperCharacterAssetName(name))
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      name,
      score: value,
      role: "",
      explicitRole: explicitRoles.get(name),
      contexts: contexts.get(name) || [],
    }));

  const seeds = assignCharacterRoles(ranked);
  return seeds.length ? seeds : [{ name: "主角", score: 1, role: "主角", contexts: [] }];
}

function collectPropSeeds(lines: string[], text: string, characterNames: string[]) {
  const characterNameSet = new Set(characterNames);
  const seedMap = new Map<string, NamedSeed>();

  for (const line of lines) {
    for (const item of PROP_KEYWORDS) {
      if (!line.includes(item.keyword)) continue;
      if (isInvalidPropKeywordUsage(line, item.keyword)) continue;
      const names = [item.keyword, ...extractNamesAroundKeyword(line, item.keyword)]
        .map(normalizePropName)
        .filter((name) => isProperPropAssetName(name) && !looksLikeCharacterName(name, characterNameSet));
      const usableNames = names.length ? names : [item.keyword];
      for (const name of usableNames) {
        mergeSeed(seedMap, {
          name,
          type: item.type,
          score: 4 + countOccurrences(text, name),
          contexts: [line],
        });
      }
    }
  }

  return dedupeNamedSeeds([...seedMap.values()])
    .sort((a, b) => b.score - a.score)
    .slice(0, 120);
}

function collectSceneSeeds(
  sceneBuckets: SceneBucket[],
  lines: string[],
  text: string,
  characterNames: string[]
) {
  const characterNameSet = new Set(characterNames);
  const seedMap = new Map<string, NamedSeed>();

  for (const bucket of sceneBuckets) {
    const name = normalizeSceneName(bucket.heading, characterNameSet);
    if (isProperSceneAssetName(name)) {
      mergeSeed(seedMap, {
        name,
        type: inferSceneType(name),
        score: 10 + bucket.lines.length,
        contexts: [bucket.rawHeading, ...bucket.lines.slice(0, 4)],
        times: bucket.timeTags,
      });
    }
  }

  for (const line of lines) {
    for (const item of SCENE_KEYWORDS) {
      if (!line.includes(item.keyword)) continue;
      if (isInvalidSceneKeywordUsage(line, item.keyword)) continue;
      const names = [item.keyword, ...extractNamesAroundKeyword(line, item.keyword)]
        .map((name) => normalizeSceneName(name, characterNameSet))
        .filter(isProperSceneAssetName);
      const usableNames = names.length ? names : [item.keyword];
      for (const name of usableNames) {
        mergeSeed(seedMap, {
          name,
          type: item.type,
          score: 3 + countOccurrences(text, name),
          contexts: [line],
          times: extractTimeTags(line),
        });
      }
    }
  }

  if (seedMap.size > 1) {
    seedMap.delete("主要叙事空间");
  }

  return dedupeNamedSeeds([...seedMap.values()])
    .sort((a, b) => b.score - a.score)
    .slice(0, 120);
}

function normalizeStoryMeta(meta?: StoryMetaAnalysis): StoryMetaAnalysis | undefined {
  if (!meta) return undefined;
  const normalized: StoryMetaAnalysis = {
    time: compactText(meta.time || "", 120),
    background: compactText(meta.background || "", 180),
    visualStyleBase: compactText(meta.visualStyleBase || "", 220),
    genre: compactText(meta.genre || "", 80),
    locationBackground: compactText(meta.locationBackground || "", 120),
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function inferAssetEraConstraint(meta: StoryMetaAnalysis | undefined, text: string) {
  const source = [
    meta?.time,
    meta?.background,
    meta?.locationBackground,
    meta?.visualStyleBase,
    text.slice(0, 12000),
  ].filter(Boolean).join(" ");
  const year = source.match(/(19[0-9]{2}|20[0-9]{2})\s*年?/);
  if (year) return `${year[1]} China`;
  if (/八十年代|80年代|1980年代|1980s/i.test(source)) return "1980s China";
  if (/七十年代|70年代|1970年代|1970s/i.test(source)) return "1970s China";
  if (/九十年代|90年代|1990年代|1990s/i.test(source)) return "1990s China";
  if (/民国/.test(source)) return "Republican-era China";
  if (/古代|唐代|宋代|明代|清代|汉代|古风|仙侠|武侠/.test(source)) return "historical China";
  return "realistic modern/civilian China unless asset schema explicitly states otherwise";
}

function inferAssetGenreConstraint(meta: StoryMetaAnalysis | undefined) {
  const genre = compactText(meta?.genre || meta?.visualStyleBase || "", 120);
  return genre || "realistic Chinese short-drama asset reference";
}

function leadEvidenceText(storyMeta: StoryMetaAnalysis | undefined, script: string) {
  return [
    storyMeta?.background,
    storyMeta?.genre,
    storyMeta?.locationBackground,
    script.slice(0, 8000),
  ].filter(Boolean).join(" ");
}

function windowsAroundName(text: string, name: string, radius = 32) {
  const windows: string[] = [];
  if (!name) return windows;
  let from = 0;
  while (windows.length < 10) {
    const index = text.indexOf(name, from);
    if (index < 0) break;
    windows.push(text.slice(Math.max(0, index - radius), Math.min(text.length, index + name.length + radius)));
    from = index + name.length;
  }
  return windows;
}

function hasLeadMarkerNearName(text: string, name: string, gender: "male" | "female") {
  const windows = windowsAroundName(text, name, 40).join(" ");
  if (gender === "female") return FEMALE_LEAD_MARKERS.test(windows);
  return MALE_LEAD_MARKERS.test(windows);
}

function hasMalePartnerMarkerNearName(text: string, name: string) {
  const windows = windowsAroundName(text, name, 42).join(" ");
  return LEAD_RELATION_MARKERS.test(windows) || MALE_STATUS_MARKERS.test(windows);
}

function isNamedLeadEligible(seed: CharacterSeed) {
  return seed.assetKind !== "unnamed_support" && seed.assetKind !== "group" && isProperCharacterAssetName(seed.name);
}

function roleForGender(gender: string, lead: boolean) {
  if (lead && gender === "男性") return "男主角";
  if (lead && gender === "女性") return "女主角";
  if (gender === "男性") return "男配角";
  if (gender === "女性") return "女配角";
  return lead ? "主角" : "配角";
}

function chooseLeadCandidate(
  seeds: CharacterSeed[],
  gender: "男性" | "女性",
  source: string,
  excludeName = "",
) {
  const scored = seeds
    .filter((seed) => seed.name !== excludeName && isNamedLeadEligible(seed))
    .map((seed) => {
      const joined = `${seed.name} ${seed.contexts.join(" ")}`;
      const windows = windowsAroundName(source, seed.name, 42).join(" ");
      const inferredGender = inferGender(seed.name, `${joined} ${windows}`, seed.explicitRole || "");
      if (inferredGender !== gender) return null;
      let score = seed.score;
      if (gender === "女性" && FEMALE_LEAD_MARKERS.test(windows)) score += 100;
      if (gender === "男性" && MALE_LEAD_MARKERS.test(windows)) score += 100;
      if (GENERAL_LEAD_MARKERS.test(windows)) score += 55;
      if (LEAD_RELATION_MARKERS.test(windows)) score += 24;
      if (gender === "女性" && FEMALE_STATUS_MARKERS.test(windows)) score += 14;
      if (gender === "男性" && MALE_STATUS_MARKERS.test(windows)) score += 14;
      if (/反派|陷害|诬告|伪造|害她|害他|仇人|阶下囚|监狱/.test(joined)) score -= 35;
      return { seed, score };
    })
    .filter((item): item is { seed: CharacterSeed; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.seed.name || "";
}

function rebalanceCharacterRoles(
  seeds: CharacterSeed[],
  script: string,
  storyMeta?: StoryMetaAnalysis,
) {
  if (seeds.length === 0) return seeds;
  const source = leadEvidenceText(storyMeta, script);
  let femaleLeadName = seeds.find((seed) => isNamedLeadEligible(seed) && seed.explicitRole === "女主角")?.name || "";
  let maleLeadName = seeds.find((seed) => isNamedLeadEligible(seed) && seed.explicitRole === "男主角")?.name || "";

  for (const seed of seeds) {
    if (!femaleLeadName && isNamedLeadEligible(seed) && hasLeadMarkerNearName(source, seed.name, "female")) {
      femaleLeadName = seed.name;
    }
    if (!maleLeadName && isNamedLeadEligible(seed) && hasLeadMarkerNearName(source, seed.name, "male")) {
      maleLeadName = seed.name;
    }
  }

  if (!femaleLeadName) femaleLeadName = chooseLeadCandidate(seeds, "女性", source, maleLeadName);
  if (!maleLeadName) {
    const partner = seeds
      .filter((seed) => seed.name !== femaleLeadName && isNamedLeadEligible(seed))
      .find((seed) => {
        const windows = windowsAroundName(source, seed.name, 60).join(" ");
        return inferGender(seed.name, `${seed.name} ${seed.contexts.join(" ")} ${windows}`, seed.explicitRole || "") === "男性"
          && hasMalePartnerMarkerNearName(source, seed.name);
      });
    maleLeadName = partner?.name || chooseLeadCandidate(seeds, "男性", source, femaleLeadName);
  }

  return seeds.map((seed) => {
    const joined = `${seed.name} ${seed.contexts.join(" ")}`;
    const evidence = windowsAroundName(source, seed.name, 60).join(" ");
    const gender = inferGender(seed.name, `${joined} ${evidence}`, seed.explicitRole || "");
    let role = seed.explicitRole || "";
    if (seed.name === femaleLeadName) role = "女主角";
    if (seed.name === maleLeadName) role = "男主角";
    if (!role || (seed.assetKind !== "named" && /主角/.test(role))) {
      role = seed.assetKind === "unnamed_support" || seed.assetKind === "group"
        ? roleForCharacterKind(seed.assetKind, "")
        : inferSupportRole(seed.name, seed.contexts);
    }
    if (!/主角|反派|无名配角|群体角色/.test(role)) {
      role = roleForGender(gender, false);
    }
    return { ...seed, role };
  }).sort((a, b) => b.score - a.score);
}

function mergeCharacterSeeds(primary: CharacterSeed[], fallback: CharacterSeed[]) {
  const merged = new Map<string, CharacterSeed>();

  for (const seed of [...primary, ...fallback]) {
    const name = cleanCharacterName(seed.name);
    if (!isProperCharacterAssetName(name)) continue;

    const existing = merged.get(name);
    if (!existing) {
      merged.set(name, { ...seed, name, contexts: seed.contexts.slice(0, 10) });
      continue;
    }

    existing.score = Math.max(existing.score, seed.score);
    existing.role = existing.role || seed.role;
    existing.explicitRole = existing.explicitRole || seed.explicitRole;
    existing.contexts = [...new Set([...existing.contexts, ...seed.contexts])].slice(0, 12);
  }

  return [...merged.values()].sort((a, b) => b.score - a.score);
}

function normalizeCharacterSeeds(seeds: CharacterSeed[]) {
  const byName = new Map<string, CharacterSeed>();
  const pendingHints: Array<{ seed: CharacterSeed; hint: CharacterVariantHint; targetName?: string }> = [];

  function ensureBaseSeed(name: string, source: CharacterSeed, kind: CharacterSeed["assetKind"] = "named") {
    const normalizedName = cleanCharacterName(name);
    if (!isProperCharacterAssetName(normalizedName)) return null;
    const existing = byName.get(normalizedName);
    if (existing) {
      existing.score = Math.max(existing.score, Math.max(1, source.score - 1));
      existing.role = existing.role || roleForCharacterKind(kind, source.role);
      existing.explicitRole = existing.explicitRole || source.explicitRole;
      existing.contexts = [...new Set([...existing.contexts, ...source.contexts])].slice(0, 12);
      existing.assetKind = existing.assetKind || kind;
      return existing;
    }
    const role = roleForCharacterKind(kind, source.role);
    const created: CharacterSeed = {
      ...source,
      name: normalizedName,
      score: Math.max(1, source.score - (source.name === normalizedName ? 0 : 1)),
      role,
      explicitRole: source.explicitRole || "",
      contexts: source.contexts.slice(0, 12),
      variantHints: [],
      assetKind: kind,
    };
    byName.set(normalizedName, created);
    return created;
  }

  for (const seed of seeds) {
    const name = cleanCharacterName(seed.name);
    const split = splitCompositeCharacterStateName(name);
    if (split) {
      const kind = inferCharacterAssetKind(split.assetName);
      const baseSeed = ensureBaseSeed(split.assetName, seed, kind);
      if (baseSeed) {
        pendingHints.push({ seed, targetName: baseSeed.name, hint: buildCharacterVariantHint(baseSeed.name, split.stateText, seed.contexts) });
      }
      continue;
    }

    if (isCharacterStateOnlyPhrase(name)) {
      pendingHints.push({ seed, hint: buildCharacterVariantHint("", name, seed.contexts) });
      continue;
    }

    const kind = inferCharacterAssetKind(name);
    ensureBaseSeed(name, seed, kind);
  }

  const baseNames = [...byName.keys()].sort((a, b) => b.length - a.length);
  for (const pending of pendingHints) {
    const targetName = pending.targetName || findMentionedCharacterName(pending.seed.contexts, baseNames);
    if (!targetName) continue;
    const target = byName.get(targetName);
    if (!target) continue;
    const hint = pending.hint.name
      ? pending.hint
      : buildCharacterVariantHint(targetName, pending.seed.name, pending.seed.contexts);
    appendCharacterVariantHint(target, hint);
    target.contexts = [...new Set([...target.contexts, ...pending.seed.contexts])].slice(0, 12);
    target.score = Math.max(target.score, pending.seed.score);
  }

  return [...byName.values()].sort((a, b) => b.score - a.score);
}

function appendCharacterVariantHint(seed: CharacterSeed, hint: CharacterVariantHint) {
  const name = normalizeNameForCompare(hint.name);
  const existing = seed.variantHints || [];
  if (!name || existing.some((item) => normalizeNameForCompare(item.name) === name)) return;
  seed.variantHints = [...existing, hint].slice(0, 8);
}

function roleForCharacterKind(kind: CharacterSeed["assetKind"], fallback = "") {
  if (kind === "group") return "群体角色";
  if (kind === "unnamed_support") return fallback && !/主角/.test(fallback) ? fallback : "无名配角";
  return fallback || "配角";
}

function inferCharacterAssetKind(name: string): CharacterSeed["assetKind"] {
  if (isGroupCharacterName(name)) return "group";
  if (/(老头|老人|男子|男人|女人|女孩|男孩|司机|保安|保镖|守卫|战士|士兵|医生|护士|护工|军医|宪兵|摄影师|地勤|警察|首长|纪委干事|警察队长|看门|老板|店员|下属|领导|女工[甲乙丙丁]?|阔太太[甲乙丙丁]?)$/.test(name)) {
    return "unnamed_support";
  }
  return "named";
}

function normalizeNameForCompare(value: string) {
  return cleanAssetName(value).toLowerCase();
}

function isGroupCharacterName(name: string) {
  return /^(丧尸|联盟战士|战士|士兵|伤员|幸存者|难民|群众|村民|黑衣人|守卫|敌兵|工人)$/.test(cleanCharacterName(name));
}

function splitCompositeCharacterStateName(name: string) {
  const value = cleanCharacterName(name);
  if (!value || isCharacterStateOnlyPhrase(value)) return null;
  const match = value.match(/^([\u4e00-\u9fa5A-Za-z0-9·]{2,6}?)(一身.+|衣着.+|衣衫.+|身着.+|穿着.+|神情.+|表情.+|面容.+|声音.+|语气.+|视角|旁白|内心独白|电话里|敬礼|满身.+|浑身.+|风尘满面|衣衫褴褛|狼狈便装|硬朗冷峻|坚毅冷峻|壮实紧张|声音嘶哑|紧张|冷峻|坚毅|疲惫|虚弱|受伤|警觉|惊恐|愤怒|倒地|眩晕倒地)$/);
  if (!match) return null;
  const assetName = cleanCharacterName(match[1]);
  const stateText = cleanAssetName(match[2]);
  if (!assetName || !stateText) return null;
  if (isCharacterStateOnlyPhrase(assetName)) return null;
  if (!isProperCharacterAssetName(assetName)) return null;
  return { assetName, stateText };
}

function isCharacterStateOnlyPhrase(name: string) {
  const value = cleanCharacterName(name);
  if (!value) return false;
  if (/^(神情|表情|面容|声音|语气|视角|旁白|内心|电话里|敬礼|衣着|衣衫|身着|穿着|一身|满身|浑身)/.test(value)) return true;
  if (/(坚毅|冷峻|紧张|惊恐|愤怒|疲惫|虚弱|受伤|狼狈|风尘满面|衣衫褴褛|便装|作战装束|警觉|倒地|眩晕)$/.test(value)
    && !/(老头|老人|男子|女人|女孩|男孩|战士|士兵|丧尸|伤员|守卫)$/.test(value)) {
    return true;
  }
  return false;
}

function findMentionedCharacterName(contexts: string[], baseNames: string[]) {
  const joined = contexts.join(" ");
  return baseNames.find((name) => joined.includes(name)) || "";
}

function buildCharacterVariantHint(assetName: string, stateText: string, contexts: string[]): CharacterVariantHint {
  const normalizedState = cleanAssetName(stateText) || "剧情状态";
  const type = inferCharacterVariantType(normalizedState);
  const prefix = assetName ? `${assetName}` : "";
  return {
    name: `${prefix}${variantLabelFromState(normalizedState)}`,
    description: `${normalizedState}：来自剧本证据的服装、表情、体态或剧情状态变体，必须保持同一人物身份与脸型五官。`,
    promptDetail: normalizedState,
    variantType: type,
    evidenceText: contexts[0] || "",
  };
}

function inferCharacterVariantType(stateText: string): CharacterVariantHint["variantType"] {
  if (/衣|服|便装|制服|装束|夹克|外套|睡衣|正装|礼服|军装|作战/.test(stateText)) return "costume";
  if (/伤|血|虚弱|疲惫|狼狈|倒地|眩晕/.test(stateText)) return "injury";
  if (/神情|表情|紧张|坚毅|冷峻|惊恐|愤怒|警觉/.test(stateText)) return "emotion";
  if (/丧尸|战士|士兵|伤员|群/.test(stateText)) return "group_state";
  if (/壮实|瘦弱|高大|矮小|风尘/.test(stateText)) return "body_state";
  return "appearance";
}

function variantLabelFromState(stateText: string) {
  const cleaned = stateText
    .replace(/^(一身|满身|浑身|身着|穿着|衣着|衣衫|神情|表情|面容)/, "")
    .replace(/[，。！？；、,.!?;]+/g, "")
    .trim();
  return `${cleaned || stateText}状态`;
}

function mergeNamedSeeds(primary: NamedSeed[], fallback: NamedSeed[]) {
  return dedupeNamedSeeds([...primary, ...fallback]).sort((a, b) => b.score - a.score);
}

function normalizePropSeeds(seeds: NamedSeed[]) {
  const byName = new Map<string, NamedSeed>();
  const pendingHints: Array<{ seed: NamedSeed; hint: AssetVariantHint; targetName?: string }> = [];

  function ensureBaseSeed(name: string, source: NamedSeed, type = inferPropType(name)) {
    const normalizedName = normalizePropName(name);
    if (!isProperPropAssetName(normalizedName)) return null;
    const existing = byName.get(normalizedName);
    if (existing) {
      existing.score = Math.max(existing.score, Math.max(1, source.score - 1));
      existing.type = existing.type || type || source.type;
      existing.contexts = [...new Set([...existing.contexts, ...source.contexts])].slice(0, 12);
      existing.times = [...new Set([...(existing.times || []), ...(source.times || [])])];
      for (const hint of source.variantHints || []) appendNamedVariantHint(existing, hint);
      return existing;
    }
    const created: NamedSeed = {
      ...source,
      name: normalizedName,
      type: type || source.type || inferPropType(normalizedName),
      score: Math.max(1, source.score - (source.name === normalizedName ? 0 : 1)),
      contexts: source.contexts.slice(0, 12),
      times: source.times || [],
      variantHints: [],
    };
    byName.set(normalizedName, created);
    for (const hint of source.variantHints || []) appendNamedVariantHint(created, hint);
    return created;
  }

  for (const seed of seeds) {
    const name = normalizePropName(seed.name);
    const split = splitCompositePropStateName(name);
    if (split) {
      const baseSeed = ensureBaseSeed(split.assetName, seed, inferPropType(split.assetName));
      if (baseSeed) {
        pendingHints.push({
          seed,
          targetName: baseSeed.name,
          hint: buildPropVariantHint(baseSeed.name, split.stateText, seed.contexts, baseSeed.type),
        });
      }
      continue;
    }
    ensureBaseSeed(name, seed, seed.type || inferPropType(name));
  }

  const baseNames = [...byName.keys()].sort((a, b) => b.length - a.length);
  for (const pending of pendingHints) {
    const targetName = pending.targetName || findMentionedCharacterName(pending.seed.contexts, baseNames);
    if (!targetName) continue;
    const target = byName.get(targetName);
    if (!target) continue;
    appendNamedVariantHint(target, pending.hint);
    target.contexts = [...new Set([...target.contexts, ...pending.seed.contexts])].slice(0, 12);
    target.score = Math.max(target.score, pending.seed.score);
  }

  return [...byName.values()].sort((a, b) => b.score - a.score);
}

function normalizeSceneSeeds(seeds: NamedSeed[]) {
  const byName = new Map<string, NamedSeed>();
  const pendingHints: Array<{ seed: NamedSeed; hint: AssetVariantHint; targetName?: string; times?: string[] }> = [];

  function ensureBaseSeed(name: string, source: NamedSeed, type = inferSceneType(name), times: string[] = []) {
    const normalizedName = normalizeSceneAssetCandidate(name);
    if (!isProperSceneAssetName(normalizedName)) return null;
    const mergedTimes = [...new Set([...(source.times || []), ...times])];
    const existing = byName.get(normalizedName);
    if (existing) {
      existing.score = Math.max(existing.score, Math.max(1, source.score - 1));
      existing.type = existing.type || type || source.type;
      existing.contexts = [...new Set([...existing.contexts, ...source.contexts])].slice(0, 12);
      existing.times = [...new Set([...(existing.times || []), ...mergedTimes])];
      for (const hint of source.variantHints || []) appendNamedVariantHint(existing, hint);
      return existing;
    }
    const created: NamedSeed = {
      ...source,
      name: normalizedName,
      type: type || source.type || inferSceneType(normalizedName),
      score: Math.max(1, source.score - (source.name === normalizedName ? 0 : 1)),
      contexts: source.contexts.slice(0, 12),
      times: mergedTimes,
      variantHints: [],
    };
    byName.set(normalizedName, created);
    for (const hint of source.variantHints || []) appendNamedVariantHint(created, hint);
    return created;
  }

  for (const seed of seeds) {
    const name = normalizeSceneAssetCandidate(seed.name);
    const split = splitCompositeSceneStateName(name);
    if (split) {
      const baseSeed = ensureBaseSeed(split.assetName, seed, inferSceneType(split.assetName), split.times);
      if (baseSeed) {
        pendingHints.push({
          seed,
          targetName: baseSeed.name,
          times: split.times,
          hint: buildSceneVariantHint(baseSeed.name, split.stateText, seed.contexts, split.times),
        });
      }
      continue;
    }
    ensureBaseSeed(name, seed, seed.type || inferSceneType(name));
  }

  const baseNames = [...byName.keys()].sort((a, b) => b.length - a.length);
  for (const pending of pendingHints) {
    const targetName = pending.targetName || findMentionedCharacterName(pending.seed.contexts, baseNames);
    if (!targetName) continue;
    const target = byName.get(targetName);
    if (!target) continue;
    appendNamedVariantHint(target, pending.hint);
    target.contexts = [...new Set([...target.contexts, ...pending.seed.contexts])].slice(0, 12);
    target.times = [...new Set([...(target.times || []), ...(pending.times || [])])];
    target.score = Math.max(target.score, pending.seed.score);
  }

  return mergeContainedSceneSeeds([...byName.values()]).sort((a, b) => b.score - a.score);
}

function appendNamedVariantHint(seed: NamedSeed, hint: AssetVariantHint) {
  const name = normalizeNameForCompare(hint.name);
  const existing = seed.variantHints || [];
  if (!name || existing.some((item) => normalizeNameForCompare(item.name) === name)) return;
  seed.variantHints = [...existing, hint].slice(0, 10);
}

function mergeContainedSceneSeeds(seeds: NamedSeed[]) {
  const sorted = [...seeds].sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta) return scoreDelta;
    return b.name.length - a.name.length;
  });
  const results: NamedSeed[] = [];

  for (const seed of sorted) {
    const contained = results.find((existing) =>
      existing.name !== seed.name
      && (existing.name.includes(seed.name) || seed.name.includes(existing.name))
      && Math.min(existing.name.length, seed.name.length) <= 4
    );
    if (!contained) {
      results.push(seed);
      continue;
    }

    const specific = contained.name.length >= seed.name.length ? contained : seed;
    const generic = contained.name.length >= seed.name.length ? seed : contained;
    const targetIndex = results.indexOf(contained);
    const merged: NamedSeed = {
      ...specific,
      score: Math.max(specific.score, generic.score),
      type: specific.type || generic.type,
      contexts: [...new Set([...specific.contexts, ...generic.contexts])].slice(0, 10),
      times: [...new Set([...(specific.times || []), ...(generic.times || [])])],
      variantHints: [...(specific.variantHints || []), ...(generic.variantHints || [])].slice(0, 10),
    };

    if (targetIndex >= 0) {
      results[targetIndex] = merged;
    } else {
      results.push(merged);
    }
  }

  return results;
}

function splitCompositePropStateName(name: string) {
  const value = normalizePropName(name);
  const assetName = findLongestKeyword(value, PROP_KEYWORDS.map((item) => item.keyword));
  if (!assetName || value === assetName) return null;
  const stateText = extractPropVariantStateText(value)
    || normalizeVariantStateText(value.replace(new RegExp(escapeRegExp(assetName), "g"), ""));
  if (!stateText || !isPropVariantStateText(stateText)) return null;
  if (!isProperPropAssetName(assetName)) return null;
  return { assetName, stateText };
}

function splitCompositeSceneStateName(name: string) {
  const value = normalizeSceneAssetCandidate(name);
  const assetName = findLongestSceneBaseName(value);
  if (!assetName || value === assetName) return null;
  const stateText = normalizeVariantStateText(value.replace(new RegExp(escapeRegExp(assetName), "g"), ""));
  if (!stateText || !isSceneVariantStateText(stateText)) return null;
  if (!isProperSceneAssetName(assetName)) return null;
  return { assetName, stateText, times: extractTimeTags(stateText) };
}

function findLongestSceneBaseName(value: string) {
  return findLongestKeyword(value, [
    ...SCENE_KEYWORDS.map((item) => item.keyword),
    "空间",
    "房间",
    "大厅",
    "屋顶",
    "据点",
    "广场",
    "营地",
    "操场",
  ]);
}

function normalizeVariantStateText(value: string) {
  return cleanAssetName(value)
    .replace(/^(的|被|已|已经|正在)/, "")
    .replace(/(滚到|落到|掉到|摔到|放在|放到|拿到|递给|旁边|地上).*$/g, "")
    .replace(/(的|后|中|状态|版本)$/g, "")
    .trim();
}

function extractPropVariantStateText(value: string) {
  const match = value.match(/(未开封|未拆|完好|崭新|干净|完整|破损|破碎|碎裂|裂开|裂痕|断裂|断掉|损坏|摔坏|砸坏|烧焦|磨损|染血|沾血|血迹|污渍|脏污|打开|开启|展开|翻开|拆开|关闭|合上|锁上|封住|收起|空的|空箱|空包|空瓶|装满|满满|塞满|佩戴|戴上|穿上|披上|丢失|湿透|湿漉|旧|碎|裂|断|脏|湿)/);
  return match ? normalizeVariantStateText(match[1]) : "";
}

function isPropVariantStateText(value: string) {
  return /(完好|崭新|干净|完整|破|碎|裂|断|损|坏|旧|烧焦|磨损|染血|血迹|污|脏|打开|开启|展开|翻开|拆开|关闭|合上|锁|封|空|满|装满|塞满|佩戴|戴上|穿上|披上|丢失|湿)/.test(value);
}

function isSceneVariantStateText(value: string) {
  return /(日|白天|清晨|早晨|上午|中午|午后|夜|晚上|深夜|凌晨|黄昏|傍晚|雨|暴雨|下雨|雪|暴雪|下雪|雾|烟雾|晴|阴|逆光|昏暗|灯光|霓虹|废弃|破败|坍塌|烧毁|爆炸后|空旷|拥挤|混乱|战斗后|封锁)/.test(value);
}

function buildPropVariantHint(assetName: string, stateText: string, contexts: string[], type: string): AssetVariantHint {
  const normalizedState = normalizeVariantStateText(stateText) || "剧情状态";
  return {
    name: `${assetName}${assetVariantLabelFromState(normalizedState)}`,
    description: `${normalizedState}：同一物品在剧情中的状态变体，必须保持核心形状、材质、比例和标志性细节一致。`,
    promptDetail: normalizedState,
    variantType: inferPropVariantType(normalizedState, type),
    evidenceText: contexts[0] || "",
  };
}

function buildSceneVariantHint(assetName: string, stateText: string, contexts: string[], times: string[] = []): AssetVariantHint {
  const normalizedState = normalizeVariantStateText(stateText) || times.join("、") || "剧情状态";
  return {
    name: `${assetName}${sceneVariantLabelFromState(normalizedState, times)}`,
    description: `${normalizedState}：同一场景在剧情中的时间、天气、灯光或破损状态变体，空间结构和主要陈设保持一致。`,
    promptDetail: normalizedState,
    variantType: inferSceneVariantType(normalizedState, times),
    evidenceText: contexts[0] || "",
  };
}

function inferPropVariantType(stateText: string, type = "") {
  if (/破|碎|裂|断|损|坏|旧|烧焦|磨损/.test(stateText)) return "damaged";
  if (/血|污|脏|湿/.test(stateText)) return "stained";
  if (/打开|开启|展开|翻开|拆开/.test(stateText)) return "open";
  if (/关闭|合上|锁|封/.test(stateText)) return "closed";
  if (/空|满|装满|塞满/.test(stateText)) return "load_state";
  if (/佩戴|戴上|穿上|披上|制服|外套|面具/.test(`${stateText} ${type}`)) return "worn";
  return "condition";
}

function inferSceneVariantType(stateText: string, times: string[] = []) {
  if (/雨|暴雨|下雨|雪|暴雪|下雪|雾|烟雾|晴|阴/.test(stateText)) return "weather";
  if (times.some((time) => time === "雨" || time === "雪" || time === "雾")) return "weather";
  if (times.length || /日|白天|清晨|早晨|上午|中午|午后|夜|晚上|深夜|凌晨|黄昏|傍晚/.test(stateText)) return "time_of_day";
  if (/逆光|昏暗|灯光|霓虹/.test(stateText)) return "lighting";
  if (/废弃|破败|坍塌|烧毁|爆炸后|战斗后/.test(stateText)) return "damage_state";
  if (/空旷|拥挤|混乱|封锁/.test(stateText)) return "set_dressing";
  return "scene_state";
}

function assetVariantLabelFromState(stateText: string) {
  const cleaned = normalizeVariantStateText(stateText);
  return `${cleaned || stateText}状态`;
}

function sceneVariantLabelFromState(stateText: string, times: string[] = []) {
  const cleaned = normalizeVariantStateText(stateText) || times.join("、");
  return `${cleaned || stateText}变体`;
}

function buildCharacterSeedsFromAnalysis(analysis?: StoryAssetAnalysis | null): CharacterSeed[] {
  const seen = new Set<string>();
  return (analysis?.assets?.characters || [])
    .map((item): CharacterSeed | null => {
      const name = cleanCharacterName(item.name);
      if (!isProperCharacterAssetName(name) || seen.has(name)) return null;
      seen.add(name);
      const rawRole = compactText(item.role || "", 20);
      const role = normalizeRoleFromAnalysis(rawRole);
      const isExplicitRole = /男主|女主|男一|女一|男配|女配|男反|女反|反派/.test(rawRole);
      return {
        name,
        score: role.includes("主") ? 80 : 50,
        role,
        explicitRole: isExplicitRole ? role : "",
        contexts: [item.description || item.role || ""].filter(Boolean),
      };
    })
    .filter((item): item is CharacterSeed => item !== null);
}

function buildPropSeedsFromAnalysis(analysis?: StoryAssetAnalysis | null): NamedSeed[] {
  const seen = new Set<string>();
  return (analysis?.assets?.props || [])
    .map((item): NamedSeed | null => {
      const name = normalizePropName(item.name);
      if (!isProperPropAssetName(name) || seen.has(name)) return null;
      seen.add(name);
      return {
        name,
        score: 70,
        type: item.type || inferPropType(name),
        contexts: [item.description || ""].filter(Boolean),
      };
    })
    .filter((item): item is NamedSeed => item !== null);
}

function buildSceneSeedsFromAnalysis(analysis?: StoryAssetAnalysis | null, characterNames: string[] = []): NamedSeed[] {
  const seen = new Set<string>();
  const characterNameSet = new Set(characterNames);
  return (analysis?.assets?.scenes || [])
    .map((item): NamedSeed | null => {
      const name = normalizeSceneAssetCandidate(item.name, characterNameSet);
      if (!isProperSceneAssetName(name) || seen.has(name)) return null;
      seen.add(name);
      return {
        name,
        score: 70,
        type: item.type || inferSceneType(name),
        contexts: [item.description || ""].filter(Boolean),
      };
    })
    .filter((item): item is NamedSeed => item !== null);
}

function normalizeRoleFromAnalysis(role: string) {
  if (/男主|男一/.test(role)) return "男主角";
  if (/女主|女一/.test(role)) return "女主角";
  if (/主角/.test(role)) return "主角";
  if (/反派/.test(role)) return "反派角色";
  if (/男配/.test(role)) return "男配角";
  if (/女配/.test(role)) return "女配角";
  return "配角";
}

function makeCharacterAsset(
  seed: CharacterSeed,
  index: number,
  text: string,
  episodes: string[],
  settings: AssetPromptSettings
): AssetAgentAsset {
  const snippets = findSnippets(text, seed.name);
  const joined = snippets.concat(seed.contexts).join(" ");
  const gender = inferGender(seed.name, joined, seed.role);
  const roleKey = roleKeyFromRole(seed.role, gender);
  const age = inferAge(joined);
  const temperament = inferTemperament(joined);
  const epRefs = inferEpisodeRefs(text, seed.name, episodes);
  const profile = buildCharacterProfile(seed, joined);
  const background = buildCharacterBackground(seed);
  const faceTemplate = FACE_TEMPLATES[roleKey] || null;
  const visualConstraints = [
    faceTemplate ? `${faceTemplate.label}；${faceTemplate.note}` : "",
    gender ? `性别识别保持${gender}，不改变年龄层次和人物辨识度。` : "",
    "真人实拍摄影质感，自然皮肤纹理，不要漫画风、二次元、插画风、夸张美型或换脸感。",
  ].filter(Boolean).join("；");
  const builtPrompt = buildAssetImagePrompt({
    asset: {
      id: `char_${index + 1}_${slugify(seed.name)}`,
      type: "character",
      name: seed.name,
      role: seed.role,
      description: profile,
      visualConstraints,
      tags: [seed.role, gender, age, temperament].filter(Boolean),
      faceTemplate,
    },
    visualSpec: defaultAssetVisualSpec("character", settings.targetSize),
    styleSpec: {
      ...defaultAssetStyleSpec(),
      style: settings.style || "realistic live-action photography",
      eraConstraint: settings.eraConstraint,
      genre: settings.genreConstraint,
    },
  });
  const prompt = builtPrompt.compiled_display_prompt
    || buildCharacterImagePrompt(seed.name, seed.role, profile, background, visualConstraints, faceTemplate, settings.visualStyleGuide);

  return {
    id: `char_${index + 1}_${slugify(seed.name)}`,
    category: "characters",
    name: seed.name,
    mainImageName: `${seed.name}主形象三视图`,
    role: seed.role,
    roleKey,
    faceTemplate,
    tags: [seed.role, gender, age, temperament].filter(Boolean),
    status: "draft",
    confirmed: false,
    score: seed.score,
    appearances: seed.score,
    episodes: epRefs,
    description: profile,
    background,
    visualConstraints,
    prompt,
    negativePrompt: builtPrompt.compiled_negative_prompt || defaultNegativePrompt("characters"),
    styleSpec: builtPrompt.compiler_input.style_spec,
    promptMetadata: {
      displayPromptLanguage: "zh",
      generationPromptLanguage: "en_structured",
      promptBuilder: "asset_prompt_compiler_v2",
      compilerInput: builtPrompt.compiler_input,
      compilerIR: builtPrompt.compiler_ir,
      compiledFinalPrompt: builtPrompt.compiled_final_prompt,
      compiledNegativePrompt: builtPrompt.compiled_negative_prompt,
      compiledDisplayPrompt: builtPrompt.compiled_display_prompt,
      validation: builtPrompt.validation_report,
    },
    variants: mergeAssetVariants(
      suggestCharacterVariants(seed.name, seed.role, snippets, faceTemplate),
      variantHintsToAssetVariants(seed.name, seed.variantHints || [], faceTemplate),
    ),
    imageUrl: "",
    history: [],
  };
}

function makePropAsset(
  seed: NamedSeed,
  index: number,
  text: string,
  episodes: string[],
  settings: AssetPromptSettings
): AssetAgentAsset {
  const snippets = findSnippets(text, seed.name);
  const epRefs = inferEpisodeRefs(text, seed.name, episodes);
  const sourceSnippets = seed.contexts.concat(snippets);
  const description = compactText(sourceSnippets.join(" "), 180);
  const visualConstraints = [seed.type, description].filter(Boolean).join("；");
  const builtPrompt = buildAssetImagePrompt({
    asset: {
      id: `prop_${index + 1}_${slugify(seed.name)}`,
      type: "prop",
      name: seed.name,
      role: seed.type,
      visualConstraints,
      tags: [seed.type],
    },
    visualSpec: defaultAssetVisualSpec("prop", settings.targetSize),
    styleSpec: {
      ...defaultAssetStyleSpec(),
      style: settings.style || "realistic product photography",
      eraConstraint: settings.eraConstraint,
      genre: settings.genreConstraint,
    },
  });
  const prompt = builtPrompt.compiled_display_prompt
    || buildPropImagePrompt(seed.name, seed.type, description, settings.visualStyleGuide);
  const explicitVariants = variantHintsToPropVariants(seed.name, seed.type, seed.variantHints || [], prompt);

  return {
    id: `prop_${index + 1}_${slugify(seed.name)}`,
    category: "props",
    name: seed.name,
    mainImageName: `${seed.name}物品主图`,
    role: seed.type,
    tags: [seed.type],
    status: "draft",
    confirmed: false,
    score: seed.score,
    appearances: seed.score,
    episodes: epRefs,
    description: description || `${seed.name} 是剧本中反复出现或具有叙事功能的物品。`,
    visualConstraints,
    prompt,
    negativePrompt: builtPrompt.compiled_negative_prompt || defaultNegativePrompt("props"),
    styleSpec: builtPrompt.compiler_input.style_spec,
    promptMetadata: {
      displayPromptLanguage: "zh",
      generationPromptLanguage: "en_structured",
      promptBuilder: "asset_prompt_compiler_v2",
      compilerInput: builtPrompt.compiler_input,
      compilerIR: builtPrompt.compiler_ir,
      compiledFinalPrompt: builtPrompt.compiled_final_prompt,
      compiledNegativePrompt: builtPrompt.compiled_negative_prompt,
      compiledDisplayPrompt: builtPrompt.compiled_display_prompt,
      validation: builtPrompt.validation_report,
    },
    variants: explicitVariants.length ? explicitVariants : suggestPropVariants(seed.name, seed.type, sourceSnippets, prompt),
    imageUrl: "",
    history: [],
  };
}

function makeSceneAsset(
  seed: NamedSeed,
  index: number,
  text: string,
  episodes: string[],
  settings: AssetPromptSettings
): AssetAgentAsset {
  const snippets = findSnippets(text, seed.name);
  const epRefs = inferEpisodeRefs(text, seed.name, episodes);
  const description = compactText(seed.contexts.concat(snippets).join(" "), 220);
  const times = Array.isArray(seed.times) ? seed.times : [];
  const visualConstraints = [seed.type, description, times.map((time) => `${time}景`).join("；")]
    .filter(Boolean)
    .join("；");
  const builtPrompt = buildAssetImagePrompt({
    asset: {
      id: `scene_${index + 1}_${slugify(seed.name)}`,
      type: "scene",
      name: seed.name,
      role: seed.type,
      visualConstraints,
      tags: [seed.type, ...times.map((time) => `${time}景`)].filter(Boolean),
    },
    visualSpec: defaultAssetVisualSpec("scene", settings.targetSize),
    styleSpec: {
      ...defaultAssetStyleSpec(),
      style: settings.style || "realistic live-action environment reference",
      eraConstraint: settings.eraConstraint,
      genre: settings.genreConstraint,
    },
  });
  const prompt = builtPrompt.compiled_display_prompt
    || buildSceneImagePrompt(seed.name, seed.type, description, times, settings.visualStyleGuide);

  return {
    id: `scene_${index + 1}_${slugify(seed.name)}`,
    category: "scenes",
    name: seed.name,
    mainImageName: `${seed.name}场景主图`,
    role: seed.type,
    tags: [seed.type, ...times.map((time) => `${time}景`)].filter(Boolean),
    status: "draft",
    confirmed: false,
    score: seed.score,
    appearances: seed.score,
    episodes: epRefs,
    description: description || `${seed.name} 是剧本中需要建立空间一致性的场景。`,
    visualConstraints,
    prompt,
    negativePrompt: builtPrompt.compiled_negative_prompt || defaultNegativePrompt("scenes"),
    styleSpec: builtPrompt.compiler_input.style_spec,
    promptMetadata: {
      displayPromptLanguage: "zh",
      generationPromptLanguage: "en_structured",
      promptBuilder: "asset_prompt_compiler_v2",
      compilerInput: builtPrompt.compiler_input,
      compilerIR: builtPrompt.compiler_ir,
      compiledFinalPrompt: builtPrompt.compiled_final_prompt,
      compiledNegativePrompt: builtPrompt.compiled_negative_prompt,
      compiledDisplayPrompt: builtPrompt.compiled_display_prompt,
      validation: builtPrompt.validation_report,
    },
    variants: mergeAssetVariants(
      suggestSceneVariants(seed.name, times, prompt),
      variantHintsToSceneVariants(seed.name, seed.variantHints || [], prompt),
    ),
    imageUrl: "",
    history: [],
  };
}

function makeVoiceAsset(character: AssetAgentAsset, index: number, text: string, episodes: string[]): AssetAgentAsset {
  const snippets = findSnippets(text, character.name).join(" ");
  const gender = character.tags.find((tag) => tag === "男性" || tag === "女性") || inferGender(character.name, snippets);
  const age = character.tags.find((tag) => tag.includes("岁") || tag.includes("青年") || tag.includes("中年")) || inferAge(snippets);
  const temperament = inferTemperament(snippets);
  const prompt = [
    "【音色定位】",
    `${character.name}：${gender}，${age}，${character.role || "角色"}。声线要贴合人物身份与剧本处境。`,
    "",
    "【声音质感】",
    `${temperament}。普通话自然，气息真实，避免播音腔和夸张表演。`,
    "",
    "【表演方向】",
    "对白以人物当下目标为核心，语速、停顿、重音随情绪变化；保留生活化口吻，避免过度戏剧化。",
  ].join("\n");

  return {
    id: `voice_${index + 1}_${slugify(character.name)}`,
    category: "voices",
    name: `${character.name}音色`,
    role: character.name,
    tags: [gender, age, character.role || ""].filter(Boolean),
    status: "draft",
    confirmed: false,
    score: character.score,
    appearances: character.appearances,
    episodes: inferEpisodeRefs(text, character.name, episodes),
    description: `${character.name} 的配音/音色设定，用于后续对白制作保持一致。`,
    visualConstraints: "",
    prompt,
    negativePrompt: "",
    promptMetadata: {},
    variants: [
      { name: "日常对白", description: "自然、克制、贴近生活的基础版本。" },
      { name: "情绪爆发", description: "压力升高时的更强气息与重音。" },
      { name: "低声独白", description: "适合内心活动和近距离对白。" },
    ],
    imageUrl: "",
    history: [],
  };
}

function buildSummary(
  text: string,
  characters: AssetAgentAsset[],
  props: AssetAgentAsset[],
  scenes: AssetAgentAsset[],
  voices: AssetAgentAsset[],
  episodes: string[],
  storyMeta?: StoryMetaAnalysis
) {
  const lines = text.split("\n").filter(Boolean);
  return {
    output: `${episodes.length || 1} 集/段`,
    scriptLength: text.length,
    lineCount: lines.length,
    counts: {
      characters: characters.length,
      props: props.length,
      scenes: scenes.length,
      voices: voices.length,
    },
    storyMeta,
    note: "规则 Agent 已完成第一轮抽取，请在人审后批量调用 image2 生成设定图。",
  };
}

function isSceneHeading(line: string) {
  const normalized = normalizeSceneHeadingLine(line);
  return (
    /^(第\s*[0-9一二两三四五六七八九十百]+\s*场|场景\s*[0-9一二两三四五六七八九十百]*|地点|内景|外景|INT\.?|EXT\.?)/i.test(normalized) ||
    /[日夜晨昏]\s*[内外]$/.test(normalized) ||
    /^[0-9]+[.、]\s*.{2,24}(内|外|日|夜)$/.test(normalized)
  );
}

function normalizeSceneHeadingLine(line: string) {
  return String(line || "")
    .trim()
    .replace(/^[【\[]\s*/, "")
    .replace(/[】\]]\s*$/, "")
    .trim();
}

function cleanSceneName(line: string) {
  const normalized = normalizeSceneHeadingLine(line);
  const scenePrefix = /^(第\s*[0-9一二两三四五六七八九十百]+\s*场|场景\s*[0-9一二两三四五六七八九十百]*|地点|内景|外景|INT\.?|EXT\.?)[：:\s-]*(.+)$/i;
  const body = normalized.match(scenePrefix)?.[2] || normalized;
  const primary = body
    .split(/[\/／|｜,，。；;]/)[0]
    .replace(/[日夜晨昏]\s*[内外]?$/g, "")
    .replace(/^[0-9]+[.、]\s*/, "");
  return cleanAssetName(primary);
}

function extractTimeTags(line: string) {
  const tags: string[] = [];
  if (/日|白天|清晨|早晨|上午|中午|午后/.test(line)) tags.push("日");
  if (/夜|晚上|深夜|凌晨/.test(line)) tags.push("夜");
  if (/雨|暴雨|下雨/.test(line)) tags.push("雨");
  if (/雪|暴雪|下雪/.test(line)) tags.push("雪");
  if (/雾|烟雾/.test(line)) tags.push("雾");
  return [...new Set(tags)];
}

function assignCharacterRoles(ranked: Array<Omit<CharacterSeed, "role">>) {
  return ranked.map((seed): CharacterSeed => {
    let role = seed.explicitRole || "";
    if (!role) role = inferSupportRole(seed.name, seed.contexts);
    return { ...seed, role };
  });
}

function inferSupportRole(name: string, contexts: string[]) {
  const joined = `${name} ${contexts.join(" ")}`;
  const gender = inferGender(name, joined, "");
  if (/反派|敌人|仇人|背叛|阴谋/.test(joined)) return "反派角色";
  if (gender === "男性") return "男配角";
  if (gender === "女性") return "女配角";
  return "配角";
}

function explicitRoleFromText(text: string) {
  if (/男主/.test(text)) return "男主角";
  if (/女主/.test(text)) return "女主角";
  if (/男配|男反/.test(text)) return "男配角";
  if (/女配|女反/.test(text)) return "女配角";
  if (/反派/.test(text)) return "反派角色";
  if (/主角/.test(text)) return "主角";
  return "";
}

function normalizeRole(role: string) {
  if (/男主/.test(role)) return "男主角";
  if (/女主/.test(role)) return "女主角";
  if (/男配/.test(role)) return "男配角";
  if (/女配/.test(role)) return "女配角";
  if (/反派/.test(role)) return "反派角色";
  return "主角";
}

function roleKeyFromRole(role: string, gender = "") {
  if (/无名配角|群体角色/.test(role)) return "";
  if (/男主/.test(role)) return "maleLead";
  if (/女主/.test(role)) return "femaleLead";
  if (/男配/.test(role)) return "maleSupport";
  if (/女配/.test(role)) return "femaleSupport";
  if (/主角/.test(role) && gender === "男性") return "maleLead";
  if (/主角/.test(role) && gender === "女性") return "femaleLead";
  if (/配角|反派/.test(role) && gender === "男性") return "maleSupport";
  if (/配角|反派/.test(role) && gender === "女性") return "femaleSupport";
  return "";
}

function cleanCharacterName(name: string) {
  return cleanAssetName(String(name || "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/^(一名|一位|两名|两位|数名|几名|多名|一群|一队)/, "")
    .replace(/^(前世|年轻|老年|少年|少女|小)/, "")
    .replace(/(os|vo|OS|VO|若干|数名|多人|一行人|等人)$/i, ""));
}

function isLikelyCharacterName(name: string) {
  const value = cleanCharacterName(name);
  if (value.length < 2 || value.length > 8) return false;
  if (looksLikeNonCharacterAssetName(value)) return false;
  if (!/^[\u4e00-\u9fa5A-Za-z0-9·]+$/.test(value)) return false;
  if (looksLikeSceneOrAction(value) || looksLikePropName(value)) return false;
  return true;
}

function isProperCharacterAssetName(name: string) {
  const value = cleanCharacterName(name);
  if (!isLikelyCharacterName(value)) return false;
  if (/^(这时|此时|突然|镜头|画面|声音|电话|消息|系统提示|正文|大纲)$/.test(value)) return false;
  return true;
}

function looksLikeNonCharacterAssetName(name: string) {
  const value = cleanCharacterName(name);
  if (!value) return true;
  if (isGroupCharacterName(value)) return false;
  if (BANNED_CHARACTER_NAMES.has(value)) return true;
  if (/^(景\d+|场\d+|制作提示|转场字幕|监狱画面|画面提示|镜头提示|字幕提示)$/.test(value)) return true;
  if (/^(今生|前世|重生前|重生后|前期|初期|中期|后期|高潮|开端|结尾|尾声|背景|性格|人设|设定|剧情|简介|梗概|主题|主线|支线|卖点|看点|题材标签|核心看点|人物弧光|角色弧光|性格反差|高光时刻)$/.test(value)) return true;
  if (/(标签|看点|弧光|反差|时刻|阶段|背景|设定|剧情|简介|梗概|主题|主线|支线|卖点|金手指)$/.test(value)) return true;
  if (/^(男主角?|女主角?|男一|女一|男配|女配|主角|配角|反派|黄金配角|渣男前夫)$/.test(value)) return true;
  if (/^(老板|老首长|团长|民警|医生|护士|警察|司机|保镖|助理|秘书|律师|老师|学生|记者|军官|士兵|下属|领导|同事)$/.test(value)) return true;
  if (/^(前夫|前妻|丈夫|妻子|老婆|老公|婆婆|公公|岳父|岳母|父亲|母亲|爸爸|妈妈|爷爷|奶奶|哥哥|姐姐|弟弟|妹妹|孩子|儿子|女儿)$/.test(value)) return true;
  return false;
}

function normalizePropName(name: string) {
  const cleaned = cleanAssetName(name)
    .replace(/^(一把|一支|一个|一辆|这辆|那辆|把|将|用|拿|拿起|握着|掏出|取出|举起|递出|打开|放下|装着|带着|开着|驾驶)/, "")
    .replace(/(放在|放到|拿到|递给|交给|扔进|丢进|放进|放入|放上|用来|用于|冲进|来到|进入|走进|呼救|求救|上|里|中|内|旁|前|后|的时候).*$/, "");
  const keyword = findLongestKeyword(cleaned, PROP_KEYWORDS.map((item) => item.keyword));
  if (keyword && /(缓缓|慢慢|迅速|立刻|突然|直接|随手|伸手|拿|取出|拿出|掏出|递出|握着|举起|打开|放下|装着|带着)/.test(cleaned)) {
    return keyword;
  }
  return cleaned;
}

function normalizeSceneName(name: string, characterNameSet = new Set<string>()) {
  let cleaned = cleanAssetName(name)
    .replace(/^(一间|一个|一座|这间|那间|这座|那座|来到|回到|进入|走进|冲进|离开|赶往|开着|驾驶)/, "")
    .replace(/(门口|里面|外面|之中|附近|角落里|角落|一角|内部).*$/, "");
  for (const characterName of characterNameSet) {
    cleaned = cleaned.replaceAll(characterName, "");
  }
  const descriptorMatch = cleaned.match(/^(狭长|宽敞|昏暗|明亮|空旷|废弃|破旧|老式|巨大|狭窄|温馨|惨白|冷清)([\u4e00-\u9fa5A-Za-z0-9·]{2,10})$/);
  if (descriptorMatch) {
    const specific = findLongestKeyword(descriptorMatch[2], SCENE_KEYWORDS.map((item) => item.keyword));
    if (specific) cleaned = specific;
  }
  const embeddedKeyword = findLongestKeyword(cleaned, SCENE_KEYWORDS.map((item) => item.keyword));
  if (embeddedKeyword && looksLikeSceneDescriptorPhrase(cleaned, embeddedKeyword)) {
    return embeddedKeyword;
  }
  if (/(把|将|放在|放到|来到|进入|走进|冲进|开着|驾驶|用|拿|呼救|求救)/.test(cleaned) || cleaned.length > 14) {
    const keyword = findLongestKeyword(cleaned, SCENE_KEYWORDS.map((item) => item.keyword));
    if (keyword) return keyword;
  }
  return cleanAssetName(cleaned);
}

function normalizeSceneAssetCandidate(name: string, characterNameSet = new Set<string>()) {
  const value = normalizeSceneName(name, characterNameSet);
  if (!value) return "";

  const exactKeyword = findLongestKeyword(value, SCENE_KEYWORDS.map((item) => item.keyword));
  if (exactKeyword && exactKeyword === value) return exactKeyword;

  const matchedKeyword = findLongestKeyword(value, SCENE_KEYWORDS.map((item) => item.keyword));
  if (matchedKeyword && (looksLikePlotEventName(value) || value.length >= matchedKeyword.length + 4)) {
    return matchedKeyword;
  }

  if (looksLikePlotEventName(value)) return "";
  return value;
}

function isInvalidSceneKeywordUsage(line: string, keyword: string) {
  if (keyword === "城堡" && /积木|玩具|搭城堡|堆城堡/.test(line)) return true;
  return false;
}

function looksLikeSceneDescriptorPhrase(value: string, keyword: string) {
  if (value === keyword) return false;
  if (/^(雨夜|雪夜|清晨|早晨|上午|中午|午后|黄昏|傍晚|深夜|凌晨|白天|夜晚|废弃|破败|烧毁|封锁|拥挤|空旷|昏暗|明亮)/.test(value)) {
    return false;
  }
  const tail = value.slice(value.indexOf(keyword) + keyword.length);
  return /(蜿蜒|延伸|通向|通往|穿过|横跨|坐落|矗立|映入|出现|空无一人|灯火通明|人来人往|车流|远处|尽头|两侧|旁边|附近|之中|里面|外面|门口)/.test(value)
    || /^(里|内|外|中|前|后|旁|边|上|下)/.test(tail);
}

function isInvalidPropKeywordUsage(line: string, keyword: string) {
  if (keyword === "弓" && /弓身|弓着腰|弓背|微微弓身|侧身弓背/.test(line)) return true;
  return false;
}

function cleanAssetName(value: string) {
  return String(value || "")
    .replace(/[“”"「」『』《》【】]/g, "")
    .replace(/[，。！？；、,.!?;]+/g, " ")
    .replace(/\s+/g, "")
    .replace(/^[\d第集场幕章节：:\-.、]+/g, "")
    .replace(/[：:].*$/g, "")
    .trim()
    .slice(0, 24);
}

function extractNamesAroundKeyword(line: string, keyword: string) {
  const names: string[] = [];
  const pattern = new RegExp(`[\\u4e00-\\u9fa5A-Za-z0-9·]{0,6}${escapeRegExp(keyword)}[\\u4e00-\\u9fa5A-Za-z0-9·]{0,4}`, "g");
  for (const match of line.matchAll(pattern)) {
    if (match[0]) names.push(match[0]);
  }
  return [...new Set(names)];
}

function findLongestKeyword(value: string, keywords: string[]) {
  return [...keywords]
    .sort((a, b) => b.length - a.length)
    .find((keyword) => value.includes(keyword)) || "";
}

function mergeSeed(map: Map<string, NamedSeed>, incoming: NamedSeed) {
  const key = incoming.name.toLowerCase();
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      ...incoming,
      contexts: incoming.contexts.slice(0, 6),
      times: incoming.times || [],
      variantHints: incoming.variantHints || [],
    });
    return;
  }
  existing.score += incoming.score;
  existing.contexts = [...new Set([...existing.contexts, ...incoming.contexts])].slice(0, 8);
  existing.times = [...new Set([...(existing.times || []), ...(incoming.times || [])])];
  for (const hint of incoming.variantHints || []) appendNamedVariantHint(existing, hint);
}

function dedupeNamedSeeds(seeds: NamedSeed[]) {
  const sorted = [...seeds].sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta) return scoreDelta;
    return b.name.length - a.name.length;
  });
  const results: NamedSeed[] = [];
  for (const seed of sorted) {
    const duplicate = results.some((existing) =>
      existing.name === seed.name ||
      (existing.name.includes(seed.name) && seed.name.length <= 4) ||
      (seed.name.includes(existing.name) && existing.name.length <= 4)
    );
    if (!duplicate) {
      results.push(seed);
      continue;
    }
    const target = results.find((existing) =>
      existing.name === seed.name ||
      existing.name.includes(seed.name) ||
      seed.name.includes(existing.name)
    );
    if (target) {
      target.contexts = [...new Set([...target.contexts, ...seed.contexts])].slice(0, 8);
      target.times = [...new Set([...(target.times || []), ...(seed.times || [])])];
      for (const hint of seed.variantHints || []) appendNamedVariantHint(target, hint);
    }
  }
  return results;
}

function looksLikeCharacterName(name: string, characterNameSet: Set<string>) {
  for (const characterName of characterNameSet) {
    if (!characterName) continue;
    if (name === characterName) return true;
    if (name.includes(characterName)) return true;
    if (characterName.includes(name) && name.length >= 2) return true;
  }
  return false;
}

function looksLikePropName(name: string) {
  return PROP_KEYWORDS.some((item) => name.includes(item.keyword));
}

function inferPropType(name: string) {
  return PROP_KEYWORDS.find((item) => name.includes(item.keyword))?.type || "剧情道具";
}

function isProperPropAssetName(name: string) {
  const value = cleanAssetName(name);
  if (!value || value.length < 2 || value.length > 12) return false;
  if (looksLikeSceneOrAction(value)) return false;
  return PROP_KEYWORDS.some((item) => value.includes(item.keyword));
}

function isProperSceneAssetName(name: string) {
  const value = cleanAssetName(name);
  if (!value || value.length < 2 || value.length > 14) return false;
  if (looksLikeSceneOrAction(value) || looksLikeNonScene(value)) return false;
  return SCENE_KEYWORDS.some((item) => value.includes(item.keyword)) || /空间|房间|大厅|屋顶|据点|广场|营地/.test(value);
}

function inferSceneType(name: string) {
  return SCENE_KEYWORDS.find((item) => name.includes(item.keyword))?.type || "场景空间";
}

function looksLikePlotEventName(name: string) {
  return /(抓奸|确诊|怀了|生下|抱住|击打|带婆婆去|想看|发现|赶走|晕倒|死亡|去世|重生|逆袭|抢了|护妻|团灭|复仇|表白|结婚|离婚|争吵|打脸|揭穿|威胁|绑架|逃跑|追车|开会|冲突|反派|男主|女主|老婆|婆婆|孩子|双胞胎|二胎|五感共享|外挂|剧本|剧情|那条街道|门被|把脉)/.test(name);
}

function looksLikeSceneOrAction(name: string) {
  return /(说道|看到|看见|来到|走进|离开|发现|开始|继续|突然|已经|正在|冲进|转身|拿起|放下|打开|关闭)/.test(name);
}

function looksLikeNonScene(name: string) {
  return /(时候|身边|眼前|心里|手里|声音|电话|镜头|画面|男人|女人|孩子)$/.test(name);
}

function inferGenderFromName(name: string) {
  const value = cleanCharacterName(name);
  if (!value) return "";
  if (/(女|母|妈|姐|妹|嫂|婶|姨|姑|妻|太太|夫人|小姐|姑娘|少女|丫头|公主|娘娘|女儿)/.test(value)) {
    return "女性";
  }
  if (/(婉|娟|婷|娜|玲|丽|芳|霞|媛|妍|倩|珊|莉|兰|梅|莲|燕|颖|瑶|琳|妮|薇|萱|晴|雪|雅|柔|娇|静|洁|慧|敏|怡|悦|彤|佳|诗|梦|琪|儿)$/.test(value)) {
    return "女性";
  }
  if (/(男|父|爸|哥|弟|叔|伯|爷|夫|先生|少爷|公子|王爷|世子|少帅|将军|队长|首长|警官|军医|宪兵|总裁|总工)/.test(value)) {
    return "男性";
  }
  if (/(强|刚|伟|勇|峰|锋|杰|磊|鹏|龙|虎|军|斌|涛|辉|浩|宇|凯|超|健|国|建|华|明|阳|霆|骁|远|川|泽|辰)$/.test(value)) {
    return "男性";
  }
  return "";
}

function countMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].length;
}

function inferGender(name: string, context: string, role = "") {
  if (/男主|男配/.test(role)) return "男性";
  if (/女主|女配/.test(role)) return "女性";
  const nameGender = inferGenderFromName(name);
  if (nameGender) return nameGender;

  const source = `${name} ${context}`;
  let femaleScore = 0;
  let maleScore = 0;
  femaleScore += countMatches(source, /女性|女人|女主|女配|妻子|母亲|妈妈|小姐|姐姐|妹妹|姑娘|少女|夫人|太太/g) * 3;
  maleScore += countMatches(source, /男性|男人|男主|男配|丈夫|父亲|爸爸|先生|哥哥|弟弟|军官|警官|首长|队长/g) * 3;
  femaleScore += countMatches(source, /她|她的/g);
  maleScore += countMatches(source, /他|他的/g);
  if (femaleScore >= maleScore + 2) return "女性";
  if (maleScore >= femaleScore + 2) return "男性";
  return "性别未定";
}

function inferAge(context: string) {
  if (/(老人|老年|爷爷|奶奶|六十|七十|白发)/.test(context)) return "老年";
  if (/(中年|四十|五十|父亲|母亲)/.test(context)) return "中年";
  if (/(少年|少女|学生|十七|十八|孩子)/.test(context)) return "少年";
  if (/(青年|二十|三十|年轻|24岁|26岁|30岁)/.test(context)) return "青年";
  return "年龄未定";
}

function inferTemperament(context: string) {
  const traits: string[] = [];
  if (/(冷静|克制|沉稳|理性|镇定)/.test(context)) traits.push("冷静克制");
  if (/(慌|怕|恐惧|害怕|紧张)/.test(context)) traits.push("紧张敏感");
  if (/(温柔|善良|照顾|关心)/.test(context)) traits.push("温和细腻");
  if (/(强硬|愤怒|暴躁|命令|威严)/.test(context)) traits.push("强势有压迫感");
  if (/(疲惫|虚弱|病|受伤)/.test(context)) traits.push("疲惫脆弱");
  return traits.slice(0, 2).join("，") || "自然真实，情绪层次克制";
}

function buildCharacterProfile(seed: CharacterSeed, joined: string) {
  const gender = inferGender(seed.name, joined, seed.role);
  const age = inferAge(joined);
  const temperament = inferTemperament(joined);
  const identity = [
    gender && gender !== "性别未定" ? `性别识别为${gender}` : "",
    age && age !== "年龄未定" ? `年龄层次为${age}` : "",
    temperament ? `气质为${temperament}` : "",
  ].filter(Boolean).join("，");
  const role = seed.role || "角色";
  const profile = ensureSentenceEnd(
    `${seed.name}是剧本中的${role}${identity ? `，${identity}` : ""}。造型需依据项目时代、题材、身份层级和人物关系建立，保持稳定身份，不复现单场戏对白或动作。`,
  );
  return normalizeCharacterProfileLength(profile, seed.name, seed.role);
}

function normalizeCharacterProfileLength(text: string, name: string, role: string) {
  const sentences = String(text || "")
    .replace(/人物：[^。！？!?]*/g, "")
    .replace(/\s+/g, " ")
    .split(/(?<=[。！？!?])/)
    .map((item) => item.trim())
    .filter(Boolean);
  let profile = sentences.join("");
  if (!profile.startsWith(name)) profile = `${name}是剧本中的${role}。${profile}`;
  if (profile.length > 120) {
    let shortened = "";
    for (const sentence of sentences) {
      if ((shortened + sentence).length > 110) break;
      shortened += sentence;
    }
    profile = shortened || profile.slice(0, 110);
    profile = ensureSentenceEnd(profile);
  }
  if (profile.length < 30) {
    profile += `${name}在剧本中承担${role || "角色"}定位，外在状态随剧情变化但核心身份保持稳定。`;
  }
  return ensureSentenceEnd(profile);
}

const PROMPT_OVERALL_AESTHETIC = "真人实拍摄影质感，自然皮肤毛孔与织物纹理，影棚级光影，35mm 胶片质地。";
function buildOverallAesthetic(projectStyleGuide = "") {
  return [
    PROMPT_OVERALL_AESTHETIC,
    projectStyleGuide,
  ].filter(Boolean);
}

function buildProjectStyleGuide(meta: StoryMetaAnalysis | undefined, script: string, fallbackStyle = "") {
  const seed = [
    meta?.visualStyleBase,
    meta?.genre,
    meta?.background,
    meta?.locationBackground,
    meta?.time,
    fallbackStyle,
    script.slice(0, 500),
  ].filter(Boolean).join("，");
  const eraAnchor = buildEraStyleAnchor(seed);
  let baseStyle = "";
  if (/古装|宫廷|权谋|武侠|仙侠|玄幻|修仙|江湖/.test(seed)) {
    baseStyle = "整体画风：古装写实影视画风，东方古代服饰、建筑、器物、光影与色彩保持统一。";
    return [baseStyle, eraAnchor].filter(Boolean).join("\n");
  }
  if (/末世|废土|丧尸|灾变|避难所|重卡|荒凉|末日/.test(seed)) {
    baseStyle = "整体画风：末世废土写实画风，荒凉废墟、钢铁载具、冷酷战斗、生存压迫感保持统一。";
    return [baseStyle, eraAnchor].filter(Boolean).join("\n");
  }
  if (/民国|年代|军阀|谍战|抗战/.test(seed)) {
    baseStyle = "整体画风：年代写实影视画风，服装、建筑、道具、色彩和光影保持时代质感统一。";
    return [baseStyle, eraAnchor].filter(Boolean).join("\n");
  }
  if (/校园|青春|学生|学校/.test(seed)) {
    baseStyle = "整体画风：青春校园写实画风，人物、场景、服装和道具保持清爽真实的校园质感。";
    return [baseStyle, eraAnchor].filter(Boolean).join("\n");
  }
  if (/都市|豪门|总裁|职场|商业|婚恋/.test(seed)) {
    baseStyle = "整体画风：都市短剧写实画风，人物造型、室内外空间和物品质感保持现代真实。";
    return [baseStyle, eraAnchor].filter(Boolean).join("\n");
  }
  baseStyle = "整体画风：真人短剧写实画风，角色、场景、物品保持同一剧本世界观和视觉风格。";
  return [baseStyle, eraAnchor].filter(Boolean).join("\n");
}

function buildEraStyleAnchor(seed: string) {
  const year = seed.match(/(19[0-9]{2}|20[0-9]{2})\s*年?/);
  if (year) {
    return `时代约束：${year[1]}年，服装、发型、建筑、交通工具、道具、电器和广告字体必须符合该年份，不出现明显跨时代物件。`;
  }
  if (/八十年代|80年代|1980年代|1980s/i.test(seed)) {
    return "时代约束：1980年代中国，服装、发型、建筑、交通工具、生活电器和道具必须符合80年代质感。";
  }
  if (/七十年代|70年代|1970年代|1970s/i.test(seed)) {
    return "时代约束：1970年代中国，服装、发型、建筑、交通工具、生活电器和道具必须符合70年代质感。";
  }
  if (/九十年代|90年代|1990年代|1990s/i.test(seed)) {
    return "时代约束：1990年代中国，服装、发型、建筑、交通工具、生活电器和道具必须符合90年代质感。";
  }
  if (/民国/.test(seed)) {
    return "时代约束：民国时期中国，服饰、建筑、街景、车辆和器物避免现代化元素。";
  }
  if (/古代|架空古代|古风|唐代|宋代|明代|清代|汉代/.test(seed)) {
    return "时代约束：古代或架空古代中国，服饰、建筑、器物、灯具和纹样避免现代工业元素。";
  }
  if (/现代|当代|都市|职场|商业/.test(seed)) {
    return "时代约束：现代中国，服装、空间、电子设备和交通工具保持当代真实质感。";
  }
  return "";
}

function joinPromptSections(sections: Array<[string, string | string[]]>) {
  return sections
    .map(([title, content]) => {
      const body = (Array.isArray(content) ? content : [content])
        .map((line) => String(line || "").trim())
        .filter(Boolean)
        .join("\n");
      return body ? `【${title}】\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function buildCharacterBackground(seed: CharacterSeed) {
  const role = seed.role || "角色";
  const first = ensureSentenceEnd(`${seed.name}的资产设定围绕${role}身份、年龄层次、气质和时代造型展开`);
  const second = ensureSentenceEnd(`${seed.name}的主图用于后续分镜复用，应表现可长期保持的人物识别点，而不是某一句对白或单场戏动作`);
  return `${first}\n${second}`;
}

function buildCharacterProfileSummary(name: string, role: string, profile: string, background: string) {
  const sourceLines = [
    profile,
    ...String(background || "").split(/\n+/),
  ]
    .map((line) => cleanPromptSentence(line))
    .filter(Boolean);
  const first = shortenPromptLine(
    sourceLines[0] || `${name}是剧本中的${role}，承担清晰的人物定位。`,
    72,
  );
  const second = shortenPromptLine(
    sourceLines[1] || `${name}的主要剧情围绕身份选择、人物关系和关键冲突展开。`,
    72,
  );
  const third = shortenPromptLine(
    sourceLines.slice(2).join("") || `${name}在剧情推进、情绪转折和阵营关系中承担重要作用。`,
    72,
  );
  return [first, second, third].join("\n");
}

function cleanPromptSentence(text: string) {
  return String(text || "")
    .replace(/^主体[:：]\s*/, "")
    .replace(/^[\u4e00-\u9fa5A-Za-z0-9·]{1,12}(?:[（(][^）)]{1,24}[）)])?[：:]\s*/g, "")
    .replace(/人物[:：][^。！？!?]*/g, "")
    .replace(/【[\s\S]*$/g, "")
    .replace(/模板锁定[:：][\s\S]*$/g, "")
    .replace(/身份约束[:：][\s\S]*$/g, "")
    .replace(/[！？]{2,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shortenPromptLine(text: string, maxLength: number) {
  const value = cleanPromptSentence(text);
  if (!value) return "";
  const compact = value.length > maxLength
    ? value.slice(0, maxLength).replace(/[，,；;：:、][^，,；;：:、]*$/, "")
    : value;
  return ensureSentenceEnd(compact);
}

function buildCharacterVisualAnchors(
  name: string,
  role: string,
  profile: string,
  background: string,
) {
  const text = `${name} ${role} ${profile} ${background}`;
  const anchors: string[] = [];
  if (/医生|军医|护士|护工|大夫|医师|医疗官|外科|急救/.test(text)) {
    anchors.push("医疗职业必须可视化：服装、配件和工作状态体现医生、护士或医疗人员身份；可使用白大褂、医疗胸牌、急救包、医用腰包或年代匹配的医疗用品，避免普通棚拍装。");
  }
  if (/重卡|指挥官|车队|队长|战神|救援/.test(text)) {
    anchors.push("指挥/车队身份必须可视化：服装体现末世重卡指挥官或救援队核心身份，可使用战术夹克、工装裤、战术靴、腰挂装备、通讯配件等，不要普通黑衬衫棚拍。");
  }
  if (/工程师|工兵|机械|焊接|维修|工厂|技工/.test(text)) {
    anchors.push("工程职业必须可视化：服装和配件体现机械工程师或工兵身份，可使用耐磨工装、工具腰带、焊接痕迹、机械油污或护具。");
  }
  if (/反派|暴君|城主|军官|武装|势力|黑市|商会|将军|首长/.test(text)) {
    anchors.push("阵营身份必须可视化：服装、配饰和气质体现所属势力、权力层级或黑市/武装背景，避免普通路人造型。");
  }
  anchors.push("整体画风必须落到服装材质、配件磨损、妆发状态、色彩气氛和资产细节；禁止与角色档案无关的普通都市棚拍装。");
  return anchors.slice(0, 3);
}

function buildCharacterImagePrompt(
  name: string,
  role: string,
  profile: string,
  background: string,
  visualConstraints: string,
  faceTemplate: FaceTemplate | null,
  projectStyleGuide: string,
) {
  const templateLock = faceTemplate
    ? `参考${faceTemplate.label}（${faceTemplate.url}），脸型、五官比例、眉眼鼻唇关系、骨相和面部辨识度必须与模板一致。`
    : "同一角色身份锁定，脸型、五官比例、眉眼鼻唇关系、骨相和面部辨识度必须保持一致。";
  const genderConstraint = /男/.test(role)
    ? "性别识别保持男性，不改变年龄层次和人物辨识度。"
    : /女/.test(role)
      ? "性别识别保持女性，不改变年龄层次和人物辨识度。"
      : "";
  const supportConstraint = faceTemplate ? genderConstraint : [genderConstraint, visualConstraints].filter(Boolean).join("；");
  return joinPromptSections([
    ["整体美学", buildOverallAesthetic(projectStyleGuide)],
    ["画面规格", [
      `角色设定图，“${name}”，16:9 横版，纯白背景，平视视角。`,
      "左 40%：3/4 面部近景；右 60%：正面、侧面、背面全身三视图。",
      "单人完整入画，头脚不裁切；服装、发型、配饰、身材比例和肤色保持一致。",
    ]],
    ["角色档案", buildCharacterProfileSummary(name, role, profile, background)],
    ["职业与画风锚点", buildCharacterVisualAnchors(name, role, profile, background)],
    ["模板锁定", [
      `${templateLock}只允许改变发型、服装、妆造强弱和剧情状态，不改变脸型与五官。`,
      supportConstraint ? `身份约束：${supportConstraint}` : "",
    ]],
    ["排除项", "无字幕、文字、Logo、水印、UI；无其他人物；不复制身体或同脸分身；禁止漫画风、二次元、插画风。"],
  ]);
}

function buildPropImagePrompt(name: string, type: string, description: string, projectStyleGuide: string) {
  const assetType = type || "剧情道具";
  const propFallback = `${name}是剧本中的${assetType}，需体现核心功能、材质结构和关键识别特征。`;
  const assetDescription = ensureSentenceEnd(
    compactText(propFallback, 120)
      .replace(/\s+/g, " ")
      .trim(),
  );
  return joinPromptSections([
    ["整体美学", buildOverallAesthetic(projectStyleGuide)],
    ["画面规格", `物品参考图，“${name}”。单个物品，居中构图，纯白背景，正面视角，完整展示全貌与表面质感。`],
    ["物品档案", [
      `类型：${assetType}。${assetDescription}`,
      "突出形状、尺寸、材质、颜色、磨损痕迹和可反复识别的细节。",
      "物品必须与剧本用途和整体画风强相关，功能、材质、使用痕迹和时代/世界观特征要清晰可见。",
    ]],
    ["排除项", "无字幕、文字、Logo、水印；无持握者、手、人物、人影；无背景环境。"],
  ]);
}

function buildSceneImagePrompt(name: string, type: string, description: string, times: string[], projectStyleGuide: string) {
  const sceneType = type || "剧情场景";
  const timeText = times.length ? `可扩展为${times.map((time) => `${time}景`).join("、")}。` : "";
  const sceneFallback = `${name}是剧本中的${sceneType}，需要建立稳定的空间结构、环境氛围和可复用方位关系。`;
  const sceneDescription = ensureSentenceEnd(
    `${compactText(sceneFallback, 140)}${timeText}`
      .replace(/\s+/g, " ")
      .trim(),
  );
  return joinPromptSections([
    ["整体美学", buildOverallAesthetic(projectStyleGuide)],
    ["画面规格", `环境概念图，“${name}”。16:9 宽银幕，大全景，超广角，平视视角，大气透视。`],
    ["环境档案", [
      `空间类型：${sceneType}。${sceneDescription}`,
      "突出空间尺度、布局、建筑材质、主色调、标志性陈设和光源基调。",
      "环境必须与剧本整体画风强相关，建筑、陈设、磨损、光线和氛围不能变成通用干净场景。",
    ]],
    ["排除项", "无字幕、文字、Logo、水印；无人物、人影、行人、路人。"],
  ]);
}

function suggestCharacterVariants(name: string, role: string, snippets: string[], faceTemplate: FaceTemplate | null) {
  const joined = snippets.join(" ");
  const faceLock = faceTemplate
    ? `严格参考${faceTemplate.label}，锁定脸型、五官、眉眼鼻唇比例、骨相和面部辨识度；`
    : "锁定脸型、五官、眉眼鼻唇比例、骨相和面部辨识度；";
  const identityRule = `${faceLock}真人实拍摄影质感，禁止漫画风、二次元和插画感；只允许改变发型、服装、妆造强弱和剧情状态，不改变脸型与五官。`;
  if (!/男主|女主|主角/.test(role)) {
    return [{
      name: `${name}备用变体`,
      description: `备用状态：保留${name}的角色身份和面部辨识度，仅调整发型、服装、妆造强弱或轻微剧情状态。`,
      prompt: `人物资产变体，${name}，${role}，备用造型，${identityRule}纯白背景。`,
      imageUrl: "",
      history: [],
    }];
  }

  const variantSets: Array<{ test: RegExp; items: Array<[string, string, string]> }> = [
    {
      test: /末世|丧尸|重生|系统|物资|车队|堡垒|救援|逃亡|尸潮|废土|战斗/,
      items: [
        ["末世行动状态", "末世行动状态：适合外出搜寻物资、驾驶车辆、穿越危险区域或推进救援任务，服装利落耐磨，发型可略凌乱。", "末世行动状态，外出搜寻物资或推进救援任务，利落耐磨服装，轻微尘土和紧张感"],
        ["战斗戒备状态", "战斗戒备状态：适合遭遇丧尸、敌对幸存者或突发危机，表情警觉，动作蓄势，只增强剧情压力感。", "战斗戒备状态，警觉表情，动作蓄势，危机氛围"],
        ["资源筹备状态", "资源筹备状态：适合整理物资、检查装备、规划路线或做关键决策，服装整洁克制，状态更冷静。", "资源筹备状态，整理装备或规划路线，冷静克制表情"],
        ["受伤疲惫状态", "受伤疲惫状态：适合奔波、受伤、体力透支或撤离后的剧情，只调整妆发凌乱度、气色和服装污损。", "受伤疲惫状态，妆发略乱，气色疲惫，轻微污损"],
        ["高压对峙状态", "高压对峙状态：适合背叛、审问、冲突或关键摊牌，表情更压抑锐利，妆造强度略提升。", "高压对峙状态，压抑锐利表情，冲突或摊牌氛围"],
      ],
    },
    {
      test: /婚礼|婚姻|订婚|豪门|总裁|公司|职场|会议|发布会|商业|办公室/,
      items: [
        ["日常职场状态", "日常职场状态：适合办公室、会议前后或常规沟通，服装干练，表情自然克制。", "日常职场状态，干练通勤服装，自然克制表情"],
        ["正式会面状态", "正式会面状态：适合谈判、发布会、宴会或重要亮相，服装正式，妆造完整但不改变五官。", "正式会面状态，正式服装，完整妆造，重要亮相"],
        ["情绪拉扯状态", "情绪拉扯状态：适合争执、误会、告白或关系转折，表情有情绪张力，妆造略加强。", "情绪拉扯状态，情绪张力，关系转折氛围"],
        ["私下独处状态", "私下独处状态：适合居家、车内、休息室或夜间独处，服装更生活化，情绪更松弛。", "私下独处状态，生活化服装，松弛或沉思表情"],
        ["高光亮相状态", "高光亮相状态：适合婚礼、红毯、宴会或剧情高光，服装更精致，妆造强度提升。", "高光亮相状态，精致服装，剧情高光氛围"],
      ],
    },
    {
      test: /校园|学校|学生|校服|课堂|社团|考试|青春/,
      items: [
        ["校园日常状态", "校园日常状态：适合课堂、走廊、宿舍或校园对白，服装清爽自然，表情生活化。", "校园日常状态，清爽自然服装，生活化表情"],
        ["校服版本", "校服版本：适合上课、集会或校园关键场景，仅替换为剧本指定校服和对应发型。", "校服版本，剧本指定校服，校园场景"],
        ["奔跑追逐状态", "奔跑追逐状态：适合操场、雨中、追赶或突发事件，发型可有轻微动态变化。", "奔跑追逐状态，轻微动态感，校园突发事件"],
        ["低落独处状态", "低落独处状态：适合天台、教室角落或夜间独处，表情压抑，妆造保持自然。", "低落独处状态，压抑情绪，独处氛围"],
        ["青春高光状态", "青春高光状态：适合获奖、告白、舞台或毕业等高光场景，状态更明亮。", "青春高光状态，明亮情绪，校园高光场景"],
      ],
    },
  ];
  const selected = variantSets.find((set) => set.test.test(joined))?.items || [
    ["日常对白状态", "日常对白状态：适合常规对白和生活场景，服装自然，表情克制，保持同一人物脸型五官。", "日常对白状态，生活化服装，自然表情"],
    ["外出行动状态", "外出行动状态：适合移动、调查、赴约或推进剧情，服装更利落，发型可略有变化。", "外出行动状态，利落服装，轻微动态感"],
    ["高压情绪状态", "高压情绪状态：适合冲突、对峙、误会或关键抉择，妆造略加强，表情更有压力。", "高压情绪状态，表情紧绷，妆造略加强"],
    ["疲惫受挫状态", "疲惫受挫状态：适合长时间奔波、受伤、崩溃或失落后的剧情，只改变气色和妆发状态。", "疲惫受挫状态，妆发略乱，气色疲惫"],
    ["高光亮相状态", "高光亮相状态：适合会面、仪式、反转或高光出场，服装更正式，妆造更完整。", "高光亮相状态，正式服装，完整妆造"],
  ];
  return selected.slice(0, 5).map(([suffix, description, promptDetail]) => ({
    name: `${name}${suffix}`,
    description,
    prompt: `人物资产变体，${name}，${promptDetail}，${identityRule}纯白背景。`,
    imageUrl: "",
    history: [],
  }));
}

function variantHintsToAssetVariants(name: string, hints: CharacterVariantHint[], faceTemplate: FaceTemplate | null): AssetAgentVariant[] {
  if (!hints.length) return [];
  const faceLock = faceTemplate
    ? `严格参考${faceTemplate.label}，锁定脸型、五官、眉眼鼻唇比例、骨相和面部辨识度；`
    : "锁定脸型、五官、眉眼鼻唇比例、骨相和面部辨识度；";
  return hints.map((hint) => ({
    name: hint.name,
    variantType: hint.variantType,
    description: hint.description,
    prompt: `人物资产变体，${name}，${hint.promptDetail}，${faceLock}真人实拍摄影质感，只改变服装、妆造、表情、体态或剧情状态，不改变角色身份。纯白背景。`,
    imageUrl: "",
    history: [],
  }));
}

function variantHintsToPropVariants(name: string, type: string, hints: AssetVariantHint[], basePrompt: string): AssetAgentVariant[] {
  if (!hints.length) return [];
  const identityRule = `物品资产变体，${name}，${type}；严格保持同一物品的核心形状、材质、比例、颜色体系和标志性细节，只改变剧情状态；无人物、无手、无文字水印。`;
  return hints.map((hint) => ({
    name: hint.name,
    variantType: hint.variantType,
    description: hint.description,
    prompt: `${basePrompt}\n\n【变体要求】${identityRule}${hint.promptDetail}。`,
    imageUrl: "",
    history: [],
  }));
}

function variantHintsToSceneVariants(name: string, hints: AssetVariantHint[], basePrompt: string): AssetAgentVariant[] {
  if (!hints.length) return [];
  const identityRule = `场景资产变体，${name}；严格保持同一空间结构、主要陈设、镜头高度、镜头方位和空间比例一致，只改变时间、天气、灯光、氛围或剧情状态；无人物、无文字水印。`;
  return hints.map((hint) => ({
    name: hint.name,
    variantType: hint.variantType,
    description: hint.description,
    prompt: `${basePrompt}\n\n【变体要求】${identityRule}${hint.promptDetail}。`,
    imageUrl: "",
    history: [],
  }));
}

function mergeAssetVariants(primary: AssetAgentVariant[], secondary: AssetAgentVariant[]) {
  const seen = new Set<string>();
  return [...primary, ...secondary].filter((variant) => {
    const key = cleanAssetName(variant.name || variant.description || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function suggestSceneVariants(name: string, times: string[], basePrompt: string) {
  const normalizedTimes = [...new Set(times || [])];
  if (normalizedTimes.length < 2) return [];
  return normalizedTimes.map((time) => ({
    name: `${name}${time}变体`,
    variantType: inferSceneVariantType(time, extractTimeTags(time)),
    description: `同一场景的${time}版本，空间结构、陈设和镜头方位不变。`,
    prompt: `${basePrompt}\n\n【变体要求】${time}版本。保持同一空间结构、主要陈设、镜头高度和镜头方位一致，只改变自然光/灯光、天气氛围和时间段。`,
    imageUrl: "",
    history: [],
  }));
}

function suggestPropVariants(name: string, type: string, snippets: string[], basePrompt: string) {
  const joined = snippets.join(" ");
  const variantRules: Array<{ test: RegExp; suffix: string; variantType: string; description: string; promptDetail: string }> = [
    {
      test: /完好|崭新|干净|未拆|未开封|完整/,
      suffix: "完好状态",
      variantType: "condition",
      description: "完好状态：保留物品的基础造型、材质、比例和可识别细节，表面干净完整。",
      promptDetail: "完好状态，表面完整干净，材质和标志性细节清晰",
    },
    {
      test: /破损|损坏|裂|碎|断|摔坏|砸坏|烧焦|磨损|旧/,
      suffix: "破损状态",
      variantType: "damaged",
      description: "破损状态：同一物品在剧情受损后的版本，只改变破损、磨损、烧焦或裂痕等状态。",
      promptDetail: "破损状态，保留同一物品核心造型，增加磨损、裂痕或损坏痕迹",
    },
    {
      test: /血|染血|血迹/,
      suffix: "染血状态",
      variantType: "stained",
      description: "染血状态：同一物品沾染血迹或污渍后的剧情版本，形状和材质保持一致。",
      promptDetail: "染血状态，局部血迹或污渍，核心形状材质不变",
    },
    {
      test: /打开|开启|展开|翻开|拆开/,
      suffix: "打开状态",
      variantType: "open",
      description: "打开状态：同一物品被打开、展开或拆开的版本，突出内部结构和使用状态。",
      promptDetail: "打开状态，展示内部结构或展开形态，保持同一物品识别度",
    },
    {
      test: /关闭|合上|锁上|封住|收起/,
      suffix: "关闭状态",
      variantType: "closed",
      description: "关闭状态：同一物品合上、锁住或收起后的版本，外形轮廓稳定统一。",
      promptDetail: "关闭状态，外部轮廓清晰，锁扣或封闭结构可见",
    },
    {
      test: /空的|空箱|空包|空瓶|装满|满满|塞满|物资/,
      suffix: "装载状态",
      variantType: "load_state",
      description: "装载状态：同一容器或物资类道具在空、满或装载物资时的剧情版本。",
      promptDetail: "装载状态，体现空满差异或内部物资，外部结构保持一致",
    },
    {
      test: /佩戴|戴上|穿上|披上|制服|外套|面具/,
      suffix: "佩戴状态",
      variantType: "worn",
      description: "佩戴状态：同一服饰或随身物品被穿戴/佩戴时的版本，强调材质和识别符号。",
      promptDetail: "佩戴状态，服饰或随身物品处于被使用状态，核心设计一致",
    },
  ];
  const selected = variantRules.filter((rule) => rule.test.test(joined)).slice(0, 4);
  if (!selected.length) return [];
  const identityRule = `物品资产变体，${name}，${type}；严格保持同一物品的核心形状、材质、比例、颜色体系和标志性细节，只改变剧情状态；无人物、无手、无文字水印。`;
  return selected.map((rule) => ({
    name: `${name}${rule.suffix}`,
    variantType: rule.variantType,
    description: rule.description,
    prompt: `${basePrompt}\n\n【变体要求】${identityRule}${rule.promptDetail}。`,
    imageUrl: "",
    history: [],
  }));
}

function inferEpisodeRefs(text: string, name: string, episodes: string[]) {
  if (!episodes.length) return ["EP1"];
  const refs: string[] = [];
  const chunks = splitEpisodeChunks(text, episodes);
  for (const chunk of chunks) {
    if (chunk.text.includes(name)) refs.push(chunk.id);
  }
  return [...new Set(refs)].slice(0, 20);
}

function splitEpisodeChunks(text: string, episodes: string[]) {
  const matches = [...text.matchAll(/第\s*([0-9一二两三四五六七八九十百]+)\s*[集幕场章]/g)];
  if (!matches.length) return [{ id: episodes[0] || "EP1", text }];
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = matches[index + 1]?.index || text.length;
    const id = `EP${toArabic(match[1]) || match[1]}`;
    return { id, text: text.slice(start, end) };
  });
}

function findSnippets(text: string, keyword: string) {
  const snippets: string[] = [];
  const lines = text.split("\n").filter((line) => line.includes(keyword));
  for (const line of lines.slice(0, 8)) {
    snippets.push(compactText(line, 120));
  }
  return snippets;
}

function compactText(text: string, maxLength: number) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function ensureSentenceEnd(text: string) {
  const cleaned = String(text || "").replace(/\s+/g, " ").replace(/\.\.\.|…/g, "").trim();
  if (!cleaned) return "";
  return /[。！？!?]$/.test(cleaned) ? cleaned : `${cleaned}。`;
}

function defaultNegativePrompt(category: AssetCategory) {
  const common = "字幕, 文字, logo, 水印, UI, 低清晰度, 畸形, 多余肢体, 错误透视";
  if (category === "props") return `${common}, 人物, 人手, 背景环境, 反光字样`;
  if (category === "scenes") return `${common}, 人物, 人影, 行人, 现代无关物件`;
  return `${common}, 多人, 角色重复, 五官变形, 服装不一致`;
}

function toArabic(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value === "十") return 10;
  if (value.includes("百")) {
    const [left, right] = value.split("百");
    return (map[left] || 1) * 100 + (right ? toArabic(right) : 0);
  }
  if (value.includes("十")) {
    const [left, right] = value.split("十");
    return (map[left] || 1) * 10 + (map[right] || 0);
  }
  return map[value] || 0;
}

function countOccurrences(text: string, keyword: string) {
  return [...text.matchAll(new RegExp(escapeRegExp(keyword), "g"))].length;
}

function bump(map: Map<string, number>, key: string, value = 1) {
  map.set(key, (map.get(key) || 0) + value);
}

function remember(map: Map<string, string[]>, key: string, value: string) {
  if (!value) return;
  const list = map.get(key) || [];
  if (!list.includes(value)) list.push(value);
  map.set(key, list.slice(0, 6));
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "asset";
}
