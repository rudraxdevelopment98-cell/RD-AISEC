"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { SeverityBadge } from "@/components/badges";
import { saveScanFindings } from "@/lib/scan-actions";
import type { ScanResult } from "@/lib/scanner";

type EngagementOption = { id: string; name: string };

export function Scanner({ engagements }: { engagements: EngagementOption[] }) {
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Scan failed (${res.status})`);
      setResult(data as ScanResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  const failed = result?.checks.filter((c) => !c.passed) ?? [];

  return (
    <div className="mt-6">
      <form onSubmit={scan} className="flex gap-2">
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="https://target.example.com  (authorized targets only)"
          className="flex-1 rounded-lg border border-surface-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
        <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50">
          {loading ? "Scanning…" : "Run scan"}
        </button>
      </form>
      <p className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        <Icon name="lock" className="h-4 w-4" />
        Passive check (a single GET). Only scan systems you are authorized to test.
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {result && !result.error && (
        <div className="mt-6 space-y-4">
          {/* Summary */}
          <div className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-gray-400">Scanned</p>
              <p className="font-mono text-sm text-white">{result.finalUrl ?? result.target}</p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-brand">
                {result.score.passed}/{result.score.total}
              </p>
              <p className="text-xs text-gray-500">checks passed</p>
            </div>
          </div>

          {/* Checks */}
          <div className="space-y-2">
            {result.checks.map((c) => (
              <div
                key={c.id}
                className={`card flex items-start justify-between gap-3 ${
                  c.passed ? "" : "border-l-2 border-l-amber-500/60"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon
                      name={c.passed ? "check" : "alert"}
                      className={`h-4 w-4 shrink-0 ${c.passed ? "text-emerald-400" : "text-amber-400"}`}
                    />
                    <h3 className="font-medium text-white">{c.name}</h3>
                  </div>
                  <p className="mt-1 break-words text-sm text-gray-400">{c.detail}</p>
                  {!c.passed && (
                    <p className="mt-1 text-xs text-gray-500">Fix: {c.recommendation}</p>
                  )}
                </div>
                {!c.passed && <SeverityBadge value={c.severity} />}
              </div>
            ))}
          </div>

          {/* Save to engagement */}
          {failed.length > 0 && engagements.length > 0 && (
            <form action={saveScanFindings} className="card flex flex-wrap items-center gap-3">
              <input type="hidden" name="target" value={result.target} />
              <span className="text-sm text-gray-300">
                Save {failed.length} issue{failed.length === 1 ? "" : "s"} as findings to:
              </span>
              <select
                name="engagementId"
                required
                className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
              >
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary">
                <Icon name="briefcase" className="h-4 w-4" /> Save findings
              </button>
            </form>
          )}
          {failed.length > 0 && engagements.length === 0 && (
            <p className="text-xs text-gray-500">
              Create an engagement to save these findings into it.
            </p>
          )}
        </div>
      )}

      {result?.error && (
        <p className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {result.error}
        </p>
      )}
    </div>
  );
}
