import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ensureDefaultCategories } from "@/lib/categorize";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { name, email, password } = parsed.data;
  const existing = db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = db
    .insert(users)
    .values({ email: email.toLowerCase(), name, passwordHash })
    .returning()
    .get();
  ensureDefaultCategories(user.id);
  return NextResponse.json({ ok: true, id: user.id });
}
