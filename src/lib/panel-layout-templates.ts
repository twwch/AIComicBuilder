import type { scenes } from "@/lib/db/schema";

export type PanelType = "panel_1" | "panel_2" | "panel_3" | "panel_4";

export interface PanelSlot {
  type: PanelType;
  label: string;
  getDescription: (ctx: PanelContext) => string;
}

export interface PanelContext {
  shotPrompt: string;
  startFrameDesc: string | null;
  endFrameDesc: string | null;
  videoScript: string | null;
  motionScript: string | null;
  cameraDirection: string | null;
  compositionGuide: string | null;
  focalPoint: string | null;
  depthOfField: string | null;
  scene: {
    title: string;
    description: string;
    lighting: string;
    colorPalette: string;
  } | null;
  characterDescriptions: string;
  costumeOverrides: string | null;
}

function s(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join("；");
}

// ── Template: Standard Narrative ──
const storyStandard: PanelLayoutTemplate = {
  id: "story_standard",
  name: "标准叙事",
  match: (ctx) => {
    if (!ctx.cameraDirection || ctx.cameraDirection === "static" || ctx.cameraDirection === "pan") return 60;
    return 30;
  },
  slots: [
    {
      type: "panel_1", label: "PANEL 1（全景开场）",
      getDescription: (ctx) => s(
        ctx.startFrameDesc || ctx.shotPrompt,
        ctx.scene ? `场景环境：${ctx.scene.description}` : null,
        ctx.scene?.lighting ? `光照：${ctx.scene.lighting}` : null,
        `景深：${ctx.depthOfField || "medium"}`
      ),
    },
    {
      type: "panel_2", label: "PANEL 2（中景推进）",
      getDescription: (ctx) => s(
        ctx.shotPrompt,
        ctx.cameraDirection && ctx.cameraDirection !== "static" ? `镜头运动：${ctx.cameraDirection}` : null,
        ctx.compositionGuide || null,
        ctx.motionScript ? `动作：${ctx.motionScript}` : null,
      ),
    },
    {
      type: "panel_3", label: "PANEL 3（特写情绪）",
      getDescription: (ctx) => s(
        ctx.videoScript || ctx.shotPrompt,
        ctx.focalPoint && ctx.focalPoint !== "wide" ? `焦点：${ctx.focalPoint}` : null,
        `景深：shallow`,
        ctx.scene?.colorPalette ? `色调：${ctx.scene.colorPalette}` : null,
      ),
    },
    {
      type: "panel_4", label: "PANEL 4（全景收束）",
      getDescription: (ctx) => s(
        ctx.endFrameDesc || ctx.videoScript || ctx.shotPrompt,
        ctx.scene?.description ? `场景：${ctx.scene.description}` : null,
        ctx.scene?.lighting ? `最终光照：${ctx.scene.lighting}` : null,
        `景深：${ctx.depthOfField || "deep"}`,
      ),
    },
  ],
};

// ── Template: Dialogue Conversation ──
const dialogue: PanelLayoutTemplate = {
  id: "dialogue",
  name: "对话场景",
  match: (ctx) => {
    const charCount = ctx.characterDescriptions
      ? ctx.characterDescriptions.split(/[，,]/).length
      : 0;
    if (charCount >= 2 && (!ctx.cameraDirection || ctx.cameraDirection === "static")) return 90;
    if (charCount >= 2) return 50;
    return 10;
  },
  slots: [
    {
      type: "panel_1", label: "PANEL 1（双人全景）",
      getDescription: (ctx) => s(
        ctx.startFrameDesc || ctx.shotPrompt,
        ctx.scene?.description ? `场景：${ctx.scene.description}` : null,
        `双人全景，展示角色相对位置和空间关系`,
        ctx.scene?.lighting ? `光照：${ctx.scene.lighting}` : null,
      ),
    },
    {
      type: "panel_2", label: "PANEL 2（过肩镜头）",
      getDescription: (ctx) => s(
        ctx.shotPrompt,
        `过肩拍摄，聚焦正在说话的角色`,
        ctx.compositionGuide || null,
      ),
    },
    {
      type: "panel_3", label: "PANEL 3（反应特写）",
      getDescription: (ctx) => s(
        ctx.videoScript || ctx.shotPrompt,
        `特写另一位角色的反应表情`,
        `景深：shallow，背景虚化`,
        ctx.focalPoint && ctx.focalPoint !== "wide" ? `焦点角色：${ctx.focalPoint}` : null,
      ),
    },
    {
      type: "panel_4", label: "PANEL 4（双人中景）",
      getDescription: (ctx) => s(
        ctx.endFrameDesc || ctx.videoScript || ctx.shotPrompt,
        `双人中景，包含两位角色，对话收束`,
        ctx.scene?.colorPalette ? `色调：${ctx.scene.colorPalette}` : null,
      ),
    },
  ],
};

