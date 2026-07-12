import NextAuth from "next-auth";
import { eq } from "drizzle-orm";
import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { preapprovedEmails, users } from "@/lib/db/schema";
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
          // An admin can pre-approve a specific email (from /admin) before
          // that person ever signs in — typically right after also adding
          // them to Google's Test users list, so the whole thing "just
          // works" for them with zero extra steps on either side.
          const preapproved = (
            await db.select().from(preapprovedEmails).where(eq(preapprovedEmails.email, email)).limit(1)
          )[0];
          const gmailAccessGranted = isAdmin || Boolean(preapproved);

          dbUser = (
            await db
              .insert(users)
              .values({
                email,
                name: profile.name ?? email.split("@")[0],
                image: typeof profile.picture === "string" ? profile.picture : null,
                gmailAccessGranted,
              })
              .returning()
          )[0];
          await ensureDefaultCategories(dbUser.id);
          if (preapproved) {
            await db.delete(preapprovedEmails).where(eq(preapprovedEmails.id, preapproved.id));
          }

          // Plain Google sign-in only needs a basic (non-sensitive-scope)
          // consent, which Google never restricts — so this fires for
          // literally anyone with a Google account, not just people already
          // on the Test users list. FYI-only, fired once ever per account,
          // never for ADMIN_EMAIL's own first sign-in.
          if (!isAdmin) {
            waitUntil(
              notifyAdmin(
                "New sign-up",
                preapproved
                  ? `${email} signed up and already had Gmail access pre-approved — they're all set, no action needed from you.`
                  : `${email} signed up. Grant Gmail access from /admin once you've also added them as a Google test user.`,
              ),
            );
          }
        } else if (!dbUser.gmailAccessGranted) {
          // Heal the signed-up-before-being-preapproved ordering: the
          // creation branch above only consumes a preapproval at first
          // sign-in, so an email added to the list AFTER the account
          // already existed would otherwise sit unconsumed forever while
          // the user stays locked out of Gmail connect.
          const preapproved = (
            await db.select().from(preapprovedEmails).where(eq(preapprovedEmails.email, email)).limit(1)
          )[0];
          if (preapproved) {
            await db.update(users).set({ gmailAccessGranted: true }).where(eq(users.id, dbUser.id));
            await db.delete(preapprovedEmails).where(eq(preapprovedEmails.id, preapproved.id));
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
