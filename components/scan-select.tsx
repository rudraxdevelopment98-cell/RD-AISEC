"use client";

import { useRouter } from "next/navigation";

type Scan = { id: string; target: string; engagement: string; date: string };

/** Compact dropdown to pick which nmap scan the Network map shows. */
export function ScanSelect({ scans, selectedId }: { scans: Scan[]; selectedId?: string }) {
  const router = useRouter();
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <label className="text-xs text-gray-500">Scan:</label>
      <select
        value={selectedId ?? ""}
        onChange={(e) => router.push(`/dashboard/network?job=${e.target.value}`)}
        className="max-w-full flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:max-w-md"
      >
        {scans.map((s) => (
          <option key={s.id} value={s.id}>
            {s.target} — {s.engagement} · {s.date}
          </option>
        ))}
      </select>
      <span className="text-xs text-gray-600">{scans.length} scan{scans.length === 1 ? "" : "s"}</span>
    </div>
  );
}