// ── Template: Action Sequence ──
const action: PanelLayoutTemplate = {
  id: "action",
  name: "动作场面",
  match: (ctx) => {
    const actionKeywords = ["冲", "跑", "跳", "打", "追", "炸", "撞", "飞", "attack", "fight", "chase", "explode", "run", "jump"];
    const text = [ctx.motionScript, ctx.shotPrompt, ctx.videoScript].filter(Boolean).join(" ");
    const hits = actionKeywords.filter((k) => text.includes(k)).length;
    if (hits >= 2) return 100;
    if (hits === 1) return 70;
    if (ctx.cameraDirection === "track" || ctx.cameraDirection === "dutch") return 80;
    return 0;
  },
  slots: [
    {
      type: "panel_1", label: "PANEL 1（动作全景）",
      getDescription: (ctx) => s(
        ctx.startFrameDesc || ctx.shotPrompt,
        `动态广角镜头，捕捉动作全景`,
        ctx.motionScript ? `动作：${ctx.motionScript}` : null,
        ctx.cameraDirection && ctx.cameraDirection !== "static" ? `镜头运动：${ctx.cameraDirection}` : null,
      ),
    },
    {
      type: "panel_2", label: "PANEL 2（冲击中景）",
      getDescription: (ctx) => s(
        ctx.shotPrompt,
        `中景捕捉动作核心瞬间——碰撞、跳跃或关键动作`,
        `高速快门感，冻结动作`,
      ),
    },
    {
      type: "panel_3", label: "PANEL 3（反应特写）",
      getDescription: (ctx) => s(
        ctx.videoScript || ctx.shotPrompt,
        ctx.focalPoint && ctx.focalPoint !== "wide" ? `角色特写：${ctx.focalPoint}` : "角色面部特写",
        `景深：shallow，强调情绪反应`,
        ctx.scene?.colorPalette ? `色调：${ctx.scene.colorPalette}` : null,
      ),
    },
    {
      type: "panel_4", label: "PANEL 4（结果全景）",
      getDescription: (ctx) => s(
        ctx.endFrameDesc || ctx.videoScript || ctx.shotPrompt,
        `动作结束后的场面，静态全景展示结果`,
        ctx.scene?.description ? `场景：${ctx.scene.description}` : null,
        ctx.scene?.lighting ? `光照变化：${ctx.scene.lighting}` : null,
      ),
    },
  ],
};

