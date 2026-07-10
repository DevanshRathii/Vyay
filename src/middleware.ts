import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  if (!req.auth) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("next", req.nextUrl.pathname);
    return Response.redirect(url);
  }
  if (!req.auth.user.approved) {
    return Response.redirect(new URL("/pending-approval", req.nextUrl));
  }
});

// Pages that require a signed-in user. API routes enforce auth themselves.
export const config = {
  matcher: ["/", "/ledger/:path*", "/categories/:path*", "/matches/:path*", "/settings/:path*"],
};
