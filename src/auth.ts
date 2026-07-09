import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ensureDefaultCategories } from "@/lib/categorize";
import { authConfig } from "@/auth.config";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const user = (
          await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1)
        )[0];
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
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
        }
        token.uid = dbUser.id;
      } else if (user?.id) {
        token.uid = user.id;
      }
      return token;
    },
  },
});
