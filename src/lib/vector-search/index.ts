import { db } from "@/lib/db";
import { embeddings } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { id as genId } from "@/lib/id";
import { embedTextSafe } from "@/lib/embedding";

export interface StoredEmbedding {
  id: string;
  contentType: string;
  contentId: string;
  model: string;
  vector: number[];
  text: string;
}

export interface SearchResult {
  contentId: string;
  contentType: string;
  score: number;
  text: string;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function charNGramSimilarity(a: string, b: string): number {
  const aNGrams = new Set<string>();
  const bNGrams = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) aNGrams.add(a.substring(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bNGrams.add(b.substring(i, i + 2));
  if (aNGrams.size === 0 && bNGrams.size === 0) return a === b ? 1 : 0;
  let intersect = 0;
  for (const n of aNGrams) if (bNGrams.has(n)) intersect++;
  return (2 * intersect) / (aNGrams.size + bNGrams.size);
}

export async function findCharacterBySemanticMatch(
  shotText: string,
  projectId: string,
): Promise<SearchResult | null> {
  const allRows = await db
    .select()
    .from(embeddings)
    .where(eq(embeddings.contentType, "character"));

  if (allRows.length === 0) return null;

  const queryVec = await embedTextSafe(shotText);
  if (!queryVec) return null;

  let best: { contentId: string; score: number; text: string } | null = null;

  for (const row of allRows) {
    const vec: number[] = JSON.parse(row.vector);
    const score = cosineSimilarity(queryVec, vec);
    if (!best || score > best.score) {
      best = { contentId: row.contentId, score, text: row.text };
    }
  }

  return best && best.score > 0.5
    ? { contentId: best.contentId, contentType: "character", score: best.score, text: best.text }
    : null;
}

export function findCharacterByNameFuzzy(
  shotCharNames: string[],
  projectCharacters: ReadonlyArray<{ id: string; name: string }>,
): { id: string; name: string } | null {
  if (shotCharNames.length === 0 || projectCharacters.length === 0) return null;

  let best: { id: string; name: string; score: number } | null = null;

  for (const shotName of shotCharNames) {
    for (const pc of projectCharacters) {
      const score = charNGramSimilarity(shotName, pc.name);
      if (score > 0.5 && (!best || score > best.score)) {
        best = { id: pc.id, name: pc.name, score };
      }
    }
  }

  return best ? { id: best.id, name: best.name } : null;
}

export interface CharacterProfile {
  id: string;
  name: string;
  description?: string | null;
  visualHint?: string | null;
}

export function findCharacterByDescriptionMatch(
  shotPrompt: string,
  characters: ReadonlyArray<CharacterProfile>,
): { id: string; name: string; score: number } | null {
  if (!shotPrompt || characters.length === 0) return null;

  let best: { id: string; name: string; score: number } | null = null;

  for (const ch of characters) {
    const profileText = [ch.name, ch.description, ch.visualHint].filter(Boolean).join(" ");
    if (!profileText.trim()) continue;
    const score = charNGramSimilarity(shotPrompt, profileText);
    if (score > 0.3 && (!best || score > best.score)) {
      best = { id: ch.id, name: ch.name, score };
    }
  }

  return best;
}

export async function storeEmbedding(
  contentType: "character" | "shot" | "scene" | "episode",
  contentId: string,
  vector: number[],
  text: string,
  model: string,
): Promise<void> {
  await db.insert(embeddings).values({
    id: genId(),
    contentType,
    contentId,
    model,
    vector: JSON.stringify(vector),
    text,
  });
}

export async function getEmbedding(
  contentType: string,
  contentId: string,
): Promise<StoredEmbedding | null> {
  const rows = await db
    .select()
    .from(embeddings)
    .where(and(eq(embeddings.contentType, contentType as any), eq(embeddings.contentId, contentId)))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  return { ...row, vector: JSON.parse(row.vector) };
}

export async function hasEmbedding(contentType: string, contentId: string): Promise<boolean> {
  const rows = await db
    .select({ id: embeddings.id })
    .from(embeddings)
    .where(and(eq(embeddings.contentType, contentType as any), eq(embeddings.contentId, contentId)))
    .limit(1);
  return rows.length > 0;
}
