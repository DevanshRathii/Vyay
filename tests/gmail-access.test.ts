import { beforeEach, describe, expect, it, vi } from "vitest";

// In-process Postgres (PGlite) — same harness as the other DB-backed tests.
vi.mock("@/lib/db", async () => (await import("./helpers/pglite")).createTestDb());

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gmailConnections, preapprovedEmails, users } from "@/lib/db/schema";

beforeEach(async () => {
  await db.delete(gmailConnections);
  await db.delete(users);
  await db.delete(preapprovedEmails);
});

/** Mirrors the sign-up branch in auth.ts's jwt callback. */
async function signUp(email: string) {
  const preapproved = (
    await db.select().from(preapprovedEmails).where(eq(preapprovedEmails.email, email)).limit(1)
  )[0];
  const row = (
    await db.insert(users).values({ email, gmailAccessGranted: Boolean(preapproved) }).returning()
  )[0];
  if (preapproved) await db.delete(preapprovedEmails).where(eq(preapprovedEmails.id, preapproved.id));
  return row;
}

describe("users.gmailAccessGranted — gates the Gmail-connect flow, not sign-in", () => {
  it("defaults a newly created user to not granted", async () => {
    const rows = await db.insert(users).values({ email: `new${Math.random()}@t.io` }).returning();
    expect(rows[0].gmailAccessGranted).toBe(false);
  });

  it("the /api/gmail/connect check (select granted by id) reflects an admin grant", async () => {
    const rows = await db.insert(users).values({ email: `u${Math.random()}@t.io` }).returning();
    const userId = rows[0].id;

    let dbUser = (await db.select({ granted: users.gmailAccessGranted }).from(users).where(eq(users.id, userId)).limit(1))[0];
    expect(dbUser.granted).toBe(false);

    await db.update(users).set({ gmailAccessGranted: true }).where(eq(users.id, userId));

    dbUser = (await db.select({ granted: users.gmailAccessGranted }).from(users).where(eq(users.id, userId)).limit(1))[0];
    expect(dbUser.granted).toBe(true);
  });

  it("the admin panel's join reports hasGmailConnection only for users with a real connection row", async () => {
    const rows = await db
      .insert(users)
      .values([{ email: `connected${Math.random()}@t.io` }, { email: `notconnected${Math.random()}@t.io` }])
      .returning();
    await db.insert(gmailConnections).values({
      userId: rows[0].id,
      emailAddress: "bank-alerts@example.com",
      accessToken: "enc",
      refreshToken: "enc",
    });

    const joined = await db
      .select({ id: users.id, hasGmailConnection: gmailConnections.id })
      .from(users)
      .leftJoin(gmailConnections, eq(gmailConnections.userId, users.id));

    const byId = new Map(joined.map((r) => [r.id, r.hasGmailConnection !== null]));
    expect(byId.get(rows[0].id)).toBe(true);
    expect(byId.get(rows[1].id)).toBe(false);
  });
});

describe("preapprovedEmails — pre-approve someone before their first sign-in", () => {
  it("grants Gmail access immediately for a pre-approved email, and consumes the row", async () => {
    const email = `pre${Math.random()}@t.io`;
    await db.insert(preapprovedEmails).values({ email });

    const user = await signUp(email);
    expect(user.gmailAccessGranted).toBe(true);

    const remaining = await db.select().from(preapprovedEmails).where(eq(preapprovedEmails.email, email));
    expect(remaining).toHaveLength(0);
  });

  it("a non-preapproved sign-up still defaults to not granted", async () => {
    const user = await signUp(`plain${Math.random()}@t.io`);
    expect(user.gmailAccessGranted).toBe(false);
  });

  it("does not consume or grant for an unrelated preapproved row", async () => {
    await db.insert(preapprovedEmails).values({ email: `other${Math.random()}@t.io` });
    const user = await signUp(`unmatched${Math.random()}@t.io`);
    expect(user.gmailAccessGranted).toBe(false);
    const stillThere = await db.select().from(preapprovedEmails);
    expect(stillThere).toHaveLength(1);
  });
});
