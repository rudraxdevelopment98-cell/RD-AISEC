import Link from "next/link";
import { auth, signOut } from "@/auth";
import { SidebarNav, type NavGroup } from "@/components/sidebar-nav";

const NAV: NavGroup[] = [
  {
    section: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "grid" }],
  },
  {
    section: "Pillars",
    items: [
      { href: "/dashboard/pentest", label: "Penetration Testing", icon: "target" },
      { href: "/dashboard/forensics", label: "Digital Forensics", icon: "fingerprint" },
      { href: "/dashboard/consulting", label: "Security Consulting", icon: "briefcase" },
    ],
  },
  {
    section: "Resources",
    items: [
      { href: "/dashboard/assistant", label: "AI Assistant", icon: "bot" },
      { href: "/dashboard/tools", label: "Tool Catalog", icon: "wrench" },
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
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-surface-border bg-surface-card/40 p-4 sm:flex">
        <Link href="/" className="flex items-center gap-2 px-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-black text-black">
            R
          </span>
          <span className="font-mono text-base font-bold">
            RD<span className="text-brand">-AISEC</span>
          </span>
        </Link>

        <SidebarNav groups={NAV} />

        <div className="mt-auto space-y-3 pt-6">
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

      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-surface-border px-6 py-3">
          <p className="text-sm text-gray-500">
            Security operations portal
          </p>
          <div className="flex items-center gap-3">
            <span className="tag ring-emerald accent-emerald">● Authorized session</span>
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
        <main className="px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
