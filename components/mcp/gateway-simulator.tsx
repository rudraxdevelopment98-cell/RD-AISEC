"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { parseManifest, type McpTarget } from "@/lib/mcp-scan";
import {
  evaluateTools,
  simulateCalls,
  DEFAULT_POLICY,
  POLICY_LABELS,
  type GatewayPolicy,
  type Verdict,
} from "@/lib/mcp-gateway";
import { FIXTURES, FIXTURE_JSON } from "./fixtures";

const VERDICT_STYLE: Record<Verdict, string> = {
  allow: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  flag: "border-sev-med/50 bg-sev-med/15 text-sev-med",
  block: "border-sev-crit/60 bg-sev-crit/20 text-sev-crit",
};
const VERDICT_ICON: Record<Verdict, string> = { allow: "check", flag: "alert", block: "lock" };

function VerdictTag({ v }: { v: Verdict }) {
  return (
    <span className={`tag inline-flex items-center gap-1 uppercase ${VERDICT_STYLE[v]}`}>
      <Icon name={VERDICT_ICON[v]} className="h-3 w-3" /> {v}
    </span>
  );
}

export function McpGatewaySimulator() {
  const [fixtureId, setFixtureId] = useState(FIXTURES[2].id); // credential exfil by default
  const [policy, setPolicy] = useState<GatewayPolicy>(DEFAULT_POLICY);
  const [seqText, setSeqText] = useState(
    FIXTURES[2].sequence.join(", "),
  );

  const fixture = FIXTURES.find((f) => f.id === fixtureId) ?? FIXTURES[0];

  const target: McpTarget | null = useMemo(() => {
    try {
      return parseManifest(FIXTURE_JSON(fixture));
    } catch {
      return null;
    }
  }, [fixture]);

  const verdicts = useMemo(
    () => (target ? evaluateTools(target, policy) : []),
    [target, policy],
  );

  const sequence = useMemo(
    () => seqText.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
    [seqText],
  );
  const calls = useMemo(
    () => (target ? simulateCalls(target, sequence, policy) : []),
    [target, sequence, policy],
  );

  function pickFixture(id: string) {
    setFixtureId(id);
    const f = FIXTURES.find((x) => x.id === id);
    if (f) setSeqText(f.sequence.join(", "));
  }

  const blocked = calls.filter((c) => c.verdict === "block").length;

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="card flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Icon name="shield" className="h-5 w-5 text-brand" />
          <span className="text-sm font-semibold text-white">Policy gateway</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {FIXTURES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => pickFixture(f.id)}
              className={`tag inline-flex items-center gap-1 text-xs transition ${
                f.id === fixtureId
                  ? "border-brand/60 bg-white/[0.06] text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <Icon name={f.icon} className="h-3 w-3" /> {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPolicy(DEFAULT_POLICY)}
          className="btn-ghost ml-auto text-xs"
        >
          Reset policy
        </button>
      </div>

      {/* Policy toggles */}
      <div className="card">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Policy rules</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {POLICY_LABELS.map((p) => {
            const on = policy[p.key];
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPolicy((cur) => ({ ...cur, [p.key]: !cur[p.key] }))}
                className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition ${
                  on
                    ? "border-brand/50 bg-brand/5"
                    : "border-surface-border bg-surface/30 opacity-60 hover:opacity-100"
                }`}
              >
                <span
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                    on ? "border-brand bg-brand text-black" : "border-gray-600 text-transparent"
                  }`}
                >
                  <Icon name="check" className="h-3 w-3" />
                </span>
                <span>
                  <span className="block text-xs font-medium text-gray-200">{p.label}</span>
                  <span className="block text-[11px] text-gray-500">{p.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Static per-tool verdicts */}
        <div className="card">
          <div className="flex items-center justify-between border-b border-surface-border pb-3">
            <span className="text-sm font-semibold text-white">Tools — admission control</span>
            <span className="text-xs text-gray-500">{verdicts.length} tool(s)</span>
          </div>
          <div className="mt-3 space-y-2 stagger-in">
            {verdicts.map((v) => (
              <div key={v.tool} className="rounded-lg border border-surface-border bg-surface/40 p-3">
                <div className="flex items-center gap-2">
                  <VerdictTag v={v.verdict} />
                  <span className="font-mono text-sm font-semibold text-white">{v.tool}</span>
                </div>
                <p className="mt-1.5 text-[11px] text-gray-500">
                  caps: {v.caps.length ? v.caps.join(", ") : "none inferred"}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">{v.reasons.join(" · ")}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Runtime call replay */}
        <div className="card flex flex-col">
          <div className="flex items-center justify-between border-b border-surface-border pb-3">
            <span className="text-sm font-semibold text-white">Runtime call replay</span>
            <span className={`tag text-xs ${blocked ? "ring-red accent-red" : "ring-emerald accent-emerald"}`}>
              {blocked ? `${blocked} blocked` : "all allowed"}
            </span>
          </div>
          <label className="mt-3 block text-[11px] text-gray-500">
            Call sequence (comma or newline separated)
          </label>
          <input
            value={seqText}
            onChange={(e) => setSeqText(e.target.value)}
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-surface-border bg-black/40 px-3 py-2 font-mono text-xs text-gray-200 outline-none focus:border-brand"
            placeholder="read_secret, post_url"
          />
          <div className="mt-3 space-y-2 stagger-in">
            {calls.length === 0 ? (
              <p className="text-sm text-gray-500">Enter a sequence of tool names to replay them through the gateway.</p>
            ) : (
              calls.map((c) => (
                <div
                  key={c.step}
                  className={`rounded-lg border p-2.5 ${
                    c.verdict === "block" ? "border-sev-crit/40 bg-sev-crit/5" : "border-surface-border bg-surface/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-gray-600">#{c.step}</span>
                    <VerdictTag v={c.verdict} />
                    <span className="font-mono text-sm text-white">{c.tool}</span>
                    {c.exfilBlocked && (
                      <span className="tag ml-auto ring-red accent-red text-[10px]">runtime taint</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{c.reason}</p>
                </div>
              ))
            )}
          </div>
          <p className="mt-3 text-[11px] text-gray-600">
            Tip: turn off <b className="text-gray-400">Block critical</b> and replay the credential
            sample — the network call is still blocked at runtime once a secret has been read.
          </p>
        </div>
      </div>
    </div>
  );
}
