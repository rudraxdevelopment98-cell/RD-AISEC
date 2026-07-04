"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

/**
 * Collapsed-by-default top bar. The old always-on global header (search, theme,
 * sign-out, mobile menu) is folded into a single floating button pinned to the
 * top-right corner. Tapping it reveals a compact panel with those controls; the
 * page's own PageHeader is then free to be the thing that sticks to the very top.
 *
 * The actual controls are passed as children from the server layout (so the
 * sign-out server action stays server-side). This component only owns the
 * float + open/close + outside-click-to-dismiss.
 */
export function FloatingControls({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className="absolute right-3 top-3 z-40 flex flex-col items-end gap-2 print:hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close controls" : "Open controls"}
        aria-expanded={open}
        className="grid h-10 w-10 place-items-center rounded-full border border-surface-border bg-surface/80 text-gray-200 shadow-lg backdrop-blur transition hover:border-brand hover:text-brand"
      >
        <Icon name={open ? "x" : "search"} className="h-5 w-5" />
      </button>

      {/* Always mounted (toggled with `hidden`, not unmounted) so the search
          palette / nav drawer nested inside keep their state when the panel
          closes — clicking a trigger opens its portaled popover AND collapses
          this panel in the same click. */}
      <div
        className={`glass-panel w-[min(16rem,calc(100vw-1.5rem))] flex-col gap-2 rounded-xl border border-surface-border p-2.5 shadow-2xl ${open ? "flex" : "hidden"}`}
        onClick={() => setOpen(false)}
      >
        {children}
      </div>
    </div>
  );
}
