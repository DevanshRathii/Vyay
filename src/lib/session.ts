import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/** Returns the signed-in user's id, or null. */
export async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** Null means the user hasn't onboarded onto zero-access encryption yet. */
export async function getUserPublicKey(userId: string): Promise<string | null> {
  const row = (await db.select({ publicKey: users.publicKey }).from(users).where(eq(users.id, userId)).limit(1))[0];
  return row?.publicKey ?? null;
}

/** True if the signed-in user is the app owner (ADMIN_EMAIL). No DB round
 *  trip — admin-ness is purely "does your session email match the env var." */
export async function getIsAdmin(): Promise<boolean> {
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  if (!adminEmail) return false;
  const session = await auth();
  return session?.user?.email?.toLowerCase() === adminEmail;
}

export function unauthorized() {
  return NextResponse.json({ error: "Not signed in." }, { status: 401 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = "Not found.") {
  return NextResponse.json({ error: message }, { status: 404 });
}
