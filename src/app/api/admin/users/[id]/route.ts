import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { badRequest, getIsAdmin, notFound, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ gmailAccessGranted: z.boolean() });

/** Grant or revoke a user's ability to start the Gmail-connect OAuth flow.
 *  This only controls Vyay's own gate — it has no effect on Google's Test
 *  users list, which the admin still has to maintain separately in Cloud
 *  Console for the user to actually complete that flow. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getIsAdmin())) return unauthorized();
  const { id } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  const row = (await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1))[0];
  if (!row) return notFound("User not found.");

  await db.update(users).set({ gmailAccessGranted: parsed.data.gmailAccessGranted }).where(eq(users.id, id));
  return NextResponse.json({ ok: true });
}
