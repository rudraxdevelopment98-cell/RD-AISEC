// Shared loading skeleton for dashboard routes. Next.js renders the nearest
// loading.tsx instantly while the server component streams, so navigation feels
// snappy instead of freezing on the previous page. Calm, token-driven, matches
// the card system.

function Bar({ w = "100%", h = "0.85rem" }: { w?: string; h?: string }) {
  return (
    <div
      className="animate-pulse rounded-md bg-surface-border/60"
      style={{ width: w, height: h }}
    />
  );
}

/** A skeleton card matching the .card look. */
export function SkeletonCard() {
  return (
    <div className="card space-y-3">
      <Bar w="40%" h="1rem" />
      <Bar w="90%" />
      <Bar w="75%" />
    </div>
  );
}

/**
 * Generic page skeleton: a header line + a grid of skeleton rows/cards. `rows`
 * controls how many list rows to show.
 */
export function PageSkeleton({ rows = 6, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {title && (
        <div className="space-y-2">
          <Bar w="220px" h="1.4rem" />
          <Bar w="360px" h="0.8rem" />
        </div>
      )}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="card flex items-center gap-4">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-surface-border/60" />
            <div className="flex-1 space-y-2">
              <Bar w={`${70 - (i % 3) * 12}%`} />
              <Bar w={`${45 - (i % 4) * 6}%`} h="0.7rem" />
            </div>
            <div className="h-6 w-16 shrink-0 animate-pulse rounded-full bg-surface-border/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
