import Link from "next/link";
import { Icon } from "@/components/icons";

/** Consistent empty-state card with guidance and an optional primary action. */
export function EmptyState({
  icon = "alert",
  title,
  children,
  actionHref,
  actionLabel,
}: {
  icon?: string;
  title: string;
  children?: React.ReactNode;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl border border-surface-border text-brand">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="mt-1 font-semibold text-white">{title}</p>
      {children && <p className="max-w-sm text-sm text-gray-500">{children}</p>}
      {actionHref && actionLabel && (
        <Link href={actionHref} className="btn-primary mt-2 text-sm">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
