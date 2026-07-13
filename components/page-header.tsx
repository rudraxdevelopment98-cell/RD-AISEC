import type { ReactNode } from "react";

/**
 * Sticky page header. ONLY the compact title row (title + primary actions) pins
 * to the very top for the whole page scroll — the descriptive subtitle and any
 * ribbon scroll away beneath it, so the pinned bar stays a thin, single line.
 *
 * Returned as a fragment (no wrapper) on purpose: the sticky bar must be a
 * direct child of the tall page container so it stays pinned for the entire
 * scroll, not just while a short wrapper is on screen.
 *
 * Opaque (no backdrop-blur) so scrolling stays smooth. The right padding leaves
 * room for the floating controls button that sits in the header's top-right.
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
  /** Ribbon/content shown under the title — scrolls away with the subtitle. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <>
      <div
        className={`sticky top-0 z-30 -mx-4 flex h-[var(--app-header-h)] items-center justify-between gap-3 border-b border-surface-border bg-surface px-4 pr-14 sm:-mx-6 sm:px-6 sm:pr-16 ${className}`}
      >
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{title}</h1>
        {actions && (
          <div className="flex shrink-0 items-center justify-end gap-2">{actions}</div>
        )}
      </div>

      {(subtitle || children) && (
        <div className="mt-3">
          {subtitle && <div className="text-sm text-gray-400">{subtitle}</div>}
          {children}
        </div>
      )}
    </>
  );
}
