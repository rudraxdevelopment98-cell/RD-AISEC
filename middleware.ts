import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { canAccess } from "@/lib/access";

/**
 * Gate the dashboard: require authentication, then require per-section access.
 * Runs on the edge — uses only the edge-safe authConfig (no Prisma). Role and
 * access were baked into the JWT at sign-in by the Node-side jwt callback.
 */
export default NextAuth(authConfig).auth((req) => {
  const user = req.auth?.user as { role?: string; access?: string[] } | undefined;
  const path = req.nextUrl.pathname;

  if (!path.startsWith("/dashboard")) return NextResponse.next();

  if (!user) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  if (!canAccess(path, { role: user.role, access: user.access })) {
    return NextResponse.redirect(new URL("/dashboard?denied=1", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
