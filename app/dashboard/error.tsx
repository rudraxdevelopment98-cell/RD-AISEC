"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Dashboard error boundary. A single client/render error used to white-screen the
 * whole app ("a client-side exception has occurred"); now it degrades gracefully
 * — the sidebar stays, and you get the message + a one-click retry.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it in the console for debugging.
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="mx-auto mt-10 max-w-lg">
      <div className="card border-sev-crit/30">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-sev-crit/15 text-sev-crit">⚠</span>
          <div>
            <h1 className="text-lg font-semibold text-white">Something went wrong on this page</h1>
            <p className="text-xs text-gray-500">The rest of the portal is fine — this section hit an error.</p>
          </div>
        </div>

        {error?.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg border border-surface-border bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-sev-crit/90">
            {error.message}
          </pre>
        )}
        {error?.digest && (
          <p className="mt-2 text-[11px] text-gray-600">Reference: {error.digest}</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={reset} className="btn-primary text-sm">Try again</button>
          <Link href="/dashboard" className="btn-ghost text-sm">Go to dashboard</Link>
        </div>
      </div>
    </div>
  );
}
