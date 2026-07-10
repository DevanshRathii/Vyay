import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { db } from "@/lib/db";
import { feedbackMessages, users } from "@/lib/db/schema";
import { notifyAdmin } from "@/lib/notify";
import { badRequest, getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ message: z.string().trim().min(1).max(2000) });

/** "Urgent feedback" — any signed-in user can flag a blocking bug straight to the app owner. */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  await db.insert(feedbackMessages).values({ userId, message: parsed.data.message });

  const user = (await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1))[0];
  waitUntil(notifyAdmin(`Urgent Vyay feedback from ${user?.email ?? userId}:\n${parsed.data.message}`));

  return NextResponse.json({ ok: true });
}
