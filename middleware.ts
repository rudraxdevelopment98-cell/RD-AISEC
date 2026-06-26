import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

/**
 * Auth gate (edge): require a logged-in user for the dashboard and forward the
 * request path to the app via a header. Per-section access is enforced in the
 * dashboard layout against the LIVE database, so changes apply immediately
 * (no need to sign out/in after an owner edits a member's access).
 */
export default NextAuth(authConfig).auth((req) => {
  const path = req.nextUrl.pathname;
  if (!path.startsWith("/dashboard")) return NextResponse.next();

  if (!req.auth?.user) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  const headers = new Headers(req.headers);
  headers.set("x-pathname", path);
  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
