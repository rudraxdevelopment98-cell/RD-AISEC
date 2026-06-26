"use client";

import { useState } from "react";

/**
 * A small "?" help button that toggles an inline tip. Use next to a heading or
 * field label: <Hint>Explain what this does.</Hint>
 */
export function Hint({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Help"
        aria-expanded={open}
        className="grid h-4 w-4 place-items-center rounded-full border border-brand/50 text-[10px] font-bold text-brand transition hover:bg-brand/10"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="glass-panel absolute left-1/2 top-6 z-40 w-64 -translate-x-1/2 rounded-lg border border-surface-border px-3 py-2 text-left text-xs font-normal leading-relaxed text-gray-300 shadow-xl"
        >
          {children}
        </span>
      )}
    </span>
  );
}

/**
 * A dismissible "How to use this" banner for the top of a page.
 */
export function HelpBanner({
  title = "How to use this",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline"
      >
        <span className="grid h-4 w-4 place-items-center rounded-full border border-brand/50 text-[10px] font-bold">
          ?
        </span>
        Show help
      </button>
    );
  }
  return (
    <div className="mt-4 rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm text-gray-300">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-brand-glow">{title}</p>
        <button
          onClick={() => setOpen(false)}
          aria-label="Dismiss help"
          className="text-gray-500 hover:text-white"
        >
          ✕
        </button>
      </div>
      <div className="mt-1.5 space-y-1 text-xs leading-relaxed text-gray-400">{children}</div>
    </div>
  );
}
