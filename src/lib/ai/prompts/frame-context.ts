interface CharacterLike {
  name: string;
  description: string | null;
  referenceImage?: string | null;
}

export function stripInlineReferenceTags(text: string): string {
  return text.replace(/\s*\[ref:\s*[^\]]+]/gi, "");
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function sanitizeImagePromptText(text: string): string {
  return stripInlineReferenceTags(text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildFrameCharacterDescriptions(
  characters: CharacterLike[],
  maxLength = 260
): string {
  return characters
    .map((character) => {
      const raw = `${character.description || character.name}`;
      const cleaned = compactWhitespace(stripInlineReferenceTags(raw));
      const shortened =
        cleaned.length > maxLength
          ? `${cleaned.slice(0, maxLength).trim()}...`
          : cleaned;
      return `${character.name}: ${shortened}`;
    })
    .join("\n");
}
