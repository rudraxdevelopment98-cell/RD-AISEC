import type { ReactNode } from "react";

/**
 * Console layout — the app's arrangement primitive (the "calm console").
 *
 * A slim left context/status rail beside a wide main work column. The rail holds
 * status, key facts and primary actions; the main column holds the actual work in
 * a few large sections. Stacks to one column below `lg`; the rail sticks under the
 * page header on wide screens. Use on every page for a consistent interior.
 */
export function Console({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="console-grid">
      <aside className="console-rail space-y-5">{rail}</aside>
      <div className="min-w-0 space-y-8">{children}</div>
    </div>
  );
}

/** A titled rail panel (card with an eyebrow heading). */
export function RailPanel({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      {title && <p className="eyebrow mb-3">{title}</p>}
      {children}
    </div>
  );
}
