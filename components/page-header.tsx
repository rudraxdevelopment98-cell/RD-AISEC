import type { ReactNode } from "react";

/**
 * Sticky page title bar. Pins to the top of the scrolling content area, just
 * under the always-pinned global app header, so the page's title + primary
 * actions stay visible while the body scrolls.
 *
 * Full-bleed: the negative horizontal margins cancel <main>'s px-4/sm:px-6 so
 * the frosted bar spans edge to edge and the blur reads as a real header band
 * rather than a floating card. z-30 keeps it above sticky sub-tab strips (z-20)
 * and page content.
 *
 * Not a horizontal scroll container (unlike the old tab strip) — an element
 * that scrolls in X fails to stick in WebKit; this one only ever sticks.
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
  /** Extra content rendered beneath the title row (filters, breadcrumbs, tabs). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`sticky top-0 z-30 -mx-4 mb-5 border-b border-surface-border bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 ${className}`}
    >
      {/* pr-12 keeps right-aligned actions clear of the floating controls button
          that lives in the content column's top-right corner. */}
      <div className="flex flex-wrap items-start justify-between gap-3 pr-12">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-gray-400">{subtitle}</div>}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}
