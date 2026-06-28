"use client";

import { createContext, useContext, useState } from "react";

/**
 * Lightweight tab strip for grouping a page's sub-sections (ProjectDiscovery-
 * style "Tasks / Issues / Autopilot"). Server-rendered panel content is passed
 * as <TabPanel> children; all panels stay mounted (toggled with `hidden`) so
 * forms keep their state and server data renders once.
 */
const ActiveTab = createContext<string>("");

export function Tabs({
  tabs,
  defaultTab,
  children,
}: {
  tabs: { id: string; label: React.ReactNode }[];
  defaultTab?: string;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id ?? "");
  return (
    <div>
      <div
        role="tablist"
        // Pinned to the top of the scroll area so the tab strip stays visible
        // while a long panel scrolls underneath it.
        className="sticky top-0 z-20 flex flex-nowrap gap-1 overflow-x-auto border-b border-surface-border bg-surface/85 backdrop-blur"
      >
        {tabs.map((t) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(t.id)}
              className={`-mb-px cursor-pointer whitespace-nowrap rounded-t-lg border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
                on
                  ? "border-brand bg-white/[0.05] text-white"
                  : "border-transparent text-gray-400 hover:bg-white/[0.03] hover:text-gray-200"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <ActiveTab.Provider value={active}>
        <div className="mt-4">{children}</div>
      </ActiveTab.Provider>
    </div>
  );
}

export function TabPanel({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const active = useContext(ActiveTab);
  return (
    <div role="tabpanel" hidden={active !== id}>
      {children}
    </div>
  );
}
