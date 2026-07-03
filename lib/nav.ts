// Single source of truth for the dashboard navigation AND the access-control
// catalog. Add a section here once and it automatically (a) appears in the
// sidebar and (b) becomes a grantable access option on the Members page — no
// second list to keep in sync.
//
// Edge-safe: pure data + types only (no prisma/Node imports). This module is
// pulled into lib/access.ts, which is imported by auth.config → edge middleware.

// How a route participates in access control:
//   "grantable" (default) — owners can grant members access to it (a checkbox
//                           on the Members page); off until explicitly ticked.
//   "always"              — reachable by any signed-in member; not a grant
//                           option (the overview/landing + always-on helpers).
//   "owner"               — owner-only; never grantable to a plain member.
export type AccessClass = "grantable" | "always" | "owner";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  access?: AccessClass; // defaults to "grantable"
};

export type NavGroup = { section: string; items: NavItem[] };

// Full navigation, reorganized by what you're doing: plan work → run offensive
// ops → reference knowledge → admin. Items are filtered per-user by access.
export const NAV: NavGroup[] = [
  {
    section: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "grid", access: "always" },
      { href: "/dashboard/guide", label: "How it works", icon: "book", access: "always" },
      { href: "/dashboard/learn", label: "Learn", icon: "book", access: "always" },
    ],
  },
  // The four service lines — what kind of work you're doing. Each is a real
  // workspace over the shared engagement engine below.
  {
    section: "Services",
    items: [
      { href: "/dashboard/bugbounty", label: "Bug Bounty", icon: "target" },
      { href: "/dashboard/pentest", label: "Penetration Testing", icon: "skull" },
      { href: "/dashboard/forensics", label: "Digital Forensics", icon: "fingerprint" },
      { href: "/dashboard/consulting", label: "Security Consulting", icon: "shield" },
    ],
  },
  // The shared engine every service line runs on: cases → findings → exploit.
  {
    section: "Workspace",
    items: [
      { href: "/dashboard/engagements", label: "Engagements", icon: "briefcase" },
      { href: "/dashboard/engagements/map", label: "Engagement Map", icon: "globe" },
      { href: "/dashboard/findings", label: "Findings", icon: "alert" },
      { href: "/dashboard/exploit", label: "Exploitation", icon: "skull" },
      { href: "/dashboard/lab", label: "Exploit Lab", icon: "wrench" },
    ],
  },
  // Running the scans behind the work.
  {
    section: "Scanning",
    items: [
      { href: "/dashboard/jobs", label: "Jobs", icon: "bolt" },
      { href: "/dashboard/scan", label: "Auto Scan", icon: "radar" },
      { href: "/dashboard/network", label: "Network Map", icon: "globe" },
      { href: "/dashboard/wifi", label: "WiFi", icon: "globe" },
      { href: "/dashboard/runners", label: "Machines", icon: "server" },
      { href: "/dashboard/import", label: "Import (Burp)", icon: "copy" },
    ],
  },
  {
    section: "Insights & tools",
    items: [
      { href: "/dashboard/analytics", label: "Analytics", icon: "chart" },
      { href: "/dashboard/history", label: "Monitoring", icon: "clock" },
      { href: "/dashboard/assistant", label: "AI Assistant", icon: "bot" },
      { href: "/dashboard/knowledge", label: "Knowledge Library", icon: "book" },
      { href: "/dashboard/frameworks", label: "Frameworks", icon: "shield" },
      { href: "/dashboard/tools", label: "Tool Catalog", icon: "wrench" },
      { href: "/dashboard/library", label: "Resource Vault", icon: "lock" },
      { href: "/dashboard/shiva", label: "Shiva — MCP Security", icon: "skull" },
    ],
  },
  {
    section: "Admin",
    items: [
      { href: "/dashboard/members", label: "Members", icon: "server", access: "owner" },
      { href: "/dashboard/siem", label: "SIEM · Activity", icon: "clock", access: "owner" },
      { href: "/dashboard/settings", label: "Settings", icon: "wrench", access: "owner" },
    ],
  },
];

// Flattened view with the owning section attached, for access derivation.
export const NAV_ITEMS: (NavItem & { section: string })[] = NAV.flatMap((g) =>
  g.items.map((i) => ({ ...i, section: g.section })),
);

export function accessClass(item: NavItem): AccessClass {
  return item.access ?? "grantable";
}