// ── Template: Discovery / Reveal ──
const discovery: PanelLayoutTemplate = {
  id: "discovery",
  name: "发现/揭示",
  match: (ctx) => {
    const keywords = ["发现", "reveal", "看到", "find", "look", "看见", "显现", "hidden"];
    const text = [ctx.shotPrompt, ctx.videoScript, ctx.motionScript].filter(Boolean).join(" ");
    const hits = keywords.filter((k) => text.toLowerCase().includes(k.toLowerCase())).length;
    return hits >= 1 ? 85 : 0;
  },
  slots: [
    {
      type: "panel_1", label: "PANEL 1（主观视角/发现物）",
      getDescription: (ctx) => s(
        ctx.startFrameDesc || ctx.shotPrompt,
        `第一视角或物体特写——被揭示的对象占据画面主体`,
        ctx.compositionGuide || null,
      ),
    },
    {
      type: "panel_2", label: "PANEL 2（角色反应）",
      getDescription: (ctx) => s(
        ctx.shotPrompt,
        `角色看到/发现物体后的即时反应镜头`,
        ctx.focalPoint && ctx.focalPoint !== "wide" ? `焦点角色：${ctx.focalPoint}` : null,
      ),
    },
    {
      type: "panel_3", label: "PANEL 3（细节特写）",
      getDescription: (ctx) => s(
        ctx.videoScript || ctx.shotPrompt,
        `关键细节的特写镜头——发现物的局部放大`,
        `景深：shallow，引导注意力到关键细节`,
        ctx.scene?.colorPalette ? `色调：${ctx.scene.colorPalette}` : null,
      ),
    },
    {
      type: "panel_4", label: "PANEL 4（全貌揭示）",
      getDescription: (ctx) => s(
        ctx.endFrameDesc || ctx.videoScript || ctx.shotPrompt,
        `全景揭示——角色与发现物共处一框，确立空间关系`,
        ctx.scene?.description ? `场景：${ctx.scene.description}` : null,
        ctx.scene?.lighting ? `揭示光照：${ctx.scene.lighting}` : null,
      ),
    },
  ],
};

// ── Template: Atmospheric / Landscape ──
const atmosphere: PanelLayoutTemplate = {
  id: "atmosphere",
  name: "氛围/风景",
  match: (ctx) => {
    const hasLighting = ctx.scene?.lighting && ctx.scene.lighting.trim().length > 0;
    const aerial = ctx.cameraDirection === "aerial";
    const atmosKeywords = ["氛围", "atmosphere", "景色", "landscape", "广阔", "vast", "环境", "ambient"];
    const text = [ctx.shotPrompt, ctx.scene?.description].filter(Boolean).join(" ");
    const hits = atmosKeywords.filter((k) => text.toLowerCase().includes(k.toLowerCase())).length;
    if (aerial) return 95;
    if (hasLighting && hits >= 1) return 80;
    if (hasLighting) return 50;
    return 0;
  },
  slots: [
    {
      type: "panel_1", label: "PANEL 1（壮阔全景）",
      getDescription: (ctx) => s(
        ctx.startFrameDesc || ctx.shotPrompt,
        ctx.scene?.description ? `场景：${ctx.scene.description}` : null,
        `广阔全景镜头，确立环境氛围`,
        ctx.scene?.lighting ? `环境光照：${ctx.scene.lighting}` : null,
        ctx.scene?.colorPalette ? `色调：${ctx.scene.colorPalette}` : null,
      ),
    },
    {
      type: "panel_2", label: "PANEL 2（环境细节）",
      getDescription: (ctx) => s(
        ctx.shotPrompt,
        `环境中的细节镜头——光线穿过树叶、水面的倒影、风吹草动`,
        ctx.scene?.lighting ? `光影：${ctx.scene.lighting}` : null,
      ),
    },
    {
      type: "panel_3", label: "PANEL 3（角色入镜）",
      getDescription: (ctx) => s(
        ctx.videoScript || ctx.shotPrompt,
        `角色在广阔环境中的中景——人景对比凸显氛围`,
        ctx.compositionGuide || null,
        `景深：deep，保持环境清晰`,
      ),
    },
    {
      type: "panel_4", label: "PANEL 4（终极全景）",
      getDescription: (ctx) => s(
        ctx.endFrameDesc || ctx.videoScript || ctx.shotPrompt,
        ctx.scene?.description ? `最终场景：${ctx.scene.description}` : null,
        `最大景深的终极全景——角色融入环境，叙事落幅`,
        ctx.scene?.lighting ? `终场光照：${ctx.scene.lighting}` : null,
      ),
    },
  ],
};

