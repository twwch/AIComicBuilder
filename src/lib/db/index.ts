import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_URL?.replace("file:", "") || "./data/aicomic.db";
const absolutePath = path.resolve(dbPath);
fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

// Prevent multiple connections in dev mode (HMR re-evaluates modules)
const globalForDb = globalThis as unknown as { sqlite: InstanceType<typeof Database> };
const sqlite = globalForDb.sqlite ?? new Database(absolutePath);
if (process.env.NODE_ENV !== "production") {
  globalForDb.sqlite = sqlite;
}

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
