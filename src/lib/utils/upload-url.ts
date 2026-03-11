/**
 * Convert a local file path (e.g., "./uploads/frames/abc.png") to an API URL
 * for serving via /api/uploads/[...path].
 */
export function uploadUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)uploads\/(.+)$/);
  const relativePath = match
    ? match[1]
    : normalized.replace(/^\.?\//, "").replace(/^\/+/, "");

  return `/api/uploads/${relativePath}`;
}
