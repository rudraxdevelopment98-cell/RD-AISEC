"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { remediationPlan } from "@/lib/engine/remediation-core";
import type { RiskScore, Tier } from "@/lib/engine/risk-core";
import type { Enrichment } from "@/lib/engine/engine-core";

export type WireItem = {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  confirmed: boolean;
  engagementId: string | null;
  engagementName: string;
  asset: string;
  risk: RiskScore;
  enrich: Enrichment;
};

export type WirePayload = {
  summary: { tiers: Record<Tier, number>; index: number; kev: number; confirmed: number; total: number };
  surfaces: { surface: string; count: number }[];
  assets: { asset: string; count: number; topScore: number; tier: Tier; kev: number }[];
  chains: { asset: string; steps: { label: string; classId: string | null; tier: Tier; score: number }[]; combinedRisk: number; rationale: string }[];
  items: WireItem[];
};

const TIER_TONE: Record<Tier, string> = {
  P1: "text-red-300 border-red-500/50 bg-red-500/15",
  P2: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  P3: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  P4: "text-sky-300 border-sky-500/40 bg-sky-500/10",
};

function scoreColor(score: number): string {
  if (score >= 80) return "bg-red-500";
  if (score >= 60) return "bg-orange-500";
  if (score >= 35) return "bg-amber-500";
  return "bg-sky-500";
}

type Tab = "risk" | "fix" | "intel";
type Filter = "all" | Tier | "kev";

