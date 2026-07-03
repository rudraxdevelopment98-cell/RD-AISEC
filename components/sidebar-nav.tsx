"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

export type NavItem = { href: string; label: string; icon: string };
export type NavGroup = { section: string; icon: string; items: NavItem[] };

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  // Only the MOST SPECIFIC matching item is active (a child route like
  // /dashboard/engagements/map must not also light up /dashboard/engagements).
  const matches = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(href + "/");
  const activeHref = groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  const activeSection = groups.find((g) => g.items.some((i) => i.href === activeHref))?.section;

  // Single-open accordion: only ONE group is expanded at a time, so the sidebar
  // stays a short list of groups. Navigating to a page opens that page's group
  // (and closes the previous one). Manual toggle wins until the next navigation.
  const [open, setOpen] = useState<string | null>(activeSection ?? null);
  useEffect(() => {
    if (activeSection) setOpen(activeSection);
  }, [activeSection]);
  const toggle = (section: string) => setOpen((cur) => (cur === section ? null : section));

  return (
    <nav className="mt-3 flex flex-col gap-0.5">
      {groups.map((group) => {
        // Single-item groups (Home) render the page directly — no accordion.
        if (group.items.length === 1) {
          const item = group.items[0];
          const active = item.href === activeHref;
          return (
            <Link
              key={group.section}
              href={item.href}
              title={item.label}
              className={`nav-link group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-0 ${active ? "nav-link-active" : ""}`}
            >
              <Icon name={item.icon} className={`h-4 w-4 shrink-0 ${active ? "" : "text-white"}`} />
              <span className="truncate group-data-[collapsed=true]:hidden">{item.label}</span>
            </Link>
          );
        }

        const isOpen = open === group.section;
        const inGroup = group.section === activeSection;
        return (
          <div key={group.section} className="mt-0.5">
            {/* Group header — icon + name + chevron; click to expand/collapse. */}
            <button
              type="button"
              onClick={() => toggle(group.section)}
              aria-expanded={isOpen}
              title={group.section}
              className={`nav-link w-full group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-0 ${
                inGroup ? "text-brand" : "font-medium"
              }`}
            >
              <Icon name={group.icon} className={`h-4 w-4 shrink-0 ${inGroup ? "" : "text-gray-300"}`} />
              <span className="truncate group-data-[collapsed=true]:hidden">{group.section}</span>
              {inGroup && !isOpen && (
                <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand group-data-[collapsed=true]:hidden" />
              )}
              <Icon
                name="arrow"
                className={`ml-auto h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform group-data-[collapsed=true]:hidden ${isOpen ? "rotate-90" : ""}`}
              />
            </button>

            {/* Pages — shown when the group is expanded. */}
            {isOpen && (
              <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-surface-border pl-2 group-data-[collapsed=true]:ml-0 group-data-[collapsed=true]:border-0 group-data-[collapsed=true]:pl-0">
                {group.items.map((item) => {
                  const active = item.href === activeHref;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={item.label}
                      className={`nav-link py-1.5 text-sm group-data-[collapsed=true]:justify-center group-data-[collapsed=true]:px-0 ${active ? "nav-link-active" : ""}`}
                    >
                      <Icon name={item.icon} className={`h-4 w-4 shrink-0 ${active ? "" : "text-white"}`} />
                      <span className="truncate group-data-[collapsed=true]:hidden">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
