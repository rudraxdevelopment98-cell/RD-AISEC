// Access-control catalog + pure checks. NO prisma/Node imports here — this file
// is imported by the edge middleware, so it must stay edge-safe.
//
// Everything below is DERIVED from the single nav source of truth (lib/nav.ts):
// add a section there and it automatically becomes grantable here — no second
// list to maintain.
import { NAV_ITEMS, accessClass } from "./nav";

// The dashboard sections an owner can grant a member access to. Keys are the
// route prefixes; everything under a key is included. `group` is the nav
// section, used to group the access checkboxes on the Members page.
export const GRANTABLE_ITEMS: { key: string; label: string; group: string }[] =
  NAV_ITEMS.filter((i) => accessClass(i) === "grantable").map((i) => ({
    key: i.href,
    label: i.label,
    group: i.section,
  }));

export const GRANTABLE_KEYS = GRANTABLE_ITEMS.map((i) => i.key);

// Always reachable by any signed-in member (the landing/overview + helpers).
const ALWAYS_ALLOWED = NAV_ITEMS.filter((i) => accessClass(i) === "always").map(
  (i) => i.href,
);
// Owner-only routes (never grantable to a plain member).
const OWNER_ONLY = NAV_ITEMS.filter((i) => accessClass(i) === "owner").map(
  (i) => i.href,
);

export type AccessInfo = { role?: string | null; access?: string[] | null };

export function parseAccess(raw?: string | null): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isOwnerRole(info: AccessInfo): boolean {
  return info.role === "owner" || (info.access ?? []).includes("*");
}

/** Can this user reach `pathname`? Owners → everything; members → granted keys. */
export function canAccess(pathname: string, info: AccessInfo): boolean {
  if (isOwnerRole(info)) return true;
  if (OWNER_ONLY.some((k) => pathname === k || pathname.startsWith(k + "/"))) return false;
  if (pathname === "/dashboard" || ALWAYS_ALLOWED.includes(pathname)) return true;
  const granted = info.access ?? [];
  return granted.some((k) => pathname === k || pathname.startsWith(k + "/"));
}
