import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseSamples } from "@/lib/db/schema";
import { notifyAdmin } from "@/lib/notify";
import { badRequest, getUserId, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  kind: z.enum(["email", "sms"]),
  text: z.string().trim().min(1).max(4000),
  note: z.string().trim().max(500).optional(),
});

/**
 * "Report a bad parse" — the user has already reviewed and can edit the
 * text client-side before this call; submitted in the clear by intent (see
 * parseSamples' schema comment). Never touches the zero-access encryption
 * boundary, which protects data the user didn't choose to share.
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);

  await db.insert(parseSamples).values({
    userId,
    kind: parsed.data.kind,
    text: parsed.data.text,
    note: parsed.data.note ?? null,
  });

  waitUntil(notifyAdmin("Parse sample donated", "A user reported a bad parse — review it in /admin."));
  return NextResponse.json({ ok: true });
}
