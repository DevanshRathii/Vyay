import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) — same harness as the other DB-backed tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

beforeEach(async () => {
  await db.delete(users);
});

describe("users.approved — the access-request gate", () => {
  it("defaults a newly created user to unapproved (the migration grandfathers only pre-existing rows)", async () => {
    const rows = await db.insert(users).values({ email: `new${Math.random()}@t.io` }).returning();
    expect(rows[0].approved).toBe(false);
  });

  it("the admin access-requests query (eq(approved, false)) surfaces pending users and stops after approval", async () => {
    const rows = await db
      .insert(users)
      .values([{ email: `pending${Math.random()}@t.io` }, { email: `admin${Math.random()}@t.io`, approved: true }])
      .returning();
    const pendingId = rows[0].id;

    let pending = await db.select().from(users).where(eq(users.approved, false));
    expect(pending.map((u) => u.id)).toEqual([pendingId]);

    await db.update(users).set({ approved: true }).where(eq(users.id, pendingId));

    pending = await db.select().from(users).where(eq(users.approved, false));
    expect(pending).toHaveLength(0);
  });

  it("deny (delete) removes the pending user row entirely", async () => {
    const rows = await db.insert(users).values({ email: `deny${Math.random()}@t.io` }).returning();
    await db.delete(users).where(eq(users.id, rows[0].id));
    const remaining = await db.select().from(users).where(eq(users.id, rows[0].id));
    expect(remaining).toHaveLength(0);
  });
});
