import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characters } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { extractCharacterReferencePortrait } from "@/lib/character-ref-utils";
import type { CharacterReferenceLayout } from "@/lib/ai/prompts/registry-character";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  const { id: projectId, characterId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.projectId, projectId)));
  if (!character) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() || "png";
  const filename = `${genId()}.${ext}`;
  const dir = path.join(uploadDir, "characters");
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, buffer);

  // Append to history
  let history: string[] = [];
  try {
    history = JSON.parse(character.referenceImageHistory || "[]");
  } catch {}
  if (character.referenceImage && !history.includes(character.referenceImage)) {
    history.push(character.referenceImage);
  }
  if (!history.includes(filepath)) {
    history.push(filepath);
  }

  // Auto-crop a single-portrait ref so downstream keyframe generation can
  // skip the multi-view sheet (which confuses the image model into
  // reproducing the contact-sheet layout). Mirrors what the AI generation
  // handler does. On crop failure (e.g. all-white image), keep the
  // existing single portrait.
  let singlePortraitPath: string | null = null;
  const layout = (character.referenceLayout ?? "four-view") as CharacterReferenceLayout;
  if (layout !== "single") {
    try {
      singlePortraitPath = await extractCharacterReferencePortrait(filepath, layout);
    } catch (cropErr) {
      console.warn(
        `[CharacterUpload] auto-crop failed for ${character.name}:`,
        cropErr instanceof Error ? cropErr.message : cropErr,
      );
    }
  }

  const [updated] = await db
    .update(characters)
    .set({
      referenceImage: filepath,
      referenceImageHistory: JSON.stringify(history),
      referenceImageSingle: singlePortraitPath ?? character.referenceImageSingle,
    })
    .where(eq(characters.id, characterId))
    .returning();

  return NextResponse.json(updated);
}
