/**
 * Normalize stored upload references to a portable DB path.
 *
 * Providers often return filesystem paths based on UPLOAD_DIR, which is
 * absolute in Docker (for example /app/uploads/frames/x.png). Persisting that
 * makes URLs environment-specific and can break /api/uploads authorization.
 */
export function normalizeUploadPath(filePath: string, uploadDir?: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) return normalized;

  if (normalized.startsWith("/api/uploads/")) {
    return `uploads/${normalized.slice("/api/uploads/".length).replace(/^\/+/, "")}`;
  }

  const normalizedUploadDir = uploadDir
    ?.replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (
    normalizedUploadDir &&
    (normalized === normalizedUploadDir || normalized.startsWith(`${normalizedUploadDir}/`))
  ) {
    const suffix = normalized.slice(normalizedUploadDir.length).replace(/^\/+/, "");
    return suffix ? `uploads/${suffix}` : "uploads";
  }

  if (normalized.startsWith("uploads/") || normalized === "uploads") {
    return normalized;
  }

  const uploadMatch = normalized.match(/(?:^|\/)uploads(?:\/(.+))?$/);
  if (uploadMatch) {
    return uploadMatch[1] ? `uploads/${uploadMatch[1]}` : "uploads";
  }

  return normalized;
}

export function uploadPathVariants(filePath: string, uploadDir?: string): string[] {
  const portablePath = normalizeUploadPath(filePath, uploadDir);
  const variants = new Set<string>([portablePath]);
  const suffix = portablePath.startsWith("uploads/")
    ? portablePath.slice("uploads/".length)
    : "";
  const normalizedUploadDir = uploadDir
    ?.replace(/\\/g, "/")
    .replace(/\/+$/, "");

  if (suffix && normalizedUploadDir) {
    variants.add(`${normalizedUploadDir}/${suffix}`);
  }
  if (suffix && normalizedUploadDir?.startsWith("./")) {
    variants.add(`${normalizedUploadDir.slice(2)}/${suffix}`);
  }

  return Array.from(variants);
}
