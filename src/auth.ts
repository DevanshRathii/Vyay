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
        let dbUser = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
        if (!dbUser) {
          dbUser = (
            await db
              .insert(users)
              .values({
                email,
                name: profile.name ?? email.split("@")[0],
                image: typeof profile.picture === "string" ? profile.picture : null,
              })
              .returning()
          )[0];
          await ensureDefaultCategories(dbUser.id);
          // Sign-in itself is already gated by Google's OAuth Test users list
          // (the app is unverified/in Testing) — anyone reaching this point
          // was already added there. This is just an FYI, fired once ever per
          // account, never on ADMIN_EMAIL's own first sign-in.
          if (ADMIN_EMAIL === null || email !== ADMIN_EMAIL) {
            waitUntil(notifyAdmin(`New Vyay user: ${email}`));
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
