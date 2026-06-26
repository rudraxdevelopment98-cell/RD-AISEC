import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { parseAccess } from "@/lib/access";

/**
 * Edge-safe auth config (NO database / Node-only imports). Used by the
 * middleware. The Node-side auth.ts spreads this and adds the DB-backed signIn /
 * jwt callbacks. Keeping them split means the middleware never bundles Prisma.
 */
const providers = [];

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  );
}

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  );
}

if (process.env.ALLOW_DEV_LOGIN === "true") {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Developer login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: (creds) => {
        const email = String(creds?.email ?? "").toLowerCase();
        const password = String(creds?.password ?? "");
        const expected = process.env.DEV_LOGIN_PASSWORD ?? "letmein";
        if (email && password === expected) {
          return { id: email, email, name: email.split("@")[0] };
        }
        return null;
      },
    }),
  );
}

export const authConfig = {
  providers,
  pages: { signIn: "/login" },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    // Pass-through; the Node config (auth.ts) overrides this to populate
    // role/access from the database on sign-in.
    jwt({ token }) {
      return token;
    },
    // Expose role + access (baked into the token at sign-in) on the session so
    // both server components and the edge middleware can read them.
    session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role =
          (token as { role?: string }).role ?? undefined;
        (session.user as { access?: string[] }).access = parseAccess(
          (token as { access?: string }).access,
        );
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
