export function buildCharacterTurnaroundPrompt(description: string, characterName?: string): string {
  return `Character four-view reference sheet — professional character design document.

=== CRITICAL: ART STYLE FIDELITY ===
The CHARACTER DESCRIPTION below is authoritative. It may specify an art style explicitly, implicitly, or through a combination of modifiers (e.g. "3D 国漫 CG 渲染", "水墨写意", "赛博朋克像素画", "cel-shaded anime", "oil painting portrait", "PBR realtime render").

Rules for interpreting style:
1. Treat the FULL style phrase as one atomic instruction. Do NOT cherry-pick individual words and map them to a default bucket. "3D 写实国漫渲染" is NOT the same as "photorealistic" — it is a stylized 3D CG render in the Chinese animation idiom.
2. Style modifiers like "写实 / realistic / 高清 / 精致" describe RENDERING FIDELITY, not medium. They raise detail level within the chosen medium; they never convert the medium to live-action photography.
3. The medium (2D illustration / 3D CG / photograph / painting / pixel / etc.) is determined ONLY by explicit medium words such as "照片 / photograph / live-action / 真人实拍 / 摄影". In the ABSENCE of such explicit photographic words, DO NOT output a photograph or live-action render, even if "写实" or "realistic" appears.
4. When multiple style words are present, the most specific / most restrictive one wins. "国漫" + "3D" + "写实" → stylized 3D CG in Chinese animation style with high rendering fidelity.
5. Color palette, lighting mood, and era references in the description (e.g. "低饱和度暗沉色调", "电影级历史正剧质感") are MANDATORY and must be honored exactly — they are not decorative.
6. If no style is mentioned at all, infer the most appropriate stylized illustration from the character's setting and genre. Default to stylized illustration, NOT photography.

=== CHARACTER DESCRIPTION (authoritative) ===
${characterName ? `Name: ${characterName}\n` : ''}${description}

=== FACE — HIGH DETAIL ===
Render the face with precision appropriate to the chosen medium and style:
- Consistent facial bone structure, eye shape, nose, mouth — matching the description exactly
- Eyes expressive and detailed, rendered in the chosen medium's idiom
- Hair with defined volume, color and flow, rendered in the chosen medium's idiom
- Skin and surface shading rendered in the chosen medium's idiom (cel-shading, subsurface, PBR, painterly, etc.)
- The face must be striking, memorable, and instantly recognizable across all four views

=== WEAPONS, COSTUME & EQUIPMENT ===
- All props, armor, clothing and equipment must be rendered in the SAME medium and style as the character
- Material detail must match the style (painterly strokes for paintings, PBR materials for 3D CG, clean flats for anime, etc.)
- Scale and anatomy must be correct relative to the body

=== FOUR-VIEW LAYOUT ===
Four views arranged LEFT to RIGHT on a clean pure white canvas, consistent medium shot (waist to crown) across all four:
1. FRONT — facing viewer directly, showing full outfit and any held items
2. THREE-QUARTER — rotated ~45° right, showing face depth and dimensional form
3. SIDE PROFILE — perfect 90° facing right, clear silhouette
4. BACK — fully facing away, hairstyle and clothing back detail

=== LIGHTING & RENDERING ===
- Clean professional key/fill/rim lighting, consistent direction across all four views
- Pure white background for clean character separation
- Honor any mood/tone/palette constraints from the description (if it says "低饱和度暗沉", the output MUST be low-saturation and muted, NOT bright)
- Highest quality achievable WITHIN the chosen medium and style — never break medium to chase fidelity

=== CONSISTENCY ACROSS ALL FOUR VIEWS ===
- Identical character identity, proportions and colors in every view
- Identical outfit, accessories, weapon placement, hair
- Heads aligned at the same top edge, waist at the same bottom edge
- Consistent expression across all views

=== CHARACTER NAME LABEL ===
${characterName ? `Display the character's name "${characterName}" as a clean typographic label below the four-view layout. Use a modern sans-serif font, dark text on white background, centered alignment.` : 'No character name label required.'}

=== FINAL OUTPUT STANDARD ===
Professional character design reference sheet. This is the single canonical reference — all future generated frames MUST reproduce this exact character in this exact medium and style. Zero medium drift, zero style drift, zero AI artifacts.`;
}

export type ImageModelFamily = "gpt" | "agnes" | "sensenova" | "ideogram4" | "hidream" | "ernie" | "other";

export function detectImageModelFamily(protocol?: string, modelId?: string): ImageModelFamily {
  if (modelId?.includes("gpt-image")) return "gpt";
  if (protocol === "agnes" || modelId?.includes("agnes")) return "agnes";
  if (protocol === "sensenova" || modelId?.includes("sensenova")) return "sensenova";
  if (protocol === "ideogram4" || modelId?.includes("ideogram4") || modelId?.includes("ideogram-4")) return "ideogram4";
  if (modelId?.includes("hidream")) return "hidream";
  if (modelId?.includes("ernie")) return "ernie";
  return "other";
}

export function buildCharacterImagePrompt(
  description: string,
  characterName: string | undefined,
  modelFamily: ImageModelFamily
): string {
  switch (modelFamily) {
    case "agnes":
    case "sensenova":
      return `3D迪士尼动画风格，皮克斯式渲染，角色全身立绘，纯白背景，角色居中站立，不要出现任何文字标签。\n角色名：${characterName || ""}\n角色描述：${description || ""}`;
    default:
      return buildCharacterTurnaroundPrompt(description, characterName);
  }
}
