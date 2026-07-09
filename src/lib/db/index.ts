import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set (Supabase transaction-pooler connection string).");
  }
  // max: 1 — serverless: one connection per function instance.
  // prepare: false — required: Supabase's transaction-mode pooler (Supavisor,
  // port 6543) does not support prepared statements.
  const client = postgres(url, { max: 1, prepare: false });
  return drizzle(client, { schema });
}

// Cache across HMR reloads in dev. Migrations are applied at build/deploy
// time via `tsx migrate.ts`, not at boot.
const globalForDb = globalThis as unknown as { __vyayDb?: ReturnType<typeof createDb> };
export const db = globalForDb.__vyayDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__vyayDb = db;

export * as schema from "./schema";
