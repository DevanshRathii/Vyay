import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory DB for categorize tests.
vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const Database = (await import("better-sqlite3")).default;
  const schema = await import("@/lib/db/schema");
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const fs = await import("fs");
  const path = await import("path");
  const dir = path.join(process.cwd(), "drizzle");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const migration = fs.readFileSync(path.join(dir, file), "utf8");
    for (const stmt of migration.split("--> statement-breakpoint")) {
      sqlite.exec(stmt);
    }
  }
  return { db: drizzle(sqlite, { schema }), schema };
});

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { categorize, ensureDefaultCategories, loadCategorizerContext } from "@/lib/categorize";

let userId: string;

beforeEach(() => {
  db.delete(users).run();
  userId = db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning().get().id;
  ensureDefaultCategories(userId);
});

describe("categorize — amazon vs amazon pay", () => {
  it("categorizes a real Amazon purchase as Shopping", () => {
    const ctx = loadCategorizerContext(userId);
    const id = categorize(ctx, { merchant: "Amazon", merchantNormalized: "amazon", upiId: undefined, subject: undefined });
    expect(ctx.categoriesById.get(id!)?.name).toBe("Shopping");
  });

  it("does not categorize an Amazon Pay UPI id as Shopping", () => {
    const ctx = loadCategorizerContext(userId);
    const id = categorize(ctx, { merchant: null, merchantNormalized: null, upiId: "amazonpay@apl", subject: null });
    expect(id).toBeNull();
  });

  it("does not categorize a spaced-out 'Amazon Pay' merchant name as Shopping either", () => {
    const ctx = loadCategorizerContext(userId);
    const id = categorize(ctx, { merchant: "Amazon Pay", merchantNormalized: "amazon", upiId: null, subject: null });
    expect(id).toBeNull();
  });
});
