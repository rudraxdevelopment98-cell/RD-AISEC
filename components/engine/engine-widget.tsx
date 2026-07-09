import Link from "next/link";
import type { Tier } from "@/lib/engine/risk-core";

export type EngineWidgetData = {
  summary: { tiers: Record<Tier, number>; index: number; kev: number; confirmed: number; total: number };
  top: { id: string; title: string; tier: Tier; score: number; asset: string; knownExploited: boolean }[];
};

const TIER_TONE: Record<Tier, string> = {
  P1: "text-red-300 border-red-500/50 bg-red-500/15",
  P2: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  P3: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  P4: "text-sky-300 border-sky-500/40 bg-sky-500/10",
};

/** Compact engine risk-posture card for the dashboard. Server component. */
export function EngineWidget({ data }: { data: EngineWidgetData }) {
  const { summary: s } = data;
  const tone = s.index >= 75 ? "#ef4444" : s.index >= 50 ? "#f59e0b" : s.index >= 25 ? "#38bdf8" : "#34d399";

  return (
    <section className="card fade-up border-brand/20">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-brand-glow">Engine — risk posture</h2>
        <Link href="/dashboard/engine" className="text-xs text-gray-400 hover:text-brand">Command Center →</Link>
      </div>

      {s.total === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No findings analyzed yet — run a scan and the engine will score and prioritize them here.</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-5">
          {/* Risk index dial */}
          <div
            className="relative grid h-20 w-20 shrink-0 place-items-center rounded-full"
            style={{ background: `conic-gradient(${tone} ${s.index * 3.6}deg, rgba(255,255,255,0.08) 0)` }}
          >
            <div className="grid h-[3.9rem] w-[3.9rem] place-items-center rounded-full bg-surface-card text-center">
              <div>
                <div className="text-xl font-bold text-gray-100">{s.index}</div>
                <div className="text-[8px] uppercase tracking-wider text-gray-500">risk index</div>
              </div>
            </div>
          </div>

          {/* Tier breakdown */}
          <div className="grid flex-1 grid-cols-2 gap-1.5 sm:grid-cols-4">
            {(["P1", "P2", "P3", "P4"] as Tier[]).map((t) => (
              <div key={t} className={`rounded-lg border px-2 py-1.5 text-center ${TIER_TONE[t]}`}>
                <div className="text-lg font-bold">{s.tiers[t]}</div>
                <div className="text-[9px] uppercase tracking-wide opacity-80">{t}</div>
              </div>
            ))}
          </div>

          {/* Signals */}
          <div className="flex gap-4 text-center">
            <div>
              <div className="text-lg font-bold text-orange-300">{s.kev}</div>
              <div className="text-[9px] uppercase tracking-wide text-gray-500">🔥 KEV</div>
            </div>
            <div>
              <div className="text-lg font-bold text-emerald-300">{s.confirmed}</div>
              <div className="text-[9px] uppercase tracking-wide text-gray-500">proven</div>
            </div>
          </div>
        </div>
      )}

      {/* Top criticals */}
      {data.top.length > 0 && (
        <div className="mt-4 space-y-1 border-t border-surface-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Fix first</p>
          {data.top.map((it) => (
            <Link key={it.id} href={`/dashboard/findings/${it.id}`} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-white/5">
              <span className={`rounded border px-1.5 text-[10px] font-semibold ${TIER_TONE[it.tier]}`}>{it.tier}</span>
              <span className="min-w-0 flex-1 truncate text-gray-200">{it.title}</span>
              {it.knownExploited && <span className="shrink-0 text-[11px] text-red-300">🔥</span>}
              <span className="w-8 shrink-0 text-right text-sm font-bold text-gray-300">{it.score}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
