import NextAuth from "next-auth";
import { eq } from "drizzle-orm";
import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ensureDefaultCategories } from "@/lib/categorize";
import { notifyAdmin } from "@/lib/notify";
import { authConfig } from "@/auth.config";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.toLowerCase() ?? null;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, account, profile }) {
      // On initial sign-in, resolve (or create) the database user and pin its id.
      if (account?.provider === "google" && profile?.email) {
        const email = profile.email.toLowerCase();
        const isAdmin = ADMIN_EMAIL !== null && email === ADMIN_EMAIL;
        let dbUser = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
        if (!dbUser) {
          dbUser = (
            await db
              .insert(users)
              .values({
                email,
                name: profile.name ?? email.split("@")[0],
                image: typeof profile.picture === "string" ? profile.picture : null,
                approved: isAdmin,
              })
              .returning()
          )[0];
          await ensureDefaultCategories(dbUser.id);
          if (!isAdmin) {
            waitUntil(notifyAdmin(`New Vyay access request: ${email} — approve it in Settings.`));
          }
        } else if (isAdmin && !dbUser.approved) {
          // ADMIN_EMAIL was pointed at a pre-existing, still-unapproved row
          // (e.g. set after that account's first sign-in) — self-heal it.
          await db.update(users).set({ approved: true }).where(eq(users.id, dbUser.id));
          dbUser.approved = true;
        }
        token.uid = dbUser.id;
        token.approved = dbUser.approved;
        token.isAdmin = isAdmin;
      } else if (token.uid) {
        // Re-derive approved/isAdmin on every subsequent request (JWT
        // strategy has no server-side session to invalidate), so an admin's
        // approval — or ADMIN_EMAIL being set after the fact — takes effect
        // without the user needing to sign out and back in.
        const dbUser = (await db.select({ approved: users.approved }).from(users).where(eq(users.id, token.uid as string)).limit(1))[0];
        if (dbUser) token.approved = dbUser.approved;
        if (typeof token.email === "string") {
          token.isAdmin = ADMIN_EMAIL !== null && token.email.toLowerCase() === ADMIN_EMAIL;
        }
      }
      return token;
    },
  },
});
