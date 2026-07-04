"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";

/**
 * Tab-style sub-navigation between related pages (e.g. Exploitation ↔ Exploit
 * Lab). Looks like the in-page Tabs strip but navigates by route, so separate
 * pages can present as one tabbed section. Highlights the active route.
 */
export function SubNav({
  items,
}: {
  items: { href: string; label: string; icon?: string }[];
}) {
  const pathname = usePathname();
  return (
    <div className="sticky-under-header mb-5 flex flex-wrap gap-1 border-b border-surface-border bg-surface">
      {items.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
              active
                ? "border-brand bg-white/[0.05] text-white"
                : "border-transparent text-gray-400 hover:bg-white/[0.03] hover:text-gray-200"
            }`}
          >
            {it.icon && <Icon name={it.icon} className="h-4 w-4" />}
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

/** The Exploitation section's tabs (Exploitation ↔ Exploit Lab). */
export const EXPLOIT_TABS = [
  { href: "/dashboard/exploit", label: "Exploitation", icon: "skull" },
  { href: "/dashboard/lab", label: "Exploit Lab", icon: "wrench" },
];
