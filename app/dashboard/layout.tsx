import Link from "next/link";
import { auth, signOut } from "@/auth";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/assistant", label: "AI Assistant" },
  { href: "/dashboard/tools", label: "Tool Catalog" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-surface-border bg-surface-card/40 p-5 sm:flex">
        <Link href="/" className="font-mono text-lg font-bold text-brand">
          RD-AISEC
        </Link>
        <nav className="mt-8 flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-surface-border hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3 pt-6 text-xs text-gray-400">
          {user?.email && <p className="truncate">{user.email}</p>}
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
        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-surface-border px-5 py-3 sm:hidden">
          <Link href="/dashboard" className="font-mono font-bold text-brand">
            RD-AISEC
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="text-xs text-gray-400">
              Sign out
            </button>
          </form>
        </header>
        <main className="px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
