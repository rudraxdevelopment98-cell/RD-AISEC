"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

// A reusable filter dropdown that navigates by updating one URL search param
// (preserving the others), so server pages can stay filter-driven without their
// own client code. Pick the empty option to clear that filter.
export function NavSelect({
  param,
  value,
  options,
  allLabel,
  label,
  className,
}: {
  param: string;
  value?: string;
  options: { value: string; label: string }[];
  allLabel: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    const v = e.target.value;
    if (v) params.set(param, v);
    else params.delete(param);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-gray-400">
      {label && <span className="text-gray-500">{label}</span>}
      <select
        value={value ?? ""}
        onChange={onChange}
        className={`max-w-[12rem] truncate rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-gray-200 outline-none focus:border-brand ${
          className ?? ""
        }`}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
