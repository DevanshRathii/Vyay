import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "fs";
import path from "path";
import * as schema from "./schema";

function createDb() {
  const dbPath = process.env.DATABASE_PATH ?? "./data/vyay.db";
  const resolved = path.resolve(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const database = drizzle(sqlite, { schema });
  // Apply pending migrations automatically so self-hosters never need to
  // remember a separate migrate step.
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  if (fs.existsSync(migrationsFolder)) {
    migrate(database, { migrationsFolder });
  }
  return database;
}

// Cache across HMR reloads in dev.
const globalForDb = globalThis as unknown as { __vyayDb?: ReturnType<typeof createDb> };
export const db = globalForDb.__vyayDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__vyayDb = db;

export * as schema from "./schema";
