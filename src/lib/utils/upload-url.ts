import { normalizeUploadPath } from "./upload-path";

/**
 * Convert a local file path (e.g., "./uploads/frames/abc.png") to an API URL
 * for serving via /api/uploads/[...path].
 */
export function uploadUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");

  // Already an API URL — return as-is
  if (normalized.startsWith("/api/uploads/")) return normalized;

  const uploadPath = normalizeUploadPath(normalized);
  return uploadPath.startsWith("uploads/")
    ? `/api/uploads/${uploadPath.slice("uploads/".length)}`
    : `/api/uploads/${uploadPath}`;
}
