import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Direct (non-pooled) connection — migrations must not go through the
    // transaction pooler.
    url: process.env.MIGRATE_DATABASE_URL ?? "",
  },
} satisfies Config;
