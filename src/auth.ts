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
    async jwt({ token, user, account, profile }) {
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
                gmailAccessGranted: isAdmin,
              })
              .returning()
          )[0];
          await ensureDefaultCategories(dbUser.id);
          // Plain Google sign-in only needs a basic (non-sensitive-scope)
          // consent, which Google never restricts — so this fires for
          // literally anyone with a Google account, not just people already
          // on the Test users list. FYI-only, fired once ever per account,
          // never for ADMIN_EMAIL's own first sign-in.
          if (!isAdmin) {
            waitUntil(notifyAdmin(`New Vyay user: ${email} — grant Gmail access from /admin once they're also added as a Google test user.`));
          }
        }
        token.uid = dbUser.id;
      } else if (user?.id) {
        token.uid = user.id;
      }
      return token;
    },
  },
});
