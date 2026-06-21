import { extractVisualStyleReference, extractVisualStyleValue } from "@/lib/style-presets";

export function extractStyleField(text: string | null | undefined, label: string): string {
  if (!text) return "";
  const re = new RegExp(`${label}[：:]\\s*(.+?)(?:\\n|$)`);
  const m = text.match(re);
  return m?.[1]?.trim() || "";
}

export function extractPrimaryVisualStyleReference(script?: string | null, idea?: string | null): string {
  return extractVisualStyleReference(script) || extractVisualStyleReference(idea) || extractVisualStyleValue(script);
}

export function buildVisualStyleContext(script?: string | null, idea?: string | null): string {
  const parts = [
    extractPrimaryVisualStyleReference(script, idea),
    extractStyleField(script, "视觉风格") || extractStyleField(script, "Visual Style"),
    extractStyleField(script, "色彩基调") && `色彩基调：${extractStyleField(script, "色彩基调")}`,
    extractStyleField(script, "时代美学") && `时代美学：${extractStyleField(script, "时代美学")}`,
    extractStyleField(script, "氛围情绪") && `氛围情绪：${extractStyleField(script, "氛围情绪")}`,
    extractStyleField(script, "画幅比例") && `画幅比例：${extractStyleField(script, "画幅比例")}`,
  ].filter(Boolean);

  return [...new Set(parts)].join("；");
}

export function buildVisualStylePromptLead(script?: string | null, idea?: string | null): string {
  const visualStyle = buildVisualStyleContext(script, idea);
  if (!visualStyle) return "";
  return `视觉风格参考：${visualStyle}\n\n此风格为明确用户意图。请在后续输出中主动保持一致，不要弱化、忽略或替换。`;
}
