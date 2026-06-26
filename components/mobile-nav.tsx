"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { SidebarNav, type NavGroup } from "@/components/sidebar-nav";

/**
 * Mobile navigation: a hamburger button that opens a slide-in drawer with the
 * full sidebar nav. Hidden on sm+ (the static sidebar takes over there). The
 * drawer auto-closes on navigation and on overlay tap.
 */
export function MobileNav({
  groups,
  email,
}: {
  groups: NavGroup[];
  email: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  // Portals need the DOM — only render the drawer after mount (avoids SSR error).
  useEffect(() => setMounted(true), []);

  // Close when the route changes (i.e. a nav link was tapped).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="grid h-9 w-9 place-items-center rounded-lg border border-surface-border text-gray-300 hover:border-brand"
      >
        <Icon name="menu" className="h-5 w-5" />
      </button>

      {open &&
        mounted &&
        createPortal(
          // Rendered into <body> so the header's backdrop-blur (a containing
          // block for fixed elements) can't clip the drawer to the header bar.
          <div className="fixed inset-0 z-[100] lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="glass-panel absolute left-0 top-0 flex h-full w-72 max-w-[82%] flex-col border-r border-surface-border">
            <div className="flex shrink-0 items-center justify-between border-b border-surface-border p-4">
              <Link href="/dashboard" className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-black text-black">
                  R
                </span>
                <span className="font-mono text-base font-bold">
                  RD<span className="text-brand">-AISEC</span>
                </span>
              </Link>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 hover:text-white"
              >
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-6">
              <SidebarNav groups={groups} />
            </div>

            {email && (
              <div className="shrink-0 border-t border-surface-border p-4">
                <div className="flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-brand/20 text-xs font-bold text-brand">
                    {email.charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate text-xs text-gray-400">{email}</span>
                </div>
              </div>
            )}
          </aside>
          </div>,
          document.body,
        )}
    </div>
  );
}
