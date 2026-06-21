import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import fs from "node:fs";
import path from "node:path";

type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  sqlite: unknown;
  drizzleDb: DrizzleDB;
};

function createDb(): DrizzleDB {
  if (globalForDb.drizzleDb) return globalForDb.drizzleDb;

  // Dynamic require to avoid loading native binary at build time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");

  const dbPath =
    process.env.DATABASE_URL?.replace("file:", "") || "./data/aicomic.db";
  const absolutePath = path.resolve(dbPath);

  // Ensure the directory exists before opening the database
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const sqlite = globalForDb.sqlite ?? new Database(absolutePath);
  if (process.env.NODE_ENV !== "production") {
    globalForDb.sqlite = sqlite;
  }

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const instance = drizzle(sqlite, { schema });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.drizzleDb = instance;
  }
  return instance;
}

export async function runMigrations() {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const migrationsFolder = path.resolve("drizzle");
  migrate(createDb(), { migrationsFolder });
}

// Proxy preserves the `db` export API — lazy-inits on first property access
export const db: DrizzleDB = new Proxy({} as DrizzleDB, {
  get(_, prop) {
    const instance = createDb();
    const value = (instance as never)[prop];
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(instance);
    }
    return value;
  },
});

export type DB = typeof db;
