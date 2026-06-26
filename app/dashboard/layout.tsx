import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { SidebarNav, type NavGroup } from "@/components/sidebar-nav";
import { MobileNav } from "@/components/mobile-nav";
import { NeuralBg } from "@/components/neural-bg";
import { canAccess } from "@/lib/access";
import { getMemberAccess } from "@/lib/members";

// Full navigation, reorganized by what you're doing: plan work → run offensive
// ops → reference knowledge → admin. Items are filtered per-user by access.
const NAV: NavGroup[] = [
  {
    section: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "grid" },
      { href: "/dashboard/analytics", label: "Analytics", icon: "chart" },
      { href: "/dashboard/history", label: "Monitoring", icon: "clock" },
    ],
  },
  {
    section: "Engagements",
    items: [
      { href: "/dashboard/engagements", label: "Engagements", icon: "briefcase" },
      { href: "/dashboard/findings", label: "Findings", icon: "alert" },
      { href: "/dashboard/bugbounty", label: "Bug Bounty", icon: "target" },
      { href: "/dashboard/pentest", label: "Penetration Testing", icon: "target" },
      { href: "/dashboard/forensics", label: "Digital Forensics", icon: "fingerprint" },
      { href: "/dashboard/consulting", label: "Security Consulting", icon: "shield" },
    ],
  },
  {
    section: "Offensive ops",
    items: [
      { href: "/dashboard/network", label: "Network Map", icon: "globe" },
      { href: "/dashboard/runners", label: "Machines", icon: "server" },
      { href: "/dashboard/jobs", label: "Jobs", icon: "bolt" },
      { href: "/dashboard/exploit", label: "Exploitation", icon: "skull" },
      { href: "/dashboard/scan", label: "Auto Scan", icon: "radar" },
      { href: "/dashboard/import", label: "Import (Burp)", icon: "copy" },
    ],
  },
  {
    section: "Knowledge & tools",
    items: [
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
    items: [{ href: "/dashboard/members", label: "Members", icon: "server" }],
  },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user;
  const initial = (user?.name ?? user?.email ?? "U").charAt(0).toUpperCase();

  // Live access from the database (so an owner's edits apply immediately — no
  // re-login needed). Enforce the current path here, then filter the nav.
  const info = await getMemberAccess(user?.email);
  const pathname = headers().get("x-pathname") ?? "/dashboard";
  if (pathname.startsWith("/dashboard") && !canAccess(pathname, info)) {
    redirect("/dashboard?denied=1");
  }
  const nav = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => canAccess(i.href, info)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex h-screen overflow-hidden print:h-auto print:overflow-visible">
      {/* Liquid-glass backdrop — morphing colour blobs + grid + neural net */}
      <div className="scene print:hidden" aria-hidden>
        <div className="liquid-bg">
          <span className="b1" />
          <span className="b2" />
          <span className="b3" />
        </div>
        <div className="scene-grid" />
        <NeuralBg />
      </div>

      <aside className="relative z-10 hidden h-screen w-64 shrink-0 flex-col border-r border-surface-border bg-surface-card/40 lg:flex print:!hidden">
        {/* Sidebar header — pinned top */}
        <div className="shrink-0 border-b border-surface-border p-4">
          <Link href="/" className="flex items-center gap-2 px-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-black text-black">
              R
            </span>
            <span className="font-mono text-base font-bold">
              RD<span className="text-brand">-AISEC</span>
            </span>
          </Link>
        </div>

        {/* Nav — scrolls if it overflows */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <SidebarNav groups={nav} />
        </div>

        {/* Sidebar footer — pinned bottom */}
        <div className="shrink-0 space-y-3 border-t border-surface-border p-4">
          <div className="flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand/20 text-xs font-bold text-brand">
              {initial}
            </span>
            <span className="truncate text-xs text-gray-400">
              {user?.email ?? "Signed in"}
            </span>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="btn-ghost w-full">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="relative z-10 flex h-screen flex-1 flex-col overflow-hidden print:h-auto print:overflow-visible">
        {/* Top header — pinned on every page */}
        <header className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-surface-border bg-surface/80 px-4 py-3 backdrop-blur sm:px-6 print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <MobileNav groups={nav} email={user?.email ?? null} />
            {/* Brand on mobile (sidebar shows it on sm+) */}
            <Link href="/dashboard" className="flex items-center gap-2 lg:hidden">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-xs font-black text-black">
                R
              </span>
              <span className="font-mono text-sm font-bold">
                RD<span className="text-brand">-AISEC</span>
              </span>
            </Link>
            <p className="hidden text-sm text-gray-500 lg:block">
              Security operations portal
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="tag ring-emerald accent-emerald hidden lg:inline-flex">
              ● Authorized session
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
              className="lg:hidden"
            >
              <button type="submit" className="text-xs text-gray-400">
                Sign out
              </button>
            </form>
          </div>
        </header>
        {/* Scrollable content area */}
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 print:overflow-visible">
          {children}
        </main>
      </div>
    </div>
  );
}
