/**
 * Standalone migration runner: `npx tsx migrate.ts`
 *
 * Runs at build time on Vercel (env vars come from the platform) and locally
 * (env vars come from .env / .env.local via process.loadEnvFile).
 * MIGRATE_DATABASE_URL must NOT be the transaction pooler (port 6543) —
 * migrations need session-scoped/prepared statements. On Vercel it must
 * also not be Supabase's direct connection host, which is IPv6-only and
 * unreachable from Vercel's build containers (ENETUNREACH) — use the
 * session pooler (also port 5432) instead. See .env.example.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  // Load local env files when present; on Vercel neither exists and the
  // platform provides the variables directly.
  for (const file of [".env", ".env.local"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // file absent — fine
    }
  }

  // Preview/Development deployments must never run migrations against the
  // real database — env vars are (deliberately) Production-scoped only, and
  // an earlier incident showed a preview build racing to re-apply a migration
  // production had already run, corrupting schema state ("relation already
  // exists"). Skip cleanly here instead of failing the build or, worse,
  // reaching a shared database. Self-host/local builds (VERCEL unset) and
  // real Production builds are unaffected.
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "production") {
    console.log(`[migrate] skipping — VERCEL_ENV="${process.env.VERCEL_ENV}", migrations only run on Production`);
    return;
  }

  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) {
    console.error("MIGRATE_DATABASE_URL is not set (direct Supabase connection string, port 5432).");
    process.exit(1);
  }

  const client = postgres(url, { max: 1, prepare: false });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    console.log("[migrate] all migrations applied");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
