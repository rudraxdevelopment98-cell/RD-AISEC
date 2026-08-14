"use client";

import { useState, type ReactNode } from "react";

/**
 * Sticky page header. ONLY the compact title row (title + primary actions) pins
 * to the very top for the whole page scroll.
 *
 * The descriptive subtitle is HIDDEN by default behind a small "?" toggle next to
 * the title — page descriptions aren't important to see every time, so the default
 * view stays clean and one click reveals the "what is this" text when wanted. Any
 * `children` ribbon still renders inline (it's usually interactive, not prose).
 *
 * Client component so the toggle works, but it only renders the props it's given —
 * server pages import { PageHeader } exactly as before, and server-action forms
 * passed via `actions`/`children` pass straight through.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Ribbon/content shown under the title — always visible (usually interactive). */
  children?: ReactNode;
  className?: string;
}) {
  const [showSub, setShowSub] = useState(false);
  return (
    <>
      <div
        className={`sticky top-0 z-30 -mx-4 flex h-[var(--app-header-h)] items-center justify-between gap-3 border-b border-surface-border bg-surface px-4 pr-14 sm:-mx-6 sm:px-6 sm:pr-16 ${className}`}
      >
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="truncate">{title}</span>
          {subtitle && (
            <button
              type="button"
              onClick={() => setShowSub((s) => !s)}
              aria-label="About this page"
              aria-expanded={showSub}
              className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-brand/50 text-[10px] font-bold text-brand transition hover:bg-brand/10"
            >
              ?
            </button>
          )}
        </h1>
        {actions && (
          <div className="flex shrink-0 items-center justify-end gap-2">{actions}</div>
        )}
      </div>

      {(showSub || children) && (
        <div className="mt-3">
          {subtitle && showSub && <div className="text-sm text-gray-400">{subtitle}</div>}
          {children}
        </div>
      )}
    </>
  );
}
