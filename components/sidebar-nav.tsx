"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";

export type NavItem = { href: string; label: string; icon: string };
export type NavGroup = { section: string; items: NavItem[] };

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="mt-3 flex flex-col gap-0.5">
      {groups.map((group, gi) => (
        <div
          key={group.section}
          // Separator + spacing between groups (visible collapsed or expanded);
          // the first group has no divider above it.
          className={gi > 0 ? "mt-2 border-t border-surface-border/60 pt-2" : ""}
        >
          <p className="nav-section group-data-[collapsed=true]:hidden">{group.section}</p>
          {/* Collapsed: a little breathing room where the section label was. */}
          {gi === 0 && <div className="hidden h-1 group-data-[collapsed=true]:block" />}
          {group.items.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`nav-link group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-0 ${
                  active ? "nav-link-active" : ""
                }`}
              >
                {/* Inactive icons are brand-green; the active item goes white
                    (inherits the link colour). */}
                <Icon
                  name={item.icon}
                  className={`h-4 w-4 shrink-0 ${active ? "" : "text-brand"}`}
                />
                <span className="truncate group-data-[collapsed=true]:hidden">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
