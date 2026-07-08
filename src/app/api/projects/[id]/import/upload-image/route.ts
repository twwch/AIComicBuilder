import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { id as genId } from "@/lib/id";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const uploadDir = path.join(process.cwd(), "public", "generated", "import-assets");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  if (!(await assertProjectOwnership(request, projectId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are supported" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return NextResponse.json({ error: "Image is too large" }, { status: 400 });
  }

  const ext = extensionFor(file);
  const filename = `${Date.now()}_${genId()}${ext}`;
  await fs.mkdir(uploadDir, { recursive: true });
  const outputPath = path.join(uploadDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(outputPath, buffer);

  return NextResponse.json({
    provider: "manual-upload",
    status: "succeeded",
    imageUrl: `/generated/import-assets/${filename}`,
    savedPath: outputPath,
  });
}

function extensionFor(file: File) {
  const fromName = path.extname(file.name || "").toLowerCase();
  if (/^\.(png|jpe?g|webp|gif|bmp)$/.test(fromName)) return fromName;
  if (file.type === "image/jpeg") return ".jpg";
  if (file.type === "image/webp") return ".webp";
  if (file.type === "image/gif") return ".gif";
  if (file.type === "image/bmp") return ".bmp";
  return ".png";
}
