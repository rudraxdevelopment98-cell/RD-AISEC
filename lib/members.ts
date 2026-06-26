// Member helpers (Node side — uses Prisma). NOT a "use server" file; the form
// actions live in lib/member-actions.ts. Imported by auth.ts.

import { prisma } from "@/lib/db";

/** Owner emails come from the AUTHORIZED_EMAILS env var (comma-separated). */
export function ownerEmails(): string[] {
  return (process.env.AUTHORIZED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerEmail(email?: string | null): boolean {
  if (!email) return false;
  return ownerEmails().includes(email.toLowerCase());
}

export async function getMember(email?: string | null) {
  if (!email) return null;
  return prisma.member.findUnique({ where: { email: email.toLowerCase() } });
}

/**
 * May this email sign in? Owners always; approved members yes. Bootstrap: if no
 * owners are configured AND no members exist yet, allow (so the app isn't locked
 * before it's set up) — matches the previous "empty allowlist = open" behavior.
 */
export async function isApprovedEmail(email?: string | null): Promise<boolean> {
  if (!email) return false;
  if (isOwnerEmail(email)) return true;
  const member = await getMember(email);
  if (member) return member.status === "approved";
  if (ownerEmails().length === 0) {
    const count = await prisma.member.count();
    if (count === 0) return true;
  }
  return false;
}

/** Role + access list for the token. Owners get everything ("*"). */
export async function getMemberAccess(
  email?: string | null,
): Promise<{ role: string; access: string[] }> {
  if (isOwnerEmail(email)) return { role: "owner", access: ["*"] };
  const member = await getMember(email);
  if (member) {
    const access = (member.access ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return { role: member.role === "owner" ? "owner" : "member", access };
  }
  // Bootstrap owner (first user before any owners/members configured).
  if (ownerEmails().length === 0) {
    const count = await prisma.member.count();
    if (count === 0) return { role: "owner", access: ["*"] };
  }
  return { role: "member", access: [] };
}

export async function touchMemberLogin(email?: string | null): Promise<void> {
  if (!email) return;
  await prisma.member
    .updateMany({ where: { email: email.toLowerCase() }, data: { lastLoginAt: new Date() } })
    .catch(() => {});
}

export async function listMembers() {
  return prisma.member.findMany({ orderBy: { createdAt: "desc" } });
}
