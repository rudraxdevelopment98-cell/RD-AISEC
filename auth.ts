import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

/**
 * Access control: only authorized people get in.
 *
 * The allowlist is read from the AUTHORIZED_EMAILS env var (comma-separated).
 * - If it is set, only those emails may sign in (OAuth or dev login).
 * - If it is empty, every successful OAuth login is allowed (useful while
 *   bootstrapping). Tighten this in production by setting AUTHORIZED_EMAILS.
 */
function authorizedEmails(): string[] {
  return (process.env.AUTHORIZED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAuthorized(email?: string | null): boolean {
  const allow = authorizedEmails();
  if (allow.length === 0) return true; // no allowlist configured yet
  if (!email) return false;
  return allow.includes(email.toLowerCase());
}

const providers = [];

// OAuth providers are only registered when their credentials are present,
// so the app still boots in environments where they aren't configured yet.
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

/**
 * Dev login: a username/password fallback so the dashboard is usable before
 * OAuth apps are configured. Enabled only when ALLOW_DEV_LOGIN=true.
 * NEVER enable this in production.
 */
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    signIn({ user }) {
      return isAuthorized(user?.email);
    },
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
});
