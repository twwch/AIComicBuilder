import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";
import { insertAssetVersion, type ShotAssetType } from "@/lib/shot-asset-utils";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

const FIELD_MAP: Record<string, { type: ShotAssetType; sequenceInType: number }> = {
  firstFrame: { type: "first_frame", sequenceInType: 0 },
  lastFrame: { type: "last_frame", sequenceInType: 0 },
  sceneRefFrame: { type: "reference", sequenceInType: 0 },
  panel1: { type: "panel_1", sequenceInType: 0 },
  panel2: { type: "panel_2", sequenceInType: 0 },
  panel3: { type: "panel_3", sequenceInType: 0 },
  panel4: { type: "panel_4", sequenceInType: 0 },
};

const ALLOWED_FIELDS = Object.keys(FIELD_MAP);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> }
) {
  const { id: projectId, shotId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [shotRow] = await db
    .select({ id: shots.id })
    .from(shots)
    .where(and(eq(shots.id, shotId), eq(shots.projectId, projectId)));
  if (!shotRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const field = formData.get("field") as string | null;

  if (!file || !field) {
    return NextResponse.json({ error: "Missing file or field" }, { status: 400 });
  }
  if (!ALLOWED_FIELDS.includes(field)) {
    return NextResponse.json({ error: "Invalid field" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() || "png";
  const filename = `${genId()}.${ext}`;
  const dir = path.join(uploadDir, "frames");
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, buffer);

  const mapping = FIELD_MAP[field];
  const asset = await insertAssetVersion({
    shotId,
    type: mapping.type,
    sequenceInType: mapping.sequenceInType,
    fileUrl: filepath,
    prompt: "",
    status: "completed",
  });

  return NextResponse.json({ ...shotRow, assets: [asset] });
}
