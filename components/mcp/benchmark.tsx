"use client";

import { useMemo } from "react";
import { Icon } from "@/components/icons";
import { SeverityBadge } from "@/components/badges";
import { parseManifest, scan, maxSeverity, SEV_RANK, type Severity } from "@/lib/mcp-scan";
import { FIXTURES, FIXTURE_JSON } from "./fixtures";

const ALL_CHECKS = [
  { id: "C1-hidden-instructions", short: "C1", name: "Hidden instructions" },
  { id: "C2-broad-permissions", short: "C2", name: "Broad permissions" },
  { id: "C3-dangerous-combo", short: "C3", name: "Dangerous combo" },
  { id: "C4-drift-risk", short: "C4", name: "Drift risk" },
  { id: "C5-tool-shadowing", short: "C5", name: "Tool shadowing" },
];

export function McpBenchmark() {
  const rows = useMemo(
    () =>
      FIXTURES.map((f) => {
        const findings = scan(parseManifest(FIXTURE_JSON(f)));
        const detected = maxSeverity(findings);
        const fired = new Set(findings.map((x) => x.check));
        const caught = SEV_RANK[detected] >= SEV_RANK[f.expect.severity];
        // The benign control "passes" by NOT escalating past its expected ceiling.
        const isControl = f.attack.startsWith("None");
        const pass = isControl ? SEV_RANK[detected] <= SEV_RANK[f.expect.severity] : caught;
        return { f, detected, fired, pass, count: findings.length };
      }),
    [],
  );

  const passed = rows.filter((r) => r.pass).length;
  const rate = Math.round((passed / rows.length) * 100);

  return (
    <div className="space-y-4">
      {/* Headline */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-gray-500">Detection rate</p>
          <p className="mt-1 text-3xl font-bold text-brand">{rate}%</p>
          <p className="text-[11px] text-gray-500">{passed}/{rows.length} scenarios as expected</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-gray-500">Checks</p>
          <p className="mt-1 text-3xl font-bold text-white">{ALL_CHECKS.length}</p>
          <p className="text-[11px] text-gray-500">poisoning · perms · combos · drift · shadowing</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-gray-500">Scenarios</p>
          <p className="mt-1 text-3xl font-bold text-white">{rows.length}</p>
          <p className="text-[11px] text-gray-500">attacks + 1 benign control</p>
        </div>
      </div>

      {/* Matrix */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="pb-2 pr-3 font-medium">Scenario</th>
              <th className="pb-2 pr-3 font-medium">Expected</th>
              <th className="pb-2 pr-3 font-medium">Detected</th>
              {ALL_CHECKS.map((c) => (
                <th key={c.id} className="pb-2 pr-3 text-center font-medium" title={c.name}>
                  {c.short}
                </th>
              ))}
              <th className="pb-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ f, detected, fired, pass }) => (
              <tr key={f.id} className="border-b border-surface-border/60 last:border-0">
                <td className="py-2.5 pr-3">
                  <span className="inline-flex items-center gap-2">
                    <Icon name={f.icon} className="h-4 w-4 text-gray-400" />
                    <span className="font-medium text-white">{f.label}</span>
                  </span>
                </td>
                <td className="py-2.5 pr-3">
                  <SeverityBadge value={f.expect.severity} />
                </td>
                <td className="py-2.5 pr-3">
                  <SeverityBadge value={detected} />
                </td>
                {ALL_CHECKS.map((c) => (
                  <td key={c.id} className="py-2.5 pr-3 text-center">
                    {fired.has(c.id) ? (
                      <Icon name="check" className="mx-auto h-4 w-4 text-brand" />
                    ) : (
                      <span className="text-gray-700">·</span>
                    )}
                  </td>
                ))}
                <td className="py-2.5">
                  <span
                    className={`tag inline-flex items-center gap-1 text-xs ${
                      pass ? "ring-emerald accent-emerald" : "ring-red accent-red"
                    }`}
                  >
                    <Icon name={pass ? "check" : "alert"} className="h-3 w-3" />
                    {pass ? "pass" : "fail"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-600">
        The benchmark runs the live in-browser scanner over every Attack Range fixture on each
        render. A scenario passes when an attack is detected at or above its expected severity, and
        when the benign control is <i>not</i> over-flagged.
      </p>
    </div>
  );
}
