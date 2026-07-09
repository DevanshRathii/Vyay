import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) for categorize tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { categorize, ensureDefaultCategories, loadCategorizerContext } from "@/lib/categorize";

let userId: string;

beforeEach(async () => {
  await db.delete(users);
  const rows = await db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning();
  userId = rows[0].id;
  await ensureDefaultCategories(userId);
});

describe("categorize — amazon vs amazon pay", () => {
  it("categorizes a real Amazon purchase as Shopping", async () => {
    const ctx = await loadCategorizerContext(userId);
    const id = categorize(ctx, { merchant: "Amazon", merchantNormalized: "amazon", upiId: undefined, subject: undefined });
    expect(ctx.categoriesById.get(id!)?.name).toBe("Shopping");
  });

  it("does not categorize an Amazon Pay UPI id as Shopping", async () => {
    const ctx = await loadCategorizerContext(userId);
    const id = categorize(ctx, { merchant: null, merchantNormalized: null, upiId: "amazonpay@apl", subject: null });
    expect(id).toBeNull();
  });

  it("does not categorize a spaced-out 'Amazon Pay' merchant name as Shopping either", async () => {
    const ctx = await loadCategorizerContext(userId);
    const id = categorize(ctx, { merchant: "Amazon Pay", merchantNormalized: "amazon", upiId: null, subject: null });
    expect(id).toBeNull();
  });
});
