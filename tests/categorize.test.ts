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
    const result = categorize(ctx, { merchant: "Amazon", merchantNormalized: "amazon", upiId: undefined, subject: undefined });
    expect(ctx.categoriesById.get(result.categoryId!)?.name).toBe("Shopping");
    expect(result.source).toBe("brand");
  });

  it("does not categorize an Amazon Pay UPI id as Shopping", async () => {
    const ctx = await loadCategorizerContext(userId);
    const result = categorize(ctx, { merchant: null, merchantNormalized: null, upiId: "amazonpay@apl", subject: null });
    expect(result.categoryId).toBeNull();
  });

  it("does not categorize a spaced-out 'Amazon Pay' merchant name as Shopping either", async () => {
    const ctx = await loadCategorizerContext(userId);
    const result = categorize(ctx, { merchant: "Amazon Pay", merchantNormalized: "amazon", upiId: null, subject: null });
    expect(result.categoryId).toBeNull();
  });
});

describe("categorize — layered rules (§2 regressions)", () => {
  it("does not miscategorize an unrecognized credit-card merchant as Bills via 'cred' matching 'credit'", async () => {
    const ctx = await loadCategorizerContext(userId);
    // Real ICICI fixture subject (tests/parsers.test.ts) — no merchant recognized.
    const result = categorize(ctx, {
      merchant: "Some Unknown Merchant",
      merchantNormalized: "some unknown merchant",
      upiId: undefined,
      subject: "Transaction alert for your ICICI Bank Credit Card",
    });
    expect(result.categoryId).toBeNull();
  });

  it("does not match 'ola' inside 'Gola Sizzlers' (word-boundary, not substring)", async () => {
    const ctx = await loadCategorizerContext(userId);
    const result = categorize(ctx, { merchant: "Gola Sizzlers", merchantNormalized: "gola sizzlers", upiId: undefined, subject: undefined });
    expect(result.categoryId).toBeNull();
  });

  it("categorizes 'La Pinoz Pizza' as Food via the generic 'pizza' keyword", async () => {
    const ctx = await loadCategorizerContext(userId);
    const result = categorize(ctx, { merchant: "La Pinoz Pizza", merchantNormalized: "la pinoz pizza", upiId: undefined, subject: undefined });
    expect(ctx.categoriesById.get(result.categoryId!)?.name).toBe("Food");
    expect(result.source).toBe("generic");
  });

  it("categorizes 'Metropolis Healthcare' as Healthcare via the generic keyword, not Transport via 'metro'", async () => {
    const ctx = await loadCategorizerContext(userId);
    const result = categorize(ctx, { merchant: "Metropolis Healthcare", merchantNormalized: "metropolis healthcare", upiId: undefined, subject: undefined });
    expect(ctx.categoriesById.get(result.categoryId!)?.name).toBe("Healthcare");
  });

  it("resolves 'jiomart' to Groceries regardless of BUILTIN_RULES array order (longest-pattern-first)", async () => {
    const ctx = await loadCategorizerContext(userId);
    const result = categorize(ctx, { merchant: "JioMart", merchantNormalized: "jiomart", upiId: undefined, subject: undefined });
    expect(ctx.categoriesById.get(result.categoryId!)?.name).toBe("Groceries");
    expect(result.source).toBe("brand");
  });

  it("a generic-tier match never consults the subject", async () => {
    const ctx = await loadCategorizerContext(userId);
    // No brand/generic keyword in merchant/upiId; "gym" only appears in the subject.
    const result = categorize(ctx, {
      merchant: "Unknown Co",
      merchantNormalized: "unknown co",
      upiId: undefined,
      subject: "Your gym membership payment",
    });
    expect(result.categoryId).toBeNull();
  });
});

describe("categorize — real production gaps (found via DB investigation)", () => {
  it("categorizes 'Das Food' as Food via the generic 'food' keyword (real fixture, 35 uncategorized rows in one inbox)", async () => {
    const ctx = await loadCategorizerContext(userId);
    const result = categorize(ctx, { merchant: "Das Food", merchantNormalized: "das food", upiId: undefined, subject: undefined });
    expect(ctx.categoriesById.get(result.categoryId!)?.name).toBe("Food");
    expect(result.source).toBe("generic");
  });

  it("categorizes 'Accent on Health' as Healthcare via the generic 'health' keyword (real fixture, 26 uncategorized rows)", async () => {
    const ctx = await loadCategorizerContext(userId);
    const result = categorize(ctx, { merchant: "Accent on Health", merchantNormalized: "accent on health", upiId: undefined, subject: undefined });
    expect(ctx.categoriesById.get(result.categoryId!)?.name).toBe("Healthcare");
    expect(result.source).toBe("generic");
  });

  it("categorizes 'Apple Media Services' as Subscriptions (real Apple billing descriptor, 16 uncategorized rows — didn't match the existing 'apple services' pattern)", async () => {
    const ctx = await loadCategorizerContext(userId);
    const result = categorize(ctx, { merchant: "Apple Media Services", merchantNormalized: "apple media services", upiId: undefined, subject: undefined });
    expect(ctx.categoriesById.get(result.categoryId!)?.name).toBe("Subscriptions");
    expect(result.source).toBe("brand");
  });

  it("categorizes a YouTube charge as Subscriptions", async () => {
    const ctx = await loadCategorizerContext(userId);
    const result = categorize(ctx, { merchant: "YouTube", merchantNormalized: "youtube", upiId: undefined, subject: undefined });
    expect(ctx.categoriesById.get(result.categoryId!)?.name).toBe("Subscriptions");
    expect(result.source).toBe("brand");
  });
});
