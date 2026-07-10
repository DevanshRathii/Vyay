import { auth } from "@/auth";
import { NextResponse } from "next/server";

/** Returns the signed-in, approved user's id, or null. Unapproved accounts
 *  are blocked here too — middleware only guards pages, not /api/*. */
export async function getUserId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.approved) return null;
  return session.user.id;
}

/** True if the signed-in user is the app owner (ADMIN_EMAIL). */
export async function getIsAdmin(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user?.approved && session.user.isAdmin);
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
