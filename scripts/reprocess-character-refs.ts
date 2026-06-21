import { extractCharacterReferencePortrait } from "../src/lib/character-ref-utils";
import { db } from "../src/lib/db";
import { characters } from "../src/lib/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";

const PROJECT_ID = "SKB6CNwqAn5H";

interface ResultRow {
  id: string;
  name: string;
  referenceImage: string | null;
  referenceImageSingle: string | null;
  referenceLayout: string | null;
  newSingle: string | null;
  error: string | null;
}

async function main() {
  const rows = await db
    .select({
      id: characters.id,
      name: characters.name,
      referenceImage: characters.referenceImage,
      referenceImageSingle: characters.referenceImageSingle,
      referenceLayout: characters.referenceLayout,
    })
    .from(characters)
    .where(
      and(
        eq(characters.projectId, PROJECT_ID),
        isNotNull(characters.referenceImage),
      ),
    );

  console.log(`Found ${rows.length} characters with reference_image`);

  const results: ResultRow[] = [];
  for (const row of rows) {
    const layout = (row.referenceLayout ?? "four-view") as
      | "single"
      | "three-view"
      | "four-view";
    if (!row.referenceImage) {
      results.push({ ...row, newSingle: null, error: "no reference_image" });
      continue;
    }
    if (layout === "single") {
      results.push({ ...row, newSingle: null, error: "layout is single" });
      continue;
    }
    try {
      const newRel = await extractCharacterReferencePortrait(
        row.referenceImage,
        layout,
      );
      if (!newRel) {
        results.push({ ...row, newSingle: null, error: "no content found" });
        continue;
      }
      const normalized = newRel.replace(/\\/g, "/");
      await db
        .update(characters)
        .set({
          referenceImageSingle: normalized,
          referenceLayout: layout,
        })
        .where(eq(characters.id, row.id));
      results.push({ ...row, newSingle: normalized, error: null });
      console.log(`  [OK] ${row.name}: ${normalized}`);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      results.push({ ...row, newSingle: null, error: err });
      console.log(`  [ERR] ${row.name}: ${err}`);
    }
  }

  console.log("\n--- Summary ---");
  const ok = results.filter((r) => r.newSingle);
  const noContent = results.filter((r) => r.error === "no content found");
  const other = results.filter((r) => r.error && r.error !== "no content found");
  console.log(`OK: ${ok.length}`);
  console.log(`No content: ${noContent.length} -> ${noContent.map((r) => r.name).join(", ")}`);
  console.log(`Other errors: ${other.length} -> ${other.map((r) => `${r.name}: ${r.error}`).join("; ")}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
