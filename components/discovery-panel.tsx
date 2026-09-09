"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { discoverPrograms, engageProgram, type DiscoverResult } from "@/lib/integrations";

/**
 * Program discovery — ranks bug-bounty programs (via the owner's HackerOne creds)
 * and lets you create an engagement from one. Suggests only: the engagement is
 * created UNAUTHORIZED, so nothing runs until you record authorization.
 */
export function DiscoveryPanel() {
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<DiscoverResult | null>(null);

  async function run() {
    setLoading(true);
    setRes(null);
    try {
      setRes(await discoverPrograms());
    } catch {
      setRes({ ok: false, error: "The request failed — check your credentials and try again.", programs: [] });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button onClick={run} disabled={loading} className="btn-primary text-sm">
          {loading ? (
            <>
              <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" />
              Scanning programs…
            </>
          ) : (
            <>
              <Icon name="target" className="mr-1 inline h-4 w-4" /> Discover programs
            </>
          )}
        </button>
        {res?.ok && <span className="text-xs text-gray-500">{res.programs.length} ranked</span>}
      </div>

      {res && !res.ok && (
        <p className="mt-3 rounded-lg border border-sev-med/40 bg-sev-med/10 px-3 py-2 text-xs text-sev-med">
          {res.error}
        </p>
      )}

      {res?.ok && res.programs.length > 0 && (
        <div className="mt-4 space-y-2">
          {res.programs.map((p) => (
            <div
              key={p.handle}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-black/20 px-3 py-2.5"
            >
              <ScorePill score={p.score} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-white">{p.name}</span>
                  <a
                    href={`https://hackerone.com/${p.handle}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-gray-500 hover:text-brand"
                  >
                    {p.handle} ↗
                  </a>
                  {!p.eligible && <span className="tag text-[10px] text-sev-med">closed</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {p.reasons.slice(0, 5).map((r, i) => (
                    <span key={i} className="tag text-[10px] text-gray-400">{r}</span>
                  ))}
                </div>
              </div>
              <form action={engageProgram}>
                <input type="hidden" name="handle" value={p.handle} />
                <input type="hidden" name="name" value={p.name} />
                <button type="submit" className="btn-ghost text-xs whitespace-nowrap">
                  Create engagement
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      {res?.ok && res.programs.length === 0 && (
        <p className="mt-3 text-xs text-gray-500">No programs came back for these credentials.</p>
      )}
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const tone =
    score >= 80 ? "text-brand border-brand/50" : score >= 50 ? "text-amber-300 border-amber-400/40" : "text-gray-400 border-surface-border";
  return (
    <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg border ${tone}`}>
      <span className="text-sm font-bold">{score}</span>
    </div>
  );
}
