import { runMigrations } from "@/lib/db";
import { initializeProviders } from "@/lib/ai/setup";

function validateEnv() {
  const missing: string[] = [];
  const warn: string[] = [];

  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");

  const hasLLM = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!hasLLM) warn.push("No LLM API key set (OPENAI_API_KEY or GEMINI_API_KEY)");

  const hasImage =
    process.env.OPENAI_API_KEY ||
    process.env.KLING_ACCESS_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.SILICONFLOW_API_KEY ||
    process.env.COMFYUI_BASE_URL;
  if (!hasImage) warn.push("No image provider configured");

  if (!process.env.AUTH_SECRET) {
    warn.push("AUTH_SECRET is not set; signed user cookies may fail across runtimes or restarts");
  }

  if (missing.length) {
    console.error("[Bootstrap] Missing critical env vars:", missing.join(", "));
  }
  if (warn.length) {
    for (const msg of warn) console.warn("[Bootstrap]", msg);
  }
}

let bootstrapped = false;

export async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;

  validateEnv();

  console.log("[Bootstrap] Running database migrations...");
  await runMigrations();

  console.log("[Bootstrap] Initializing AI providers...");
  initializeProviders();

  console.log("[Bootstrap] Ready.");
}
