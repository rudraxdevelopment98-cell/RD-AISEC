"use client";

import { useMemo, useState } from "react";
import { queueJob } from "@/lib/runners";
import { RUNNER_TOOLS } from "@/lib/runner-constants";
import { parseScopeTargets } from "@/lib/bugbounty-core";

type Eng = { id: string; name: string; scope?: string };
type Opt = { id: string; name: string };

export function QueueJobForm({
  engagements,
  runners,
  defaultEngagementId,
}: {
  engagements: Eng[];
  runners: Opt[];
  defaultEngagementId?: string;
}) {
  const [toolId, setToolId] = useState(RUNNER_TOOLS[0].id);
  const [engId, setEngId] = useState(defaultEngagementId ?? engagements[0]?.id ?? "");
  const [target, setTarget] = useState("");

  const presets = useMemo(
    () => RUNNER_TOOLS.find((t) => t.id === toolId)?.presets ?? [],
    [toolId],
  );

  // Targets parsed from the selected engagement's scope.
  const scopeTargets = useMemo(() => {
    const eng = engagements.find((e) => e.id === engId);
    return parseScopeTargets(eng?.scope ?? "");
  }, [engId, engagements]);

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
          value={engId}
          onChange={(e) => setEngId(e.target.value)}
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

        {/* Pick a target from the engagement's scope, or type one. */}
        {scopeTargets.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && setTarget(e.target.value)}
            className="rounded-lg border border-brand/40 bg-surface px-3 py-2 text-sm text-brand outline-none focus:border-brand sm:col-span-2"
          >
            <option value="">📋 Pick a target from this engagement&apos;s scope…</option>
            {scopeTargets.map((t) => (
              <option key={t} value={t} className="text-gray-200">
                {t}
              </option>
            ))}
          </select>
        )}

        <input
          name="target"
          required
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          list="scope-targets"
          placeholder="Target — e.g. scanme.nmap.org or 10.0.0.5"
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
        />
        {scopeTargets.length > 0 && (
          <datalist id="scope-targets">
            {scopeTargets.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        )}

        <button type="submit" className="btn-primary sm:col-span-2">
          Queue job
        </button>
      </form>
    </div>
  );
}
