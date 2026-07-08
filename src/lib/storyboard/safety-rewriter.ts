import { compactText } from "./prompt-sanitizer";

export const EXPLICIT_GORE_PATTERNS = [
  /鲜血|血肉|断肢|内脏|骨折外露|血泊|满身是血|血流|血红/,
  /\b(blood|bloody|gore|graphic injury|mutilation|severed limb|open wound|viscera)\b/i,
];

const IMPACT_PATTERNS = [
  /撞向|撞飞|碾过|砍中|刺中|枪击|爆头|击穿|砸死|压过/,
  /\b(hit by|crash into|run over|stabbed|shot|beheaded|impact moment)\b/i,
];

const DEATH_PATTERNS = [
  /死亡|死去|尸体|断气|彻底垂下|失去生命|彻底不动/,
  /\b(death|dead body|corpse|dies?|lifeless)\b/i,
];

const BODY_INJURY_PATTERNS = [
  /伤口|创口|肢体|身体撕裂|断裂|骨头|内伤/,
  /\b(wound|injury|broken bone|torn flesh|limb injury)\b/i,
];

export function hasHighRiskViolence(text: string) {
  return [...EXPLICIT_GORE_PATTERNS, ...IMPACT_PATTERNS, ...DEATH_PATTERNS, ...BODY_INJURY_PATTERNS]
    .some((pattern) => pattern.test(text));
}

export function rewriteUnsafeVisuals(text: string) {
  const original = compactText(text, 360);
  let rewritten = original;
  const rewrites: string[] = [];

  if (hasImpactRisk(rewritten) && !isHarmlessSurfaceVehicleMotion(rewritten)) {
    rewritten = rewriteImpactMoment(rewritten);
    rewrites.push("impact process converted to a non-graphic static key moment");
  }

  if (hasExplicitGore(rewritten)) {
    rewritten = rewriteGoreDetail(rewritten);
    rewrites.push("explicit gore converted to restrained atmosphere");
  }

  if (hasDeathRisk(rewritten)) {
    rewritten = rewriteDeathMoment(rewritten);
    rewrites.push("death process converted to restrained visual implication");
  }

  if (hasBodyInjuryRisk(rewritten)) {
    rewritten = rewriteBodyInjuryDetail(rewritten);
    rewrites.push("graphic injury detail reduced to non-graphic distress");
  }

  if (rewrites.length > 0 && !/无明显血腥|non-graphic|no visible gore/i.test(rewritten)) {
    rewritten = `${rewritten}，无明显血腥，克制的短剧视觉表达`;
  }

  return {
    text: compactText(rewritten, 340),
    rewrites,
  };
}

function hasImpactRisk(text: string) {
  return IMPACT_PATTERNS.some((pattern) => pattern.test(text));
}

function hasExplicitGore(text: string) {
  return EXPLICIT_GORE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasDeathRisk(text: string) {
  return DEATH_PATTERNS.some((pattern) => pattern.test(text));
}

function hasBodyInjuryRisk(text: string) {
  return BODY_INJURY_PATTERNS.some((pattern) => pattern.test(text));
}

function isHarmlessSurfaceVehicleMotion(text: string) {
  return /碾过|压过|rolls? through|run over/i.test(text) &&
    /水坑|泥水|积水|puddle|water|rain/i.test(text) &&
    !/人物|男人|女人|孩子|老人|他|她|身体|鲜血|伤|person|man|woman|child|body|blood|injury/i.test(text);
}

function rewriteImpactMoment(text: string) {
  if (/撞向|冲向|逼近|crash into|hit by/i.test(text)) {
    return compactText(
      text
        .replace(/([^\s，。；;,.]{1,40})(撞向|冲向)([^\s，。；;,.]{1,40})/g, "$1逼近$3，画面定格在碰撞前一瞬")
        .replace(/\b(crash(?:es)? into|hit(?:s)? by)\b/gi, "approaches, frozen just before impact"),
      320,
    );
  }

  if (/撞飞|摔|倒地|跌倒|collapse|fall/i.test(text)) {
    return compactText(
      text
        .replace(/被?撞飞|重重摔在|摔在|倒地|跌倒/g, "倒在地面边缘")
        .replace(/\b(collapse|fall(?:en)?|thrown by impact)\b/gi, "lying at the edge of the ground after the incident"),
      320,
    );
  }

  if (/碾过|run over/i.test(text) && /水坑|泥水|puddle|water/i.test(text)) {
    return compactText(
      text
        .replace(/碾过/g, "压过")
        .replace(/\brun over\b/gi, "rolls through"),
      320,
    );
  }

  return compactText(`${text}，画面避开直接伤害瞬间，保留紧张的静态构图`, 320);
}

function rewriteGoreDetail(text: string) {
  const rainOrWater = /雨|水|泥|puddle|rain|water/i.test(text);
  const atmosphere = rainOrWater
    ? "雨水模糊视线，暗红色压迫氛围，无明显血腥"
    : "阴影和低饱和暗红色氛围，无明显血腥";
  return compactText(
    text
      .replace(/鲜血混着雨水流进眼睛|鲜血|血肉|断肢|内脏|骨折外露|血泊|满身是血|血流|血红/g, atmosphere)
      .replace(/\b(blood|bloody|gore|graphic injury|mutilation|severed limb|open wound|viscera)\b/gi, "non-graphic dark visual tension"),
    320,
  ).replace(/(雨水模糊视线，暗红色压迫氛围，无明显血腥)(，视线一片)?\1/g, "$1");
}

function rewriteDeathMoment(text: string) {
  if (/手指|手部|手掌|hand|finger/i.test(text)) {
    return compactText(
      text
        .replace(/彻底垂下|彻底不动|断气|死亡|死去|失去生命/g, "无力垂落，画面渐暗")
        .replace(/\b(death|dies?|lifeless)\b/gi, "limp and fading into shadow"),
      320,
    );
  }
  return compactText(
    text
      .replace(/死亡|死去|尸体|断气|失去生命|彻底不动/g, "失去意识的克制视觉暗示，画面渐暗")
      .replace(/\b(death|dead body|corpse|dies?|lifeless)\b/gi, "restrained loss-of-consciousness visual implication"),
    320,
  );
}

function rewriteBodyInjuryDetail(text: string) {
  return compactText(
    text
      .replace(/伤口|创口|肢体|断裂|撕裂|骨头|内伤/g, "非血腥受伤暗示")
      .replace(/\b(wound|injury|broken bone|torn flesh|limb injury)\b/gi, "non-graphic injury implication"),
    320,
  );
}
