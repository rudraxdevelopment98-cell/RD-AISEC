import { auth } from "@/auth";
import { NextResponse } from "next/server";

/**
 * Gate the whole dashboard behind authentication. Unauthenticated requests to
 * any /dashboard route are redirected to the login page.
 */
export default auth((req) => {
  const isLoggedIn = !!req.auth?.user;
  const isOnDashboard = req.nextUrl.pathname.startsWith("/dashboard");

  if (isOnDashboard && !isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Run on dashboard routes only; skip static assets and API auth routes.
  matcher: ["/dashboard/:path*"],
};
