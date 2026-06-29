"use client";

import { useState } from "react";

/**
 * A liquid-glass collapsible card: a clickable header (title + chevron) that
 * expands/collapses its body. Lets dense pages default to compact so several
 * sections fit on screen at once; click to open the one you need. Keeps the
 * existing `.card` frost — only the open/close behaviour is new.
 */
export function Collapsible({
  title,
  subtitle,
  right,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Optional content shown at the right of the header (e.g. a count badge). */
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card !p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-white/[0.03]"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 font-semibold text-white">
            <svg
              viewBox="0 0 20 20"
              className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M7 5l6 5-6 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="truncate">{title}</span>
          </span>
          {subtitle && (
            <span className="mt-0.5 block pl-6 text-xs font-normal text-gray-500">{subtitle}</span>
          )}
        </span>
        {right && <span className="flex shrink-0 items-center gap-2">{right}</span>}
      </button>
      {open && <div className="border-t border-white/10 px-5 py-4">{children}</div>}
    </div>
  );
}
