"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { queueLocalScan } from "@/lib/runners";

type RunnerOpt = { id: string; name: string; subnets: string[]; online: boolean };
type Opt = { id: string; name: string };

export function LocalScanForm({
  runners,
  engagements,
}: {
  runners: RunnerOpt[];
  engagements: Opt[];
}) {
  const [runnerId, setRunnerId] = useState(runners[0]?.id ?? "");
  const subnets = useMemo(
    () => runners.find((r) => r.id === runnerId)?.subnets ?? [],
    [runners, runnerId],
  );

  if (runners.length === 0) {
    return (
      <div className="card text-sm text-gray-400">
        No runner has reported a local network yet. Start a runner (v4+) — it
        detects its own subnet and it&apos;ll appear here for one-click scanning.
      </div>
    );
  }
  if (engagements.length === 0) {
    return (
      <div className="card text-sm text-gray-400">
        Create an engagement and mark it <strong>authorized</strong> to scan a
        runner&apos;s network.
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="font-semibold text-brand">
        <Icon name="globe" className="mr-1 inline h-4 w-4" />
        Scan this runner&apos;s network
      </h2>
      <p className="mt-1 text-sm text-gray-400">
        Scans the local network the selected runner is connected to — no need to
        know the CIDR. Results render as the map below.
      </p>

      <form action={queueLocalScan} className="mt-4 grid gap-3 sm:grid-cols-2">
        <select
          name="runnerId"
          value={runnerId}
          onChange={(e) => setRunnerId(e.target.value)}
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        >
          {runners.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} {r.online ? "● online" : "○ offline"}
            </option>
          ))}
        </select>

        <select
          name="subnet"
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        >
          {subnets.length === 0 ? (
            <option value="">no network detected</option>
          ) : (
            subnets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))
          )}
        </select>

        <select
          name="engagementId"
          defaultValue={engagements[0]?.id}
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        >
          {engagements.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        <select
          name="mode"
          defaultValue="discovery"
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="discovery">Discovery (live hosts — fast)</option>
          <option value="network">Network scan (top ports)</option>
        </select>

        <button
          type="submit"
          disabled={subnets.length === 0}
          className="btn-primary disabled:opacity-50 sm:col-span-2"
        >
          Scan network
        </button>
      </form>
    </div>
  );
}
