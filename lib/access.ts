// Access-control catalog + pure checks. NO prisma/Node imports here — this file
// is imported by the edge middleware, so it must stay edge-safe.

// The dashboard sections an owner can grant a member access to. Keys are the
// route prefixes; everything under a key is included. The dashboard home
// (/dashboard) is always allowed; /dashboard/members is owner-only (not here).
export const GRANTABLE_ITEMS: { key: string; label: string; group: string }[] = [
  { key: "/dashboard/analytics", label: "Analytics", group: "Overview" },
  { key: "/dashboard/history", label: "Monitoring", group: "Overview" },
  { key: "/dashboard/engagements", label: "Engagements", group: "Engagements" },
  { key: "/dashboard/findings", label: "Findings", group: "Engagements" },
  { key: "/dashboard/pentest", label: "Penetration Testing", group: "Engagements" },
  { key: "/dashboard/forensics", label: "Digital Forensics", group: "Engagements" },
  { key: "/dashboard/consulting", label: "Security Consulting", group: "Engagements" },
  { key: "/dashboard/network", label: "Network Map", group: "Scanning" },
  { key: "/dashboard/wifi", label: "WiFi", group: "Scanning" },
  { key: "/dashboard/runners", label: "Machines", group: "Scanning" },
  { key: "/dashboard/jobs", label: "Jobs", group: "Scanning" },
  { key: "/dashboard/exploit", label: "Exploitation", group: "Scanning" },
  { key: "/dashboard/lab", label: "Exploit Lab", group: "Scanning" },
  { key: "/dashboard/scan", label: "Auto Scan", group: "Scanning" },
  { key: "/dashboard/import", label: "Import (Burp)", group: "Scanning" },
  { key: "/dashboard/assistant", label: "AI Assistant", group: "Knowledge & tools" },
  { key: "/dashboard/knowledge", label: "Knowledge Library", group: "Knowledge & tools" },
  { key: "/dashboard/frameworks", label: "Frameworks", group: "Knowledge & tools" },
  { key: "/dashboard/tools", label: "Tool Catalog", group: "Knowledge & tools" },
  { key: "/dashboard/library", label: "Resource Vault", group: "Knowledge & tools" },
  { key: "/dashboard/shiva", label: "Shiva — MCP Security", group: "Knowledge & tools" },
];

export const GRANTABLE_KEYS = GRANTABLE_ITEMS.map((i) => i.key);

// Always reachable by any signed-in member (the landing/overview + the guide).
const ALWAYS_ALLOWED = ["/dashboard", "/dashboard/guide"];
// Owner-only routes (never grantable to a plain member).
const OWNER_ONLY = ["/dashboard/members", "/dashboard/settings"];

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
