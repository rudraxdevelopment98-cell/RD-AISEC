"use client";

import { useEffect, useState } from "react";

// Client frame for the left sidebar. It owns the collapse state and exposes it
// as `data-collapsed` on a `group` aside, so the header / nav / footer (passed
// as children, still server-rendered) can react purely in CSS via
// `group-data-[collapsed=true]:*` — no extra client state anywhere else.
// Collapsed = icons only (w-16); expanded = full (w-64). Remembered in
// localStorage. Desktop only (lg+); below lg the mobile nav takes over.
export function SidebarShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebarCollapsed") === "1");
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={`group relative z-10 hidden h-screen shrink-0 flex-col border-r border-surface-border bg-surface-card/40 transition-[width] duration-200 lg:flex print:!hidden ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Collapse toggle — its own thin row so it never overlaps the brand. */}
      <div className="flex shrink-0 items-center justify-end px-3 pt-3 group-data-[collapsed=true]:justify-center">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="grid h-6 w-6 place-items-center rounded text-gray-500 transition hover:bg-white/5 hover:text-brand"
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>
      {children}
    </aside>
  );
}
