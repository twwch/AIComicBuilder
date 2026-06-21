export interface StylePreset {
  id: string;
  zh: string;
  en: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: "chinese-shadow-puppets", zh: "皮影戏", en: "Chinese Shadow Puppets" },
  { id: "cyberpunk", zh: "赛博朋克", en: "Cyberpunk" },
  { id: "steampunk", zh: "蒸汽朋克", en: "Steampunk" },
  { id: "dieselpunk", zh: "柴油朋克", en: "Dieselpunk" },
  { id: "solarpunk", zh: "太阳朋克", en: "Solarpunk" },
  { id: "lunarpunk", zh: "月亮朋克", en: "Lunarpunk" },
  { id: "elfpunk", zh: "精灵朋克", en: "Elfpunk" },
  { id: "normcore", zh: "极简主义", en: "Normcore" },
  { id: "metalcore", zh: "金属核", en: "Metalcore" },
  { id: "deathcore", zh: "死亡核", en: "Deathcore" },
  { id: "dreamcore", zh: "梦幻核", en: "Dreamcore" },
  { id: "weirdcore", zh: "怪异核", en: "Weirdcore" },
  { id: "naturalism", zh: "自然主义", en: "Naturalism" },
  { id: "modernism", zh: "现代主义", en: "Modernism" },
  { id: "postmodernism", zh: "后现代主义", en: "Postmodernism" },
  { id: "hypermodernism", zh: "超现代主义", en: "Hypermodernism" },
  { id: "2d-illustration", zh: "二维插画", en: "2D Illustration" },
  { id: "medieval-illustration", zh: "中世纪插画", en: "Medieval Illustration" },
  { id: "olmec", zh: "奥尔梅克", en: "Olmec" },
  { id: "fantasy", zh: "幻想", en: "Fantasy" },
  { id: "synesthesia", zh: "共感觉", en: "Synesthesia" },
  { id: "coloring-book", zh: "着色书", en: "Coloring Book" },
  { id: "religious-icon", zh: "宗教图标", en: "Religious Icon" },
  { id: "chibi", zh: "卡通", en: "Chibi" },
  { id: "qajar", zh: "卡贾尔", en: "Qajar" },
  { id: "sumi-e", zh: "日本水墨画", en: "Sumi-e" },
  { id: "science-fiction", zh: "科幻", en: "Science Fiction" },
  { id: "realism", zh: "写实", en: "Realism" },
  { id: "minimalism", zh: "极简", en: "Minimalism" },
  { id: "retrofuturism", zh: "复古未来主义", en: "Retrofuturism" },
  { id: "astropunk", zh: "星系朋克", en: "Astropunk" },
  { id: "funny-pop", zh: "搞笑流行", en: "Funny Pop" },
  { id: "digital-art", zh: "数字艺术", en: "Digital Art" },
  { id: "macabre", zh: "恐怖", en: "Macabre" },
  { id: "installation-art", zh: "安装艺术", en: "Installation Art" },
  { id: "futuresynth", zh: "未来合成", en: "Futuresynth" },
  { id: "chinoiserie", zh: "中国风", en: "Chinoiserie" },
  { id: "carolingian-art", zh: "卡洛林艺术", en: "Carolingian Art" },
  { id: "byzantine-art", zh: "拜占庭艺术", en: "Byzantine Art" },
  { id: "dunhuang-art", zh: "敦煌艺术", en: "Dunhuang Art" },
  { id: "ancient-greek-art", zh: "古希腊艺术", en: "Ancient Greek Art" },
  { id: "ancient-roman-art", zh: "古罗马艺术", en: "Ancient Roman Art" },
  { id: "ancient-egyptian-art", zh: "古埃及艺术", en: "Ancient Egyptian Art" },
  { id: "sienese-art", zh: "耶纳艺术", en: "Sienese Art" },
  { id: "romanesque", zh: "罗马式", en: "Romanesque" },
  { id: "rococo", zh: "可可", en: "Rococo" },
  { id: "pop-art", zh: "波普艺术", en: "Pop Art" },
  { id: "neoclassicism", zh: "新古典主义", en: "Neoclassicism" },
  { id: "mannerism", zh: "风格主义", en: "Mannerism" },
  { id: "manga", zh: "漫画", en: "Manga" },
  { id: "aboriginal-art", zh: "原住民艺术", en: "Aboriginal Art" },
  { id: "dark-fantasy", zh: "黑暗幻想", en: "Dark Fantasy" },
  { id: "gothic", zh: "哥特", en: "Gothic" },
  { id: "constructivism", zh: "构成主义", en: "Constructivism" },
  { id: "maximalism", zh: "极致主义", en: "Maximalism" },
  { id: "fauvism", zh: "野兽派", en: "Fauvism" },
  { id: "harlem-renaissance", zh: "哈莱姆文艺复兴", en: "Harlem Renaissance" },
  { id: "abstract-expressionism", zh: "抽象表现主义", en: "Abstract Expressionism" },
  { id: "renaissance", zh: "文艺复兴", en: "Renaissance" },
  { id: "pre-raphaelite", zh: "前拉斐尔派", en: "Pre-Raphaelite" },
  { id: "post-impressionism", zh: "后印象派", en: "Post-Impressionism" },
  { id: "pointillism", zh: "点彩派", en: "Pointillism" },
  { id: "neo-impressionism", zh: "新印象派", en: "Neo-Impressionism" },
  { id: "neo-classicism", zh: "新古典主义", en: "Neo-Classicism" },
  { id: "kawaii", zh: "可爱", en: "Kawaii" },
  { id: "jazz-age", zh: "爵士时代", en: "Jazz Age" },
  { id: "belle-epoque", zh: "美好时代", en: "Belle Epoque" },
  { id: "de-stijl", zh: "风格派", en: "De Stijl" },
  { id: "art-nouveau", zh: "新艺术运动", en: "Art Nouveau" },
  { id: "art-deco", zh: "装饰艺术", en: "Art Deco" },
  { id: "futurism", zh: "未来主义", en: "Futurism" },
  { id: "letterism", zh: "字母主义", en: "Letterism" },
  { id: "folk-art", zh: "民间艺术", en: "Folk Art" },
  { id: "impressionism", zh: "印象派", en: "Impressionism" },
  { id: "propaganda-art", zh: "宣传艺术", en: "Propaganda Art" },
  { id: "muralism", zh: "壁画主义", en: "Muralism" },
  { id: "pixel-art", zh: "像素艺术", en: "Pixel Art" },
  { id: "deconstructivism", zh: "解构主义", en: "Deconstructivism" },
  { id: "hyperrealism", zh: "超现实主义", en: "Hyperrealism" },
  { id: "bauhaus", zh: "包豪斯", en: "Bauhaus" },
  { id: "magic-realism", zh: "魔幻现实主义", en: "Magic Realism" },
  { id: "suprematism", zh: "至上主义", en: "Suprematism" },
  { id: "panfuturism", zh: "泛未来主义", en: "Panfuturism" },
  { id: "90s-commercial", zh: "90年代商业", en: "90s Commercial" },
  { id: "synthwave", zh: "合成波", en: "Synthwave" },
  { id: "vaporwave", zh: "蒸发波", en: "Vaporwave" },
  { id: "gothpunk", zh: "哥特朋克", en: "Gothpunk" },
  { id: "necropunk", zh: "亡灵朋克", en: "Necropunk" },
  { id: "biopunk", zh: "生物朋克", en: "Biopunk" },
  { id: "atompunk", zh: "原子朋克", en: "Atompunk" },
  { id: "expressionism", zh: "表现主义", en: "Expressionism" },
  { id: "baroque", zh: "巴洛克", en: "Baroque" },
  { id: "surrealism", zh: "超现实主义", en: "Surrealism" },
  { id: "cubism", zh: "立体派", en: "Cubism" },
  { id: "afrofuturism", zh: "非洲未来主义", en: "Afrofuturism" },
  { id: "funk-art", zh: "放克艺术", en: "Funk Art" },
  { id: "stick-figure", zh: "棍子图", en: "Stick Figure Drawing" },
  { id: "paper-cutout", zh: "剪纸插画风格", en: "Paper Cutout Illustration" },
  { id: "knolling", zh: "平铺罗列风格", en: "Knolling Style" },
  { id: "disney-style", zh: "迪士尼风格", en: "Disney Style" },
  { id: "watercolor", zh: "水彩画", en: "Watercolor Paint" },
  { id: "holographic", zh: "全息色彩风格", en: "Holographic" },
  { id: "film-still", zh: "电影风格", en: "Film Still" },
  { id: "anime-style", zh: "二次元风格", en: "Anime Style" },
  { id: "cyberpunk-style", zh: "赛博朋克风格", en: "Cyberpunk Style" },
  { id: "minimalist-design", zh: "极简主义风格", en: "Minimalist Design" },
  { id: "general-styles", zh: "通用风格", en: "General Styles" },
  { id: "genre-styles", zh: "流派风格", en: "Genre Styles" },
  { id: "science-fiction-genre", zh: "科幻小说", en: "Science Fiction" },
  { id: "minimalism-genre", zh: "极简主义", en: "Minimalism" },
  { id: "impressionism-genre", zh: "印象派", en: "Impressionism" },
  { id: "oil-painting", zh: "油画", en: "Oil Painting" },
  { id: "collage", zh: "拼贴画", en: "Collage" },
  { id: "3d-art", zh: "3D艺术", en: "3D Art" },
  { id: "abstract-art", zh: "抽象艺术", en: "Abstract Art" },
  { id: "surrealism-genre", zh: "超现实主义", en: "Surrealism" },
];

export function formatStylePreset(style: StylePreset): string {
  return `${style.zh} / ${style.en}`;
}

export function extractVisualStyleReference(text: string | null | undefined): string {
  if (!text) return "";
  const line = text.split(/\r?\n/).find((entry) => entry.trim().startsWith("视觉风格参考："));
  return line?.split("：").slice(1).join("：").trim() || "";
}

export function extractVisualStyleValue(text: string | null | undefined): string {
  if (!text) return "";
  const line = text.split(/\r?\n/).find((entry) => entry.trim().startsWith("视觉风格："));
  return line?.split("：").slice(1).join("：").trim() || "";
}

export function findStylePresetIdByReference(reference: string | null | undefined): string | null {
  const normalized = (reference || "").trim();
  if (!normalized) return null;
  const exact = STYLE_PRESETS.find((style) => formatStylePreset(style) === normalized);
  if (exact) return exact.id;
  const loose = STYLE_PRESETS.find((style) =>
    style.zh === normalized ||
    style.en.toLowerCase() === normalized.toLowerCase()
  );
  return loose?.id ?? null;
}
