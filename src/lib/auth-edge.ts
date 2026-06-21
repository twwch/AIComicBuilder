interface Globals {
  __AUTH_SECRET?: string;
  __AUTH_UID?: string;
}

function getSecret(): string {
  const g = globalThis as unknown as Globals;
  if (g.__AUTH_SECRET) return g.__AUTH_SECRET;
  g.__AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomUUID().replace(/-/g, "");
  return g.__AUTH_SECRET;
}

/** Deterministic user id derived from AUTH_SECRET via HMAC-SHA256 (first 32 hex chars) */
async function getUid(): Promise<string> {
  const g = globalThis as unknown as Globals;
  if (g.__AUTH_UID) return g.__AUTH_UID;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode("uid"));
  g.__AUTH_UID = Array.from(new Uint8Array(sig)).slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return g.__AUTH_UID;
}

export async function createSignedUserId(): Promise<string> {
  const uid = await getUid();
  const sig = await hmacSign(uid);
  return `${uid}.${sig}`;
}

async function hmacSign(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Verify an ai_comic_auth token signed by the current AUTH_SECRET */
export async function verifyToken(token: string): Promise<string | null> {
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const uid = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacSign(uid);
  return sig === expected ? uid : null;
}
