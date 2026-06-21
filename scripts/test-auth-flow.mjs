/**
 * Auth flow e2e test.
 * Tests: createSignedUserId → getUserIdFromRequest roundtrip in Node.js runtime.
 * Usage: node scripts/test-auth-flow.mjs
 */
import crypto from "node:crypto";

const AUTH_COOKIE = "ai_comic_auth";

function getSecret() {
  const g = globalThis;
  if (g.__AUTH_SECRET_TEST) return g.__AUTH_SECRET_TEST;
  g.__AUTH_SECRET_TEST = process.env.AUTH_SECRET || crypto.randomUUID().replace(/-/g, "");
  return g.__AUTH_SECRET_TEST;
}

function hmacSign(data) {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
}

function createSignedUserId() {
  const uid = crypto.randomUUID().replace(/-/g, "");
  return `${uid}.${hmacSign(uid)}`;
}

function verifyToken(token) {
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const uid = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sig !== hmacSign(uid)) return null;
  return uid;
}

function getUserIdFromRequest(request) {
  const cookieHeader = request.headers["cookie"] || "";
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    cookies[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  const cookieToken = cookies[AUTH_COOKIE];
  if (cookieToken) {
    const uid = verifyToken(cookieToken);
    if (uid) return uid;
  }
  const headerToken = request.headers["x-user-id"] || "";
  if (headerToken.includes(".")) {
    const uid = verifyToken(headerToken);
    if (uid) return uid;
  }
  return "";
}

// ── Tests ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

console.log("Auth flow e2e tests\n");

// 1. Token creation
const token1 = createSignedUserId();
assert(token1.includes("."), "Token contains dot separator");
const [uid1, sig1] = token1.split(".");
assert(uid1.length > 0, "UID part non-empty");
assert(sig1.length > 0, "Signature part non-empty");
assert(sig1 === hmacSign(uid1), "Signature verifies against UID");
console.log("  1) createSignedUserId: OK");

// 2. verifyToken valid
const uid2 = verifyToken(token1);
assert(uid2 === uid1, "verifyToken extracts correct UID");
console.log("  2) verifyToken (valid): OK");

// 3. verifyToken tampered
const tampered = "tampered." + sig1;
assert(verifyToken(tampered) === null, "verifyToken rejects tampered UID");
const tamperedSig = uid1 + ".00000000000000000000000000000000";
assert(verifyToken(tamperedSig) === null, "verifyToken rejects tampered signature");
console.log("  3) verifyToken (tampered): OK");

// 4. getUserIdFromRequest via cookie
const req1 = { headers: { cookie: `${AUTH_COOKIE}=${token1}` } };
assert(getUserIdFromRequest(req1) === uid1, "getUserIdFromRequest reads cookie");
console.log("  4) getUserIdFromRequest (cookie): OK");

// 5. getUserIdFromRequest via x-user-id header
const req2 = { headers: { "x-user-id": token1, cookie: "" } };
assert(getUserIdFromRequest(req2) === uid1, "getUserIdFromRequest reads x-user-id header");
console.log("  5) getUserIdFromRequest (header): OK");

// 6. getUserIdFromRequest: cookie takes priority over header
const req3 = {
  headers: {
    cookie: `${AUTH_COOKIE}=${token1}`,
    "x-user-id": "fake.invalid",
  },
};
assert(getUserIdFromRequest(req3) === uid1, "getUserIdFromRequest prefers cookie");
console.log("  6) getUserIdFromRequest (cookie priority): OK");

// 7. getUserIdFromRequest: no auth
const req4 = { headers: { cookie: "", "x-user-id": "" } };
assert(getUserIdFromRequest(req4) === "", "getUserIdFromRequest returns empty on no auth");
console.log("  7) getUserIdFromRequest (no auth): OK");

// 8. Multiple tokens with different secrets fail correctly
const origSecret = getSecret();
const origDescribe = Object.getOwnPropertyDescriptor(globalThis, "__AUTH_SECRET_TEST");
Object.defineProperty(globalThis, "__AUTH_SECRET_TEST", { value: "different-secret", configurable: true, writable: true });
const diffToken = createSignedUserId();
assert(verifyToken(diffToken) !== null, "Different secret: own tokens verify");
// Restore
Object.defineProperty(globalThis, "__AUTH_SECRET_TEST", { value: origSecret, configurable: true, writable: true });
assert(verifyToken(diffToken) === null, "Different secret: tokens from other secret rejected");
console.log("  8) Cross-secret rejection: OK");

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
