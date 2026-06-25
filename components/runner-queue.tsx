"use client";

import { useMemo, useState } from "react";
import { queueJob } from "@/lib/runners";
import { RUNNER_TOOLS } from "@/lib/runner-constants";

type Opt = { id: string; name: string };

export function QueueJobForm({
  engagements,
  runners,
  defaultEngagementId,
}: {
  engagements: Opt[];
  runners: Opt[];
  defaultEngagementId?: string;
}) {
  const [toolId, setToolId] = useState(RUNNER_TOOLS[0].id);
  const presets = useMemo(
    () => RUNNER_TOOLS.find((t) => t.id === toolId)?.presets ?? [],
    [toolId],
  );

  if (runners.length === 0 || engagements.length === 0) {
    return (
      <div className="card mt-6 text-sm text-gray-400">
        {runners.length === 0
          ? "Register a runner above before you can queue a job."
          : "Create an engagement (and mark it authorized) before queuing a job."}
      </div>
    );
  }

  return (
    <div className="card mt-6">
      <h2 className="font-semibold text-brand">▶ Queue a job</h2>
      <p className="mt-1 text-sm text-gray-400">
        The job waits in the queue until the runner polls and executes it. Only
        in-scope targets on an authorized engagement are allowed.
      </p>

      <form action={queueJob} className="mt-4 grid gap-3 sm:grid-cols-2">
        <select
          name="engagementId"
          defaultValue={defaultEngagementId ?? engagements[0]?.id}
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        >
          {engagements.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        <select
          name="runnerId"
          defaultValue={runners[0]?.id}
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        >
          {runners.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        <select
          name="tool"
          value={toolId}
          onChange={(e) => setToolId(e.target.value)}
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        >
          {RUNNER_TOOLS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <select
          name="preset"
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        <input
          name="target"
          required
          placeholder="Target — e.g. scanme.nmap.org or 10.0.0.5"
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
        />

        <button type="submit" className="btn-primary sm:col-span-2">
          Queue job
        </button>
      </form>
    </div>
  );
}
