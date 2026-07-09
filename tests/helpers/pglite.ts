import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

/**
 * In-process Postgres for tests. Runs the same generated pg migration SQL
 * the real database gets, so schema drift between tests and production is
 * confined to engine behavior, not DDL.
 *
 * Usage inside a vi.mock factory:
 *   vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  const dir = path.join(process.cwd(), "drizzle");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }

  return { db, schema };
}
