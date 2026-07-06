import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarShell } from "@/components/sidebar-shell";
import { MobileNav } from "@/components/mobile-nav";
import { NeuralBg } from "@/components/neural-bg";
import { CommandPalette } from "@/components/command-palette";
import { OpsRail } from "@/components/ops-rail";
import { OpsRailShell } from "@/components/ops-rail-shell";
import { canAccess } from "@/lib/access";
import { NAV } from "@/lib/nav";
import { getMemberAccess } from "@/lib/members";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { AutoscanFab } from "@/components/autoscan-fab";
import { VoiceCommandCenter } from "@/components/voice-command-center";
import { ThemeToggle } from "@/components/theme-toggle";
import { FloatingControls } from "@/components/floating-controls";
import { ActivityBar } from "@/components/activity-bar";

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

  // Global autoscan launcher data (only when the user can queue jobs).
  const canQueue = canAccess("/dashboard/jobs", info);
  const [fabRunners, fabEngagements] = canQueue
    ? await Promise.all([
        prisma.runner.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true }, take: 20 }),
        prisma.engagement.findMany({ where: { authorized: true }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true }, take: 30 }),
      ])
    : [[], []];
  const navLinks = nav.flatMap((g) =>
    g.items.map((i) => ({ label: i.label, href: i.href, section: g.section })),
  );

  return (
    <div className="app-dashboard flex h-screen overflow-hidden print:h-auto print:overflow-visible">
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

      <SidebarShell>
        {/* Sidebar header — brand, centered (text hides when collapsed) */}
        <div className="flex h-[4.5rem] shrink-0 flex-col items-center justify-center gap-1 border-b border-surface-border px-4 text-center group-data-[collapsed=true]:px-2">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-black text-black">
              R
            </span>
            <span className="font-mono text-base font-bold group-data-[collapsed=true]:hidden">
              RD<span className="text-brand">-AISEC</span>
            </span>
          </Link>
          <p className="text-[10px] leading-tight text-gray-600 group-data-[collapsed=true]:hidden">
            AI Security Operating System — by{" "}
            <span className="text-gray-400">Kuldeep J</span>
          </p>
        </div>

        {/* Nav — scrolls if it overflows */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 group-data-[collapsed=true]:px-2">
          <SidebarNav groups={nav} />
        </div>

        {/* Sidebar footer — pinned bottom */}
        <div className="shrink-0 space-y-3 border-t border-surface-border p-4 group-data-[collapsed=true]:px-2">
          <div className="flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:border-0 group-data-[collapsed=true]:px-0">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/20 text-xs font-bold text-brand">
              {initial}
            </span>
            <span className="truncate text-xs text-gray-400 group-data-[collapsed=true]:hidden">
              {user?.email ?? "Signed in"}
            </span>
          </div>
          <form
            action={async () => {
              "use server";
              await logAudit({ type: "auth.logout", actor: user?.email, summary: "Signed out" });
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              title="Sign out"
              className="btn-ghost flex w-full items-center justify-center gap-2"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4 shrink-0"
                aria-hidden
              >
                <path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              </svg>
              <span className="group-data-[collapsed=true]:hidden">Sign out</span>
            </button>
          </form>
        </div>
      </SidebarShell>

      <div className="relative z-10 flex h-screen flex-1 flex-col overflow-hidden print:h-auto print:overflow-visible">
        {/* The old always-on top header is gone — its search / theme / menu /
            sign-out now live behind a single floating button (FloatingControls,
            mounted below), so each page's own PageHeader owns the very top. */}
        {/* Scrollable content area — the center canvas. No per-navigation remount
            or entrance animation: navigation is instant (the keyed fade-up made
            pages feel like they were reloading). Subtle list motion stays via
            `.stagger-in` on specific lists. */}
        {/* No TOP padding: a scroll container's padding-top offsets where
            `position: sticky; top-0` children pin (mobile Safari especially),
            leaving a gap band above the stuck header/tab-bar that content bleeds
            through. Padding lives on the sides + bottom only; the sticky
            PageHeader / tab strip now hug the global header flush. Pages add
            their own breathing room via the PageHeader (or a top card). */}
        <main className="flex-1 overflow-y-auto px-4 pb-8 sm:px-6 print:overflow-visible">
          {children}
        </main>

        {/* Collapsed global controls — search / theme / menu / sign-out folded
            behind one floating button, anchored to the content column's top-
            right so it clears the sidebar + ops-rail on wide screens. */}
        <FloatingControls>
          <CommandPalette links={navLinks} />
          <MobileNav groups={nav} email={user?.email ?? null} />
          <ThemeToggle />
          <form
            action={async () => {
              "use server";
              await logAudit({ type: "auth.logout", actor: user?.email, summary: "Signed out" });
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="btn-ghost shrink-0 whitespace-nowrap px-3 py-1.5 text-xs">
              Sign out
            </button>
          </form>
        </FloatingControls>

        {/* Footer status line — live processing / machine monitor. */}
        <ActivityBar />
      </div>

      {/* Right rail — live ops (machines · jobs · findings). Collapsible; wide
          screens only, so the center canvas keeps full width below xl. */}
      <OpsRailShell>
        <OpsRail info={info} />
      </OpsRailShell>

      {/* Global floating autoscan launcher — reachable from every page. */}
      {canQueue && <AutoscanFab runners={fabRunners} engagements={fabEngagements} />}

      {/* Hands-free voice control (browser-native, no external service). */}
      <VoiceCommandCenter links={navLinks} />
    </div>
  );
}