export function EngineConsole({ payload, kevCount }: { payload: WirePayload; kevCount: number }) {
  const [selId, setSelId] = useState<string | null>(payload.items[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>("risk");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    return payload.items.filter((it) => {
      if (filter === "kev" && !it.risk.knownExploited) return false;
      if (filter !== "all" && filter !== "kev" && it.risk.tier !== filter) return false;
      if (query && !`${it.title} ${it.asset} ${it.enrich.classLabel} ${it.engagementName}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [payload.items, filter, q]);

  const sel = payload.items.find((i) => i.id === selId) ?? items[0] ?? null;
  const plan = useMemo(() => (sel ? remediationPlan(sel) : null), [sel]);
  const s = payload.summary;

  if (!payload.items.length) {
    return (
      <div className="py-10">
        <Header index={0} s={s} kevCount={kevCount} />
        <div className="card mt-6 grid place-items-center py-16 text-center">
          <div className="text-4xl">🛰️</div>
          <h2 className="mt-3 text-lg font-semibold text-gray-100">No findings to analyze yet</h2>
          <p className="mt-1 max-w-md text-sm text-gray-500">
            Run an assessment or scan — as findings land, the engine scores and prioritizes them here,
            with remediation plans and attack-chain analysis.
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/dashboard/scan" className="btn-primary px-4 py-2 text-sm">Start a scan</Link>
            <Link href="/dashboard/engagements" className="btn-ghost px-4 py-2 text-sm">Open engagements</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <Header index={s.index} s={s} kevCount={kevCount} />

      {/* Tier filter ribbon */}
      <div className="sticky-under-header mt-4 flex flex-wrap items-center gap-1.5 rounded-2xl border border-surface-border bg-surface/80 p-1.5 backdrop-blur">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={s.total} />
        {(["P1", "P2", "P3", "P4"] as Tier[]).map((t) => (
          <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)} label={t} count={s.tiers[t]} tone={TIER_TONE[t]} />
        ))}
        <FilterChip active={filter === "kev"} onClick={() => setFilter("kev")} label="🔥 KEV" count={s.kev} tone="text-red-300 border-red-500/50 bg-red-500/15" />
        <div className="ml-auto flex items-center gap-2 rounded-xl border border-surface-border bg-black/20 px-3 py-1">
          <span className="text-gray-500">🔎</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter findings…"
            className="w-40 bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-600 sm:w-56"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        {/* Prioritized queue */}
        <div className="min-w-0">
          <SectionLabel>Prioritized queue · {items.length}</SectionLabel>
          <div className="mt-2 space-y-1.5">
            {items.length === 0 && <div className="card text-center text-sm text-gray-500">No findings match this filter.</div>}
            {items.slice(0, 200).map((it, i) => (
              <QueueRow key={it.id} it={it} rank={i + 1} active={sel?.id === it.id} onClick={() => setSelId(it.id)} />
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="min-w-0">
          {sel && (
            <div className="card sticky top-16">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${TIER_TONE[sel.risk.tier]}`}>{sel.risk.tier}</span>
                    <span className="text-xs text-gray-500">{sel.risk.tierLabel}</span>
                    {sel.risk.knownExploited && <span className="rounded-full border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">🔥 KEV</span>}
                    {sel.confirmed && <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">✓ proven</span>}
                  </div>
                  <h2 className="mt-1.5 text-base font-semibold leading-snug text-gray-100">{sel.title}</h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {sel.enrich.classLabel} · <span className="font-mono">{sel.asset || "—"}</span>
                    {sel.engagementName && <> · {sel.engagementName}</>}
                  </p>
                </div>
                <ScoreDial score={sel.risk.score} />
              </div>

              {/* Tabs */}
              <div className="mt-4 flex gap-1 border-b border-surface-border">
                {([["risk", "Risk"], ["fix", "Remediation"], ["intel", "Intel"]] as [Tab, string][]).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition ${
                      tab === id ? "border-brand text-brand" : "border-transparent text-gray-400 hover:text-gray-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-3">
                {tab === "risk" && <RiskTab risk={sel.risk} />}
                {tab === "fix" && plan && <FixTab plan={plan} />}
                {tab === "intel" && <IntelTab it={sel} />}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-surface-border pt-3">
                <Link href={`/dashboard/findings/${sel.id}`} className="btn-ghost px-3 py-1.5 text-xs">Open finding</Link>
                <Link href={`/dashboard/findings/${sel.id}/exploit`} className="btn-ghost px-3 py-1.5 text-xs">⚔ Exploit / validate</Link>
                {sel.engagementId && <Link href={`/dashboard/engagements/${sel.engagementId}`} className="btn-ghost px-3 py-1.5 text-xs">Engagement</Link>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Attack chains + rollups */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div>
          <SectionLabel>⛓ Attack chains · {payload.chains.length}</SectionLabel>
          <div className="mt-2 space-y-2">
            {payload.chains.length === 0 && <div className="card text-sm text-gray-500">No multi-step chains detected — findings don&apos;t currently stack on a shared asset.</div>}
            {payload.chains.map((c) => (
              <div key={c.asset} className="card">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-sm text-gray-100">{c.asset}</span>
                  <span className="shrink-0 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300">risk {c.combinedRisk}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {c.steps.map((st, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-gray-600">→</span>}
                      <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${TIER_TONE[st.tier]}`}>{st.label}</span>
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-gray-500">{c.rationale}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <SectionLabel>🎯 Top exposed assets</SectionLabel>
            <div className="card mt-2 space-y-1.5">
              {payload.assets.slice(0, 8).map((a) => (
                <div key={a.asset} className="flex items-center gap-2 text-sm">
                  <span className={`rounded border px-1.5 text-[10px] ${TIER_TONE[a.tier]}`}>{a.tier}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-gray-200">{a.asset || "—"}</span>
                  {a.kev > 0 && <span className="text-[10px] text-red-300">🔥{a.kev}</span>}
                  <span className="text-xs text-gray-500">{a.count} finding{a.count === 1 ? "" : "s"}</span>
                </div>
              ))}
              {payload.assets.length === 0 && <p className="text-sm text-gray-500">No assets resolved.</p>}
            </div>
          </div>
          <div>
            <SectionLabel>🗺 Attack surface</SectionLabel>
            <div className="card mt-2">
              {payload.surfaces.map((sf) => {
                const pct = Math.round((sf.count / (payload.summary.total || 1)) * 100);
                return (
                  <div key={sf.surface} className="mb-2 last:mb-0">
                    <div className="flex justify-between text-[11px] text-gray-400">
                      <span className="capitalize">{sf.surface}</span>
                      <span>{sf.count}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Header / risk index ──────────────────────────────────────────────────────
function Header({ index, s, kevCount }: { index: number; s: WirePayload["summary"]; kevCount: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Engine — Command Center</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Risk-scored, prioritized intelligence across every finding · CISA KEV catalog: {kevCount.toLocaleString()} CVEs
        </p>
      </div>
      <div className="flex items-center gap-3">
        <RiskIndex value={index} />
        <div className="grid grid-cols-2 gap-1.5">
          <Tile label="P1 critical" value={s.tiers.P1} tone="text-red-300" />
          <Tile label="Proven" value={s.confirmed} tone="text-emerald-300" />
          <Tile label="KEV" value={s.kev} tone="text-orange-300" />
          <Tile label="Findings" value={s.total} tone="text-gray-200" />
        </div>
      </div>
    </div>
  );
}

function RiskIndex({ value }: { value: number }) {
  const tone = value >= 75 ? "#ef4444" : value >= 50 ? "#f59e0b" : value >= 25 ? "#38bdf8" : "#34d399";
  return (
    <div
      className="relative grid h-24 w-24 place-items-center rounded-full"
      style={{ background: `conic-gradient(${tone} ${value * 3.6}deg, rgba(255,255,255,0.08) 0)` }}
    >
      <div className="grid h-[4.7rem] w-[4.7rem] place-items-center rounded-full bg-surface text-center">
        <div>
          <div className="text-2xl font-bold text-gray-100">{value}</div>
          <div className="text-[9px] uppercase tracking-wider text-gray-500">risk index</div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-surface-border bg-black/20 px-2.5 py-1.5">
      <div className={`text-lg font-bold ${tone}`}>{value}</div>
      <div className="text-[10px] leading-tight text-gray-500">{label}</div>
    </div>
  );
}

function ScoreDial({ score }: { score: number }) {
  return (
    <div className="shrink-0 text-right">
      <div className={`text-3xl font-bold ${score >= 80 ? "text-red-300" : score >= 60 ? "text-orange-300" : score >= 35 ? "text-amber-300" : "text-sky-300"}`}>{score}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">risk</div>
    </div>
  );
}

function FilterChip({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone?: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active ? tone ?? "border-brand/50 bg-brand/15 text-brand" : "border-transparent text-gray-400 hover:text-gray-100"
      }`}
    >
      {label} <span className="opacity-70">{count}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{children}</h3>;
}

// ── Queue row ────────────────────────────────────────────────────────────────
function QueueRow({ it, rank, active, onClick }: { it: WireItem; rank: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full rounded-xl border p-3 text-left transition ${active ? "border-brand/40 bg-brand/10" : "border-surface-border bg-surface-card/40 hover:bg-white/5"}`}
    >
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 text-center text-xs text-gray-600">{rank}</span>
        <span className={`rounded border px-1.5 text-[10px] font-semibold ${TIER_TONE[it.risk.tier]}`}>{it.risk.tier}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-100">{it.title}</span>
        {it.risk.knownExploited && <span className="shrink-0 text-[11px] text-red-300">🔥</span>}
        {it.confirmed && <span className="shrink-0 text-[11px] text-emerald-300">✓</span>}
        <span className="w-8 shrink-0 text-right text-sm font-bold text-gray-300">{it.risk.score}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 pl-8">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full ${scoreColor(it.risk.score)}`} style={{ width: `${it.risk.score}%` }} />
        </div>
        <span className="shrink-0 truncate font-mono text-[10px] text-gray-500">{it.asset || it.enrich.classLabel}</span>
      </div>
    </button>
  );
}

// ── Detail tabs ──────────────────────────────────────────────────────────────
function RiskTab({ risk }: { risk: RiskScore }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="CVSS" value={risk.cvss.toFixed(1)} />
        <MiniStat label="EPSS" value={risk.epss != null ? `${(risk.epss * 100).toFixed(0)}%` : "—"} />
        <MiniStat label="Exposure" value={risk.exposure} />
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Why this score</p>
      <div className="mt-1.5 space-y-1.5">
        {risk.factors.map((f, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className={`w-10 shrink-0 text-right font-mono text-xs font-semibold ${f.delta >= 0 ? "text-emerald-300" : "text-red-300"}`}>
              {f.delta >= 0 ? "+" : ""}{f.delta}
            </span>
            <span className="text-gray-200">{f.label}</span>
            <span className="min-w-0 flex-1 truncate text-right text-[11px] text-gray-500">{f.detail}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-surface-border bg-black/20 px-3 py-2 text-xs text-gray-400">
        <span className="text-gray-500">Remediation SLA:</span> <span className="font-semibold text-gray-200">{risk.sla}</span>
      </div>
    </div>
  );
}

function FixTab({ plan }: { plan: ReturnType<typeof remediationPlan> }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-surface-border bg-black/20 px-2 py-0.5 text-[11px] text-gray-300">Effort: {plan.effort}</span>
        <span className="text-[11px] text-gray-500">{plan.classLabel}</span>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Root cause</p>
        <p className="mt-0.5 text-gray-300">{plan.rootCause}</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Fix</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-gray-200">
          {plan.fixSteps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </div>
      {plan.snippet && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{plan.snippet.label}</p>
          <pre className="mt-1 overflow-auto rounded-lg border border-surface-border bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-gray-300">{plan.snippet.code}</pre>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Verify the fix</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-300">{plan.verifySteps.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Prevent recurrence</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-300">{plan.preventive.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      </div>
      {plan.references.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">References</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {plan.references.map((r, i) => (
              <a key={i} href={r.url} target="_blank" rel="noreferrer" className="tag hover:border-brand hover:text-brand">{r.label} ↗</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IntelTab({ it }: { it: WireItem }) {
  const e = it.enrich;
  const rows: [string, string | null][] = [
    ["Class", e.classLabel],
    ["CWE", e.cwe],
    ["OWASP", e.owasp],
    ["ATT&CK", e.attack],
    ["CVE", e.cve],
    ["CVSS band", e.cvssBand],
    ["Surface", e.surface],
    ["Asset", it.asset || null],
    ["Status", it.status],
  ];
  return (
    <div className="text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 border-b border-surface-border/50 pb-1">
            <dt className="text-[11px] uppercase tracking-wide text-gray-500">{k}</dt>
            <dd className="truncate text-right font-mono text-[12px] text-gray-200">{v || "—"}</dd>
          </div>
        ))}
      </dl>
      {e.indicators.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Confirm-it indicators</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-gray-300">{e.indicators.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      {it.description && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Detail</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-gray-400">{it.description}</p>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-surface-border bg-black/20 px-2.5 py-2 text-center">
      <div className="truncate text-sm font-semibold capitalize text-gray-100">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
    </div>
  );
}
