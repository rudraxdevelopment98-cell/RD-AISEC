"use client";

import { useEffect, useState } from "react";

// Client frame for the right "Live ops" rail. Mirrors the left sidebar's
// structure — a fixed-height header and a footer of the same sizes — and is
// collapsible (remembered in localStorage). The rail's data is a server
// component passed in as `children`. Wide screens only (xl+).
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
      {/* Header — same fixed height as the left rail's brand header. */}
      <div className="flex h-[4.5rem] shrink-0 items-center justify-between border-b border-surface-border px-4">
        {!collapsed && (
          <div className="leading-tight">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Live ops
            </p>
            <p className="text-[10px] text-gray-600">team · machines · findings</p>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand live ops" : "Collapse live ops"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
          className={`grid h-6 w-6 place-items-center rounded text-gray-500 transition hover:bg-white/5 hover:text-brand ${
            collapsed ? "mx-auto" : ""
          }`}
        >
          {collapsed ? "«" : "»"}
        </button>
      </div>

      <div className={`flex-1 overflow-y-auto p-4 ${collapsed ? "hidden" : ""}`}>
        {children}
      </div>

      {/* Footer — mirrors the left rail footer (border-t, same padding). */}
      {!collapsed && (
        <div className="shrink-0 border-t border-surface-border px-4 py-3 text-[10px] text-gray-600">
          <p className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            online now · refreshes on reload
          </p>
        </div>
      )}
    </aside>
  );
}
