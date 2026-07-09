/**
 * Standalone migration runner: `npx tsx migrate.ts`
 *
 * Runs at build time on Vercel (env vars come from the platform) and locally
 * (env vars come from .env / .env.local via process.loadEnvFile). Always uses
 * the DIRECT database connection — migrations must not go through the
 * transaction pooler.
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
