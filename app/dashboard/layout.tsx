import Link from "next/link";
import { auth, signOut } from "@/auth";
import { SidebarNav, type NavGroup } from "@/components/sidebar-nav";
import { MobileNav } from "@/components/mobile-nav";

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
      { href: "/dashboard/pentest", label: "Penetration Testing", icon: "target" },
      { href: "/dashboard/forensics", label: "Digital Forensics", icon: "fingerprint" },
      { href: "/dashboard/consulting", label: "Security Consulting", icon: "shield" },
    ],
  },
  {
    section: "Scanning",
    items: [
      { href: "/dashboard/network", label: "Network Map", icon: "globe" },
      { href: "/dashboard/runners", label: "Runners", icon: "server" },
      { href: "/dashboard/scan", label: "Auto Scan", icon: "radar" },
      { href: "/dashboard/import", label: "Import (Burp)", icon: "copy" },
    ],
  },
  {
    section: "Knowledge & tools",
    items: [
      { href: "/dashboard/assistant", label: "AI Assistant", icon: "bot" },
      { href: "/dashboard/knowledge", label: "Knowledge Library", icon: "book" },
      { href: "/dashboard/tools", label: "Tool Catalog", icon: "wrench" },
      { href: "/dashboard/library", label: "Resource Vault", icon: "lock" },
      { href: "/dashboard/shiva", label: "Shiva — MCP Security", icon: "skull" },
    ],
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

  return (
    <div className="flex h-screen overflow-hidden print:h-auto print:overflow-visible">
      <aside className="hidden h-screen w-64 shrink-0 flex-col border-r border-surface-border bg-surface-card/40 sm:flex print:!hidden">
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
          <SidebarNav groups={NAV} />
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

      <div className="flex h-screen flex-1 flex-col overflow-hidden print:h-auto print:overflow-visible">
        {/* Top header — pinned on every page */}
        <header className="z-10 flex shrink-0 items-center justify-between gap-3 border-b border-surface-border bg-surface/80 px-4 py-3 backdrop-blur sm:px-6 print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <MobileNav groups={NAV} email={user?.email ?? null} />
            {/* Brand on mobile (sidebar shows it on sm+) */}
            <Link href="/dashboard" className="flex items-center gap-2 sm:hidden">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-xs font-black text-black">
                R
              </span>
              <span className="font-mono text-sm font-bold">
                RD<span className="text-brand">-AISEC</span>
              </span>
            </Link>
            <p className="hidden text-sm text-gray-500 sm:block">
              Security operations portal
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="tag ring-emerald accent-emerald hidden sm:inline-flex">
              ● Authorized session
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
              className="sm:hidden"
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
