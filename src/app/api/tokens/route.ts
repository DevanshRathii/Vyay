import { desc, eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiTokens } from "@/lib/db/schema";
import { badRequest, getUserId, unauthorized } from "@/lib/session";
import { randomToken, sha256 } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const rows = await db
    .select({
      id: apiTokens.id,
      label: apiTokens.label,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt));
  return NextResponse.json({ rows });
}

const createSchema = z.object({ label: z.string().trim().min(1).max(60).optional() });

/** Create a token. The plaintext is returned exactly once and never stored. */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const token = randomToken();
  const row = (
    await db
      .insert(apiTokens)
      .values({ userId, label: parsed.data.label ?? "Apple Shortcut", tokenHash: sha256(token) })
      .returning()
  )[0];
  return NextResponse.json({ id: row.id, label: row.label, token });
}

export async function DELETE(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("Missing token id.");
  await db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)));
  return NextResponse.json({ ok: true });
}
