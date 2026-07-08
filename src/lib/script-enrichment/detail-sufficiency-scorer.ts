export interface DetailSufficiencyScore {
  score: number;
  status: "needs_enrichment" | "detail_sufficient";
  reasons: string[];
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function scoreDetailSufficiency(text: string): DetailSufficiencyScore {
  const value = String(text || "").trim();
  const reasons: string[] = [];
  let score = 0;

  if (value.length >= 36) {
    score += 1;
    reasons.push("long_enough");
  }
  if (hasAny(value, [/内|外|房|屋|楼|街|车|厂|室|厅|门|窗|床|桥|城|墙|实验室|会议室/])) {
    score += 1;
    reasons.push("location_present");
  }
  if (hasAny(value, [/走|站|坐|冲|跑|拿|放|看|盯|转|伸|抓|推|拉|砸|抱|挥|躲|跪|倒|抬|低头|回头/])) {
    score += 1;
    reasons.push("action_present");
  }
  if (hasAny(value, [/枪|刀|手机|桌|椅|车|门|窗|屏|面板|箱|钥匙|杯|灯|血|雨|火|玻璃|墙/])) {
    score += 1;
    reasons.push("prop_present");
  }
  if (hasAny(value, [/怒|笑|哭|惊|冷|慌|紧张|沉默|疲惫|痛苦|颤抖|冰冷|狞笑|冷笑|眼神|表情/])) {
    score += 1;
    reasons.push("emotion_present");
  }
  if (hasAny(value, [/日|夜|晨|晚|光|灯|暗|阴|雨|雪|雾|阳光|夕阳|黑暗|昏暗|猩红/])) {
    score += 1;
    reasons.push("lighting_present");
  }

  const status = score >= 4 ? "detail_sufficient" : "needs_enrichment";
  return { score, status, reasons };
}
