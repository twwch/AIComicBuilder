import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { embedBatchSafe, getEmbeddingModel } from "@/lib/embedding";
import { hasEmbedding, storeEmbedding } from "@/lib/vector-search";

async function main() {
  const all = await db.select().from(characters);
  if (all.length === 0) {
    console.log("No characters found.");
    return;
  }

  const model = getEmbeddingModel();
  const toIndex: Array<{ c: typeof all[number]; text: string }> = [];

  for (const c of all) {
    const already = await hasEmbedding("character", c.id);
    if (already) {
      console.log(`[SKIP] ${c.name} already indexed`);
      continue;
    }
    const text = [c.name, c.description, c.visualHint].filter(Boolean).join(" - ");
    if (!text.trim()) {
      console.log(`[SKIP] ${c.name} has no text to index`);
      continue;
    }
    toIndex.push({ c, text });
  }

  if (toIndex.length === 0) {
    console.log("All characters already indexed.");
    return;
  }

  console.log(`Indexing ${toIndex.length} characters with ${model}...`);
  const texts = toIndex.map((t) => t.text);
  const vectors = await embedBatchSafe(texts);

  let okCount = 0;
  for (let i = 0; i < toIndex.length; i++) {
    const { c, text } = toIndex[i];
    const vec = vectors[i];
    if (!vec) {
      console.error(`[FAIL] ${c.name} embedding failed, skipping`);
      continue;
    }
    await storeEmbedding("character", c.id, vec, text, model);
    console.log(`[OK] ${c.name} (${c.id})`);
    okCount++;
  }

  console.log(`Done: ${okCount}/${toIndex.length} characters indexed.`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
