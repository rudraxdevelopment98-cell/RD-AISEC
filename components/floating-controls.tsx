"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

/**
 * The global controls (search / theme / menu / sign-out) collapsed behind a
 * single button that sits in the page header's top-right corner. Tapping it
 * makes a pill rubber-band OUT horizontally to reveal the controls (springy
 * over-shoot easing), then snap closed again.
 *
 * The controls are passed as children from the server layout (so the sign-out
 * server action stays server-side). This component owns the float + the
 * expand/collapse. Children stay mounted (the strip just clips to width 0) so
 * the nested search palette / nav drawer keep their state and their portaled
 * popovers survive a collapse.
 */
export function FloatingControls({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
      className="absolute right-3 top-2 z-40 flex items-center justify-end print:hidden"
    >
      {/* Rubber-band strip — grows out to the LEFT of the button. */}
      <div
        className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border bg-surface shadow-lg transition-all duration-500 ${
          open
            ? "mr-1.5 max-w-[78vw] border-surface-border px-2 py-1 opacity-100"
            : "max-w-0 border-transparent px-0 py-0 opacity-0"
        }`}
        style={{ transitionTimingFunction: "cubic-bezier(.34, 1.56, .64, 1)" }}
        onClick={() => setOpen(false)}
      >
        {children}
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close controls" : "Open controls"}
        aria-expanded={open}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-surface-border bg-surface text-gray-200 shadow-lg transition hover:border-brand hover:text-brand"
      >
        <Icon name={open ? "x" : "search"} className="h-5 w-5" />
      </button>
    </div>
  );
}
