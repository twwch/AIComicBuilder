import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const CACHE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const filePath = path.join(uploadDir, ...segments);

  // Prevent directory traversal
  const resolved = path.resolve(filePath);
  const resolvedUploadDir = path.resolve(uploadDir);
  if (!resolved.startsWith(resolvedUploadDir)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const stat = fs.statSync(resolved);

  // ETag based on mtime + size
  const etag = `W/"${createHash("md5")
    .update(`${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}`)
    .digest("hex")}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  const stream = fs.createReadStream(resolved);
  const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Cache-Control": `public, max-age=${CACHE_MAX_AGE}, immutable`,
      ETag: etag,
    },
  });
}
