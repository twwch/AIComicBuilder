import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { id as genId } from "@/lib/id";
import { assertProjectOwnership } from "@/lib/assert-project-ownership";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const uploadRoot = path.join(process.cwd(), "public", "generated", "import-assets");

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
  const kind = String(formData.get("kind") || "").toLowerCase();
  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File is too large" }, { status: 400 });
  }

  const isAudio = kind === "audio" || file.type.startsWith("audio/");
  const isImage = kind === "image" || file.type.startsWith("image/");
  if (!isAudio && !isImage) {
    return NextResponse.json({ error: "Only image or audio files are supported" }, { status: 400 });
  }

  const subdir = isAudio ? "voices" : "images";
  const ext = extensionFor(file, isAudio ? "audio" : "image");
  const filename = `${Date.now()}_${genId()}${ext}`;
  const uploadDir = path.join(uploadRoot, subdir);
  await fs.mkdir(uploadDir, { recursive: true });
  const outputPath = path.join(uploadDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(outputPath, buffer);

  const publicUrl = `/generated/import-assets/${subdir}/${filename}`;
  return NextResponse.json({
    provider: "manual-upload",
    status: "succeeded",
    imageUrl: isImage ? publicUrl : "",
    audioUrl: isAudio ? publicUrl : "",
    savedPath: outputPath,
  });
}

function extensionFor(file: File, kind: "image" | "audio") {
  const fromName = path.extname(file.name || "").toLowerCase();
  if (kind === "image") {
    if (/^\.(png|jpe?g|webp|gif|bmp)$/.test(fromName)) return fromName;
    if (file.type === "image/jpeg") return ".jpg";
    if (file.type === "image/webp") return ".webp";
    if (file.type === "image/gif") return ".gif";
    if (file.type === "image/bmp") return ".bmp";
    return ".png";
  }
  if (/^\.(mp3|wav|m4a|aac|ogg|webm|flac)$/.test(fromName)) return fromName;
  if (file.type === "audio/wav") return ".wav";
  if (file.type === "audio/aac") return ".aac";
  if (file.type === "audio/ogg") return ".ogg";
  if (file.type === "audio/webm") return ".webm";
  if (file.type === "audio/flac") return ".flac";
  if (file.type === "audio/mp4" || file.type === "audio/x-m4a") return ".m4a";
  return ".mp3";
}