// ── Template: Static Close-up / Monologue ──
const closeUp: PanelLayoutTemplate = {
  id: "close_up",
  name: "特写/独白",
  match: (ctx) => {
    const charCount = ctx.characterDescriptions
      ? ctx.characterDescriptions.split(/[，,]/).length
      : 0;
    if (charCount <= 1 && ctx.depthOfField === "shallow") return 80;
    if (charCount <= 1 && ctx.focalPoint && ctx.focalPoint !== "wide") return 70;
    return 5;
  },
  slots: [
    {
      type: "panel_1", label: "PANEL 1（近景引入）",
      getDescription: (ctx) => s(
        ctx.startFrameDesc || ctx.shotPrompt,
        `近景镜头引入角色/主体`,
        ctx.scene?.lighting ? `光照：${ctx.scene.lighting}` : null,
      ),
    },
    {
      type: "panel_2", label: "PANEL 2（特写情绪）",
      getDescription: (ctx) => s(
        ctx.shotPrompt,
        `面部特写——捕捉细微表情和情绪变化`,
        `景深：shallow，背景完全虚化`,
      ),
    },
    {
      type: "panel_3", label: "PANEL 3（局部细节）",
      getDescription: (ctx) => s(
        ctx.videoScript || ctx.shotPrompt,
        ctx.focalPoint ? `局部特写：${ctx.focalPoint}` : "手部/眼神/道具细节",
        ctx.compositionGuide || null,
      ),
    },
    {
      type: "panel_4", label: "PANEL 4（回到近景）",
      getDescription: (ctx) => s(
        ctx.endFrameDesc || ctx.videoScript || ctx.shotPrompt,
        `回到近景，展现情绪变化后的状态`,
        ctx.scene?.colorPalette ? `色调统一：${ctx.scene.colorPalette}` : null,
      ),
    },
  ],
};

// ── Template Registry ──

export interface PanelLayoutTemplate {
  id: string;
  name: string;
  match: (ctx: PanelContext) => number;
  slots: PanelSlot[];
}

const TEMPLATES: PanelLayoutTemplate[] = [
  dialogue,
  action,
  discovery,
  atmosphere,
  closeUp,
  storyStandard,
];

export function selectTemplate(ctx: PanelContext): PanelLayoutTemplate {
  let best = storyStandard;
  let bestScore = 0;
  for (const t of TEMPLATES) {
    const score = t.match(ctx);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

export function buildPanelInputs(shot: {
  prompt: string | null;
  videoScript: string | null;
  motionScript: string | null;
  cameraDirection: string | null;
  compositionGuide: string | null;
  focalPoint: string | null;
  depthOfField: string | null;
  costumeOverrides: string | null;
}, shotLegacy: {
  startFrameDesc: string | null;
  endFrameDesc: string | null;
} | null, matchingScene: typeof scenes.$inferSelect | null, characterDescriptions: string): Array<{ type: PanelType; label: string; description: string }> {
  const ctx: PanelContext = {
    shotPrompt: shot.prompt || "",
    startFrameDesc: shotLegacy?.startFrameDesc ?? null,
    endFrameDesc: shotLegacy?.endFrameDesc ?? null,
    videoScript: shot.videoScript || null,
    motionScript: shot.motionScript || null,
    cameraDirection: shot.cameraDirection || null,
    compositionGuide: shot.compositionGuide || null,
    focalPoint: shot.focalPoint || null,
    depthOfField: shot.depthOfField || null,
    scene: matchingScene ? {
      title: matchingScene.title || "",
      description: matchingScene.description || "",
      lighting: matchingScene.lighting || "",
      colorPalette: matchingScene.colorPalette || "",
    } : null,
    characterDescriptions,
    costumeOverrides: shot.costumeOverrides || null,
  };

  const template = selectTemplate(ctx);

  return template.slots.map((slot) => ({
    type: slot.type,
    label: slot.label,
    description: slot.getDescription(ctx),
  }));
}
