"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Hint } from "@/components/hint";
import { SeverityBadge } from "@/components/badges";
import { parseManifest, scan, maxSeverity, SEV_RANK, type Severity } from "@/lib/mcp-scan";
import { FIXTURES, FIXTURE_JSON, type Fixture } from "./fixtures";

const SEV_TEXT: Record<Severity, string> = {
  critical: "text-fuchsia-300",
  high: "text-sev-crit",
  medium: "text-sev-med",
  low: "text-sev-low",
  info: "text-gray-400",
};

function RangeCard({ f }: { f: Fixture }) {
  const [open, setOpen] = useState(false);
  const target = parseManifest(FIXTURE_JSON(f));
  const findings = open ? scan(target) : [];
  const detected = open ? maxSeverity(findings) : null;
  const checks = open ? Array.from(new Set(findings.map((x) => x.check))) : [];
  const caught = detected ? SEV_RANK[detected] >= SEV_RANK[f.expect.severity] : false;

  return (
    <div className="card flex flex-col">
      <div className="flex items-start gap-3 border-b border-surface-border pb-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
          <Icon name={f.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-white">{f.label}</p>
          <p className="text-xs text-gray-500">{f.attack}</p>
        </div>
        <span className={`tag ml-auto ${SEV_TEXT[f.expect.severity]}`}>{f.expect.severity}</span>
      </div>

      <p className="mt-3 text-sm text-gray-300">{f.summary}</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-500">{f.story}</p>

      <div className="mt-3 flex flex-wrap gap-1">
        {target.tools.map((t) => (
          <span key={t.name} className="tag font-mono text-[10px] text-gray-400">{t.name}</span>
        ))}
      </div>

      <div className="mt-auto pt-3">
        <button onClick={() => setOpen((o) => !o)} className="btn-ghost w-full text-sm">
          <Icon name="radar" className="mr-1 inline h-4 w-4" />
          {open ? "Hide scan result" : "Run scan"}
        </button>
      </div>

      {open && (
        <div className="mt-3 rounded-lg border border-surface-border bg-black/30 p-3 stagger-in">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${detected ? SEV_TEXT[detected] : "text-gray-400"}`}>
              detected: {detected ?? "—"}
            </span>
            <span
              className={`tag ml-auto inline-flex items-center gap-1 text-xs ${
                caught ? "ring-emerald accent-emerald" : "ring-red accent-red"
              }`}
            >
              <Icon name={caught ? "check" : "alert"} className="h-3 w-3" />
              {caught ? "caught" : "missed"}
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-gray-500">{checks.join(" · ") || "no checks fired"}</p>
          <div className="mt-2 space-y-1.5">
            {findings.map((x, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <SeverityBadge value={x.severity} />
                <span className="text-gray-300">
                  <b className="text-white">{x.tool || "<server>"}</b> — {x.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function McpAttackRange() {
  return (
    <div className="space-y-4">
      <div className="card flex items-start gap-3">
        <Icon name="skull" className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <div>
          <p className="text-sm font-semibold text-white">
            Attack range{" "}
            <Hint>
              A gallery of malicious (and one honest) MCP servers. Each is a real
              <code className="mx-1 rounded bg-black/40 px-1 text-[11px]">tools/list</code> manifest —
              run the scanner against it and confirm the detection matches the threat. For authorized
              research and education only.
            </Hint>
          </p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {FIXTURES.map((f) => (
          <RangeCard key={f.id} f={f} />
        ))}
      </div>
    </div>
  );
}
