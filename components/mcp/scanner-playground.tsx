"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { SeverityBadge } from "@/components/badges";
import {
  parseManifest,
  scan,
  maxSeverity,
  severityCounts,
  type Finding,
  type Severity,
} from "@/lib/mcp-scan";
import { FIXTURES, FIXTURE_JSON } from "./fixtures";

const LEVEL_RING: Record<Severity, string> = {
  critical: "ring-fuchsia-500/50 text-fuchsia-200",
  high: "border-sev-crit/40 text-sev-crit",
  medium: "ring-amber accent-amber",
  low: "ring-sky accent-sky",
  info: "border-surface-border text-gray-400",
};

export function McpScannerPlayground({ initial }: { initial?: string }) {
  const [text, setText] = useState(initial ?? FIXTURE_JSON(FIXTURES[0]));
  const [result, setResult] = useState<{ findings: Finding[]; server: string; tools: number; error?: string } | null>(null);

  function run() {
    try {
      const target = parseManifest(text);
      setResult({ findings: scan(target), server: target.name || "(unnamed)", tools: target.tools.length });
    } catch (e) {
      setResult({ findings: [], server: "", tools: 0, error: (e as Error).message });
    }
  }

  const counts = result ? severityCounts(result.findings) : null;
  const max = result && result.findings.length ? maxSeverity(result.findings) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Input */}
      <div className="card flex flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-border pb-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Load a sample</span>
          {FIXTURES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setText(FIXTURE_JSON(f));
                setResult(null);
              }}
              className="tag inline-flex items-center gap-1 text-xs text-gray-300 transition hover:border-brand/50 hover:text-white"
            >
              <Icon name={f.icon} className="h-3 w-3" />
              {f.label}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="mt-3 h-[26rem] w-full resize-y rounded-lg border border-surface-border bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-gray-200 outline-none focus:border-brand"
          placeholder='Paste an MCP tools/list manifest: {"tools":[{ "name":"…","description":"…","inputSchema":{…} }]}'
        />
        <div className="mt-3 flex items-center gap-2">
          <button onClick={run} className="btn-primary text-sm">
            <Icon name="radar" className="mr-1 inline h-4 w-4" /> Scan
          </button>
          <button onClick={() => { setText(""); setResult(null); }} className="btn-ghost text-sm">
            Clear
          </button>
          <span className="ml-auto text-[11px] text-gray-600">runs locally in your browser — nothing leaves the page</span>
        </div>
      </div>

      {/* Results */}
      <div className="card flex flex-col">
        {!result ? (
          <div className="grid flex-1 place-items-center text-center text-sm text-gray-500">
            <div>
              <Icon name="radar" className="mx-auto h-8 w-8 text-gray-700" />
              <p className="mt-2">Load a sample or paste a manifest, then <b className="text-gray-300">Scan</b>.</p>
            </div>
          </div>
        ) : result.error ? (
          <div className="rounded-lg border border-sev-crit/40 bg-sev-crit/10 p-3 text-sm text-sev-crit">
            <Icon name="alert" className="mr-1 inline h-4 w-4" /> Couldn&apos;t parse JSON: {result.error}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-surface-border pb-3">
              <span className="font-semibold text-white">{result.server}</span>
              <span className="text-xs text-gray-500">{result.tools} tool(s)</span>
              <span className={`tag ml-auto ${max ? LEVEL_RING[max] : "border-emerald-500/40 text-emerald-300"}`}>
                {max ? `max: ${max}` : "clean ✓"}
              </span>
            </div>
            {counts && (
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-400">
                {(["critical", "high", "medium", "low"] as Severity[])
                  .filter((s) => counts[s] > 0)
                  .map((s) => (
                    <span key={s}>
                      {counts[s]} {s}
                    </span>
                  ))}
              </div>
            )}
            <div className="mt-3 flex-1 space-y-2 overflow-y-auto stagger-in">
              {result.findings.length === 0 ? (
                <p className="text-sm text-emerald-300">No issues found by the current checks.</p>
              ) : (
                result.findings.map((f, i) => (
                  <div key={i} className="rounded-lg border border-surface-border bg-surface/40 p-3">
                    <div className="flex items-center gap-2">
                      <SeverityBadge value={f.severity} />
                      <span className="text-sm font-semibold text-white">{f.tool || "<server>"}</span>
                      <span className="ml-auto font-mono text-[10px] text-gray-600">{f.check}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-200">{f.title}</p>
                    {f.detail && <p className="mt-1 text-xs text-gray-400">{f.detail}</p>}
                    {f.evidence && <p className="mt-1 text-[11px] text-sev-med/90">evidence: {f.evidence}</p>}
                    {f.recommendation && <p className="mt-1 text-[11px] text-sev-low/80">fix: {f.recommendation}</p>}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
