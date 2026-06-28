"use client";

import { useEffect, useState } from "react";

// Client shell for the right "Live ops" rail: provides the collapsible aside +
// header toggle and remembers the choice (localStorage). The rail's data is a
// server component passed in as `children`, so the toggle never re-fetches —
// it just shows/hides what's already rendered. Wide screens only (xl+).
export function OpsRailShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("opsRailCollapsed") === "1");
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("opsRailCollapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <aside
      className={`relative z-10 hidden h-screen shrink-0 flex-col border-l border-surface-border bg-surface-card/40 transition-[width] duration-200 xl:flex print:!hidden ${
        collapsed ? "w-12" : "w-72"
      }`}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-surface-border px-3 py-3">
        {!collapsed && (
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Live ops
          </p>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand live ops" : "Collapse live ops"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
          className="grid h-6 w-6 place-items-center rounded text-gray-500 hover:bg-white/5 hover:text-brand"
        >
          {collapsed ? "«" : "»"}
        </button>
      </div>
      <div className={`flex-1 overflow-y-auto p-4 ${collapsed ? "hidden" : ""}`}>
        {children}
      </div>
    </aside>
  );
}
