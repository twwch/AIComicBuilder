/**
 * Post-build script: prepares .next/standalone/ for production.
 * 1. Copies .env → .next/standalone/.env (with relative paths)
 * 2. Copies drizzle/ migrations folder → .next/standalone/drizzle/
 * 3. Copies data/ database → .next/standalone/data/ (if exists)
 *
 * Next.js standalone output does NOT auto-bundle these by default.
 */
import fs from "node:fs";
import path from "node:path";

const STANDALONE_DIR = path.resolve(".next/standalone");

/* ── 1. Copy & rewrite .env ── */
const envSrc = path.resolve(".env");
const envDest = path.join(STANDALONE_DIR, ".env");

if (fs.existsSync(envSrc)) {
  const envContent = fs.readFileSync(envSrc, "utf-8");

  // Rewrite DATABASE_URL from an absolute path to a relative one
  // so it works regardless of which machine the standalone runs on.
  const rewritten = envContent
    .split("\n")
    .map((line) => {
      if (line.startsWith("DATABASE_URL=")) {
        // Replace absolute path with relative path within standalone dir
        return "DATABASE_URL=file:./data/aicomic.db";
      }
      return line;
    })
    .join("\n");

  fs.writeFileSync(envDest, rewritten, "utf-8");
  console.log(`[postbuild] Copied & rewritten .env → ${envDest}`);
} else {
  console.warn(`[postbuild] .env not found — skipping standalone env copy`);
}

/* ── 2. Copy drizzle/ migrations ── */
const drizzleSrc = path.resolve("drizzle");
const drizzleDest = path.join(STANDALONE_DIR, "drizzle");

fs.cpSync(drizzleSrc, drizzleDest, { recursive: true, force: true });
console.log(`[postbuild] Copied drizzle/ → ${drizzleDest}`);

/* ── 3. Copy data/ database (if exists) ── */
const dataSrc = path.resolve("data");
const dataDest = path.join(STANDALONE_DIR, "data");

if (fs.existsSync(dataSrc)) {
  fs.cpSync(dataSrc, dataDest, { recursive: true, force: true });
  console.log(`[postbuild] Copied data/ → ${dataDest}`);
} else {
  console.log(`[postbuild] data/ not found — will be created fresh by migrations`);
}

/* ── 4. Copy workflow templates for ComfyUI providers ── */
const workflowsSrc = path.resolve("src/lib/ai/providers/workflows");
const workflowsDest = path.join(STANDALONE_DIR, "src/lib/ai/providers/workflows");
if (fs.existsSync(workflowsSrc)) {
  fs.cpSync(workflowsSrc, workflowsDest, { recursive: true, force: true });
  console.log(`[postbuild] Copied workflows/ → ${workflowsDest}`);
}
