/**
 * Convert local upload file paths to /api/uploads URLs, while preserving
 * public/static URLs that Next.js serves directly from /public.
 */
export function uploadUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");

  if (!normalized) return normalized;
  if (/^(https?:|data:|blob:)/i.test(normalized)) return normalized;
  if (normalized.startsWith("/generated/")) return normalized;
  if (normalized.startsWith("/templates/")) return normalized;
  if (normalized.startsWith("/api/uploads/")) return normalized;

  const stripped = normalized.replace(/^.*?uploads\//, "");
  return `/api/uploads/${stripped}`;
}
