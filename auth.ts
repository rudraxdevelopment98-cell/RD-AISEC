import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import {
  isApprovedEmail,
  getMemberAccess,
  touchMemberLogin,
  isOwnerEmail,
} from "@/lib/members";

/** Re-exported for server-side owner checks. */
export { isOwnerEmail };

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Gate sign-in: only owners and approved members get in.
    async signIn({ user }) {
      const ok = await isApprovedEmail(user?.email);
      if (ok) await touchMemberLogin(user?.email);
      return ok;
    },
    // Bake role + access into the token on sign-in so the edge middleware (which
    // can't reach the database) can authorize each request.
    async jwt({ token, user }) {
      if (user?.email) {
        const a = await getMemberAccess(user.email);
        (token as { role?: string }).role = a.role;
        (token as { access?: string }).access = a.access.join(",");
      }
      return token;
    },
  },
});
