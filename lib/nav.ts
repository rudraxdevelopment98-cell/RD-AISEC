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

export type NavGroup = { section: string; icon: string; items: NavItem[] };

// Full navigation, reorganized by how you actually work: overview → the four
// disciplines → the shared engine that does the work → the infrastructure it
// runs on → wireless → intelligence → reference → admin. Every route keeps its
// href (access grants + middleware are href-based), only the grouping, labels
// and icons are reworked. Items are filtered per-user by access.
export const NAV: NavGroup[] = [
  // Land here — the at-a-glance across everything.
  {
    section: "Home",
    icon: "grid",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "grid", access: "always" },
    ],
  },
  // The four disciplines — what kind of work you're doing. Each is a workspace
  // over the shared engine below.
  {
    section: "Disciplines",
    icon: "shield",
    items: [
      { href: "/dashboard/bugbounty", label: "Bug Bounty", icon: "bug" },
      { href: "/dashboard/pentest", label: "Pentest", icon: "target" },
      { href: "/dashboard/forensics", label: "Forensics", icon: "fingerprint" },
      { href: "/dashboard/consulting", label: "Consulting", icon: "shield" },
    ],
  },
  // The shared engine every discipline runs on: score → cases → findings →
  // exploit. (Exploit Lab lives as a tab inside Exploitation.)
  {
    section: "Engine",
    icon: "engine",
    items: [
      { href: "/dashboard/engine", label: "Command Center", icon: "engine", access: "always" },
      { href: "/dashboard/engagements", label: "Engagements", icon: "briefcase" },
      { href: "/dashboard/engagements/map", label: "Engagement Map", icon: "globe" },
      { href: "/dashboard/findings", label: "Findings", icon: "alert" },
      // Exploitation + Exploit Lab are one tabbed section (see EXPLOIT_TABS); Lab
      // is reached from the Exploitation page's tabs, so it's not a separate nav
      // item. Its access rides on the Exploitation grant (see lib/access.ts).
      { href: "/dashboard/exploit", label: "Exploitation", icon: "exploit" },
    ],
  },
  // The machines and tools that feed the engine.
  {
    section: "Infrastructure",
    icon: "server",
    items: [
      { href: "/dashboard/runners", label: "Machines", icon: "server" },
      { href: "/dashboard/jobs", label: "Jobs & Queue", icon: "bolt" },
      { href: "/dashboard/scan", label: "Auto Scan", icon: "radar" },
      { href: "/dashboard/network", label: "Network Map", icon: "network" },
      { href: "/dashboard/import", label: "Import", icon: "copy" },
    ],
  },
  // Everything wireless, in one place.
  {
    section: "Wireless",
    icon: "wifi",
    items: [
      { href: "/dashboard/wifi", label: "WiFi Attacks", icon: "wifi" },
      { href: "/dashboard/sensing", label: "Sensing (AirSight)", icon: "sensing" },
    ],
  },
  // Observe, measure, and get help — everything you look AT rather than run.
  {
    section: "Intelligence",
    icon: "chart",
    items: [
      { href: "/dashboard/analytics", label: "Analytics", icon: "chart" },
      { href: "/dashboard/history", label: "Monitoring", icon: "clock" },
      { href: "/dashboard/siem", label: "Activity & SIEM", icon: "activity", access: "owner" },
      { href: "/dashboard/assistant", label: "AI Assistant", icon: "bot" },
      { href: "/dashboard/shiva", label: "Shiva — MCP", icon: "eye" },
    ],
  },
  // Learn + reference, all in one place.
  {
    section: "Library",
    icon: "book",
    items: [
      { href: "/dashboard/guide", label: "How it works", icon: "book", access: "always" },
      { href: "/dashboard/learn", label: "Learn", icon: "book", access: "always" },
      { href: "/dashboard/knowledge", label: "Knowledge", icon: "book" },
      { href: "/dashboard/frameworks", label: "Frameworks", icon: "shield" },
      { href: "/dashboard/tools", label: "Tool Catalog", icon: "wrench" },
      { href: "/dashboard/library", label: "Resource Vault", icon: "lock" },
    ],
  },
  // Manage the portal.
  {
    section: "Admin",
    icon: "lock",
    items: [
      { href: "/dashboard/members", label: "Members", icon: "users", access: "owner" },
      { href: "/dashboard/settings", label: "Settings", icon: "wrench", access: "owner" },
      { href: "/dashboard/progress", label: "Build Progress", icon: "chart", access: "always" },
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
