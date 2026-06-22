"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { SeverityBadge } from "@/components/badges";
import { saveScanFindings, saveBulkScanFindings } from "@/lib/scan-actions";
import type { ScanResult } from "@/lib/scanner";

type EngagementOption = { id: string; name: string };

function ResultBlock({ result }: { result: ScanResult }) {
  if (result.error) {
    return (
      <div className="card border-l-2 border-l-red-500/60">
        <p className="font-mono text-sm text-white">{result.target}</p>
        <p className="mt-1 text-sm text-red-300">{result.error}</p>
      </div>
    );
  }
  const failed = result.checks.filter((c) => !c.passed);
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-all font-mono text-sm text-white">
          {result.finalUrl ?? result.target}
        </p>
        <span className="shrink-0 text-sm">
          <span className="font-bold text-brand">
            {result.score.passed}/{result.score.total}
          </span>{" "}
          <span className="text-gray-500">passed</span>
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {result.checks.map((c) => (
          <div key={c.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Icon
                  name={c.passed ? "check" : "alert"}
                  className={`h-4 w-4 shrink-0 ${c.passed ? "text-emerald-400" : "text-amber-400"}`}
                />
                <span className="text-sm text-gray-200">{c.name}</span>
              </div>
              <p className="ml-6 break-words text-xs text-gray-500">{c.detail}</p>
              {!c.passed && (
                <p className="ml-6 text-xs text-gray-600">Fix: {c.recommendation}</p>
              )}
            </div>
            {!c.passed && <SeverityBadge value={c.severity} />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Scanner({ engagements }: { engagements: EngagementOption[] }) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [target, setTarget] = useState("");
  const [targets, setTargets] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ScanResult[] | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResults(null);
    const single = mode === "single";
    if (single ? !target.trim() : !targets.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(single ? "/api/scan" : "/api/scan/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(single ? { target } : { targets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Scan failed (${res.status})`);
      setResults(single ? [data as ScanResult] : (data.results as ScanResult[]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  const totalFailed =
    results?.reduce((n, r) => n + r.checks.filter((c) => !c.passed).length, 0) ?? 0;

  return (
    <div className="mt-6">
      {/* Mode toggle */}
      <div className="mb-3 inline-flex rounded-lg border border-surface-border p-1 text-sm">
        {(["single", "bulk"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setResults(null);
              setError(null);
            }}
            className={`rounded-md px-3 py-1 capitalize transition ${
              mode === m ? "bg-brand text-black" : "text-gray-400 hover:text-white"
            }`}
          >
            {m === "single" ? "Single target" : "Bulk"}
          </button>
        ))}
      </div>

      <form onSubmit={run} className="space-y-2">
        {mode === "single" ? (
          <div className="flex gap-2">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="https://target.example.com  (authorized targets only)"
              className="flex-1 rounded-lg border border-surface-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand"
            />
            <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50">
              {loading ? "Scanning…" : "Run scan"}
            </button>
          </div>
        ) : (
          <>
            <textarea
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
              rows={5}
              placeholder={"One target per line (max 10), e.g.\nhttps://app.example.com\nhttps://api.example.com"}
              className="w-full rounded-lg border border-surface-border bg-surface px-4 py-2.5 font-mono text-sm outline-none focus:border-brand"
            />
            <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50">
              {loading ? "Scanning…" : "Scan all"}
            </button>
          </>
        )}
      </form>

      <p className="mt-2 flex items-center gap-2 text-xs text-gray-500">
        <Icon name="lock" className="h-4 w-4" />
        Passive checks (a single GET per target). Only scan systems you are
        authorized to test.
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {results && (
        <div className="mt-6 space-y-3">
          {results.map((r, i) => (
            <ResultBlock key={`${r.target}-${i}`} result={r} />
          ))}

          {/* Save findings */}
          {totalFailed > 0 && engagements.length > 0 && (
            <form
              action={mode === "single" ? saveScanFindings : saveBulkScanFindings}
              className="card flex flex-wrap items-center gap-3"
            >
              {mode === "single" ? (
                <input type="hidden" name="target" value={results[0]?.target ?? ""} />
              ) : (
                <input type="hidden" name="targets" value={targets} />
              )}
              <span className="text-sm text-gray-300">
                Save {totalFailed} issue{totalFailed === 1 ? "" : "s"} as findings to:
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
          {totalFailed > 0 && engagements.length === 0 && (
            <p className="text-xs text-gray-500">
              Create an engagement to save these findings into it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
