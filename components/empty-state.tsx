import Link from "next/link";
import { Icon } from "@/components/icons";

/**
 * Friendly, illustrated empty-state card — a glowing emerald medallion, a clear
 * title + guidance, and up to two actions. Used across list pages so "nothing
 * here yet" feels inviting, not broken. Backward-compatible API + optional
 * secondary link.
 */
export function EmptyState({
  icon = "alert",
  title,
  children,
  actionHref,
  actionLabel,
  secondaryHref,
  secondaryLabel,
}: {
  icon?: string;
  title: string;
  children?: React.ReactNode;
  actionHref?: string;
  actionLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="card card-glow flex flex-col items-center gap-3 py-12 text-center fade-up">
      {/* Illustrated medallion — concentric emerald rings + glow behind the icon. */}
      <div className="relative grid h-20 w-20 place-items-center">
        <span className="absolute inset-0 rounded-full border border-brand/15" />
        <span className="absolute inset-2 rounded-full border border-brand/20" />
        <span className="absolute inset-0 rounded-full bg-brand/10 blur-xl" aria-hidden />
        <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-glow/90 via-brand to-brand-dark text-[#04140d] shadow-[0_8px_24px_-8px_rgba(52,211,153,0.6)]">
          <Icon name={icon} className="h-6 w-6" />
        </span>
      </div>
      <p className="mt-1 text-base font-semibold text-white">{title}</p>
      {children && <p className="max-w-sm text-sm leading-relaxed text-gray-500">{children}</p>}
      {(actionHref && actionLabel) || (secondaryHref && secondaryLabel) ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {actionHref && actionLabel && (
            <Link href={actionHref} className="btn-primary text-sm">
              {actionLabel}
            </Link>
          )}
          {secondaryHref && secondaryLabel && (
            <Link href={secondaryHref} className="btn-ghost text-sm">
              {secondaryLabel}
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
