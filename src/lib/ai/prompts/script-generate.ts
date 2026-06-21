/**
 * User-side prompt builder for script generation.
 * The authoritative SYSTEM prompt lives in the prompt registry under the
 * `script_generate` key (see src/lib/ai/prompts/registry.ts). This file
 * only builds the per-request user message so the two are not duplicated.
 */

function detectLanguage(text: string): string {
  if (/[\u4e00-\u9fff]/.test(text)) return "Chinese (中文)";
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return "Japanese (日本語)";
  if (/[\uac00-\ud7af]/.test(text)) return "Korean (한국어)";
  return "English";
}

function extractVisualStyleReference(idea: string): string {
  const line = idea
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith("视觉风格参考："));
  return line?.split("：").slice(1).join("：").trim() ?? "";
}

export function buildScriptGeneratePrompt(idea: string): string {
  const lang = detectLanguage(idea);
  const visualStyleReference = extractVisualStyleReference(idea);

  return `Write a complete, production-ready screenplay based on this creative concept:

"${idea}"

OUTPUT LANGUAGE: ${lang}. You MUST write EVERY word of your output in ${lang}, including all section headers, character descriptions, stage directions, and dialogue. Do NOT use English if the language is not English.

${visualStyleReference ? `VISUAL STYLE REFERENCE: ${visualStyleReference}. This style reference is explicit user intent and should be written into Section 1 视觉风格 clearly, not ignored or weakened.

` : ""} 

**STRICT FORMAT REMINDER** (details are in the system prompt — do not violate):
- Sections 1 (视觉风格) and 2 (角色描述) are machine-readable key:value blocks with fixed Chinese field labels. No markdown, no bullets, no code fences. One field per line.
- Section 3 (场景) is free-form screenplay prose.
- Field labels stay in Chinese verbatim regardless of the output language of the rest of the screenplay.

Content quality:
- Respect user-specified art style if given; otherwise infer the most fitting style from the concept.
- CHARACTERS section must cover every named character with all 5 required fields — downstream AI image generators rely on these to produce consistent visuals.
- Each scene description must be vivid enough for an AI image generator to produce a frame directly.
- Write RICHLY and in DETAIL — every scene needs specific visual descriptions, character actions, emotional beats, and dialogue. Avoid rushing through the story.`;
}
