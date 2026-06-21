async function loadEnv() {
  // In production standalone mode (node server.js), Next.js does NOT
  // auto-load .env files. We load them manually so DATABASE_URL etc.
  // are available before bootstrap runs.
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.DATABASE_URL &&
    process.env.NEXT_RUNTIME === "nodejs"
  ) {
    try {
      const { config } = await import("dotenv");
      const { resolve } = await import("path");
      config({ path: resolve(".env"), override: false });
    } catch {
      // dotenv not available — user must set env vars themselves
    }
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await loadEnv();
    const { bootstrap } = await import("@/lib/bootstrap");
    await bootstrap();
  }
}
