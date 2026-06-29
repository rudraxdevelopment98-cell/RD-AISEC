import Link from "next/link";
import { Icon } from "@/components/icons";
import { Tabs, TabPanel } from "@/components/tabs";
import { McpScannerPlayground } from "@/components/mcp/scanner-playground";
import { McpGatewaySimulator } from "@/components/mcp/gateway-simulator";
import { McpAttackRange } from "@/components/mcp/attack-range";
import { McpBenchmark } from "@/components/mcp/benchmark";
import { listShivaDocs } from "@/lib/shiva";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "scanner", label: "Scanner", icon: "radar" },
  { id: "gateway", label: "Gateway", icon: "shield" },
  { id: "range", label: "Attack range", icon: "skull" },
  { id: "benchmark", label: "Benchmark", icon: "chart" },
  { id: "docs", label: "Docs", icon: "book" },
];

const CHECKS = [
  { id: "C1", name: "Tool poisoning", desc: "Hidden / imperative instructions in a tool description", icon: "alert" },
  { id: "C2", name: "Broad permissions", desc: "Tools that expose exec, fs, secrets, network, db", icon: "lock" },
  { id: "C3", name: "Dangerous combos", desc: "Capability pairs that form an exfil / RCE chain", icon: "skull" },
  { id: "C4", name: "Description drift", desc: "Runtime-computed descriptions (rug-pull / re-approval)", icon: "clock" },
];

const PIPELINE = [
  { name: "Discover", desc: "Read the server's tools/list manifest", icon: "search" },
  { name: "Scan", desc: "Static checks C1–C4 over names, params, descriptions", icon: "radar" },
  { name: "Gateway", desc: "Admission control + runtime data-flow taint", icon: "shield" },
  { name: "Report", desc: "Severity-ranked findings with fixes", icon: "book" },
];

export default function ShivaIndex() {
  const docs = listShivaDocs();
  const groups = Array.from(new Set(docs.map((d) => d.group)));

  return (
    <div className="mx-auto max-w-6xl">
      {/* Hero / header */}
      <header className="card relative overflow-hidden">
        <div className="relative flex flex-wrap items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand">
            <Icon name="shield" className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-white">Shiva</h1>
              <span className="tag ring-sky accent-sky text-xs">MCP / agent-tool security</span>
              <span className="tag ring-emerald accent-emerald text-xs">live engine</span>
            </div>
            <p className="mt-1.5 max-w-2xl text-sm text-gray-400">
              The detection and policy layer where tools meet AI agents. Scan an MCP
              <code className="mx-1 rounded bg-black/40 px-1 text-[12px]">tools/list</code> manifest
              for poisoning and over-broad capabilities, simulate a policy gateway, and replay the
              attack range — all running live in your browser.
            </p>
          </div>
        </div>

        {/* Stat strip */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { k: "Checks", v: "C1–C4", n: "4 detections" },
            { k: "Scenarios", v: "5", n: "attacks + control" },
            { k: "Gateway", v: "allow/flag/block", n: "+ runtime taint" },
            { k: "Runs", v: "in-browser", n: "nothing leaves the page" },
          ].map((s) => (
            <div key={s.k} className="rounded-lg border border-surface-border bg-surface/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">{s.k}</p>
              <p className="mt-0.5 text-sm font-semibold text-white">{s.v}</p>
              <p className="text-[11px] text-gray-500">{s.n}</p>
            </div>
          ))}
        </div>
      </header>

      <div className="mt-5">
        <Tabs
          tabs={TABS.map((t) => ({
            id: t.id,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Icon name={t.icon} className="h-4 w-4" />
                {t.label}
              </span>
            ),
          }))}
          defaultTab="overview"
        >
          {/* Overview */}
          <TabPanel id="overview">
            <div className="space-y-4">
              {/* Pipeline */}
              <section className="card">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">How it works</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {PIPELINE.map((p, i) => (
                    <div key={p.name} className="relative rounded-lg border border-surface-border bg-surface/40 p-3">
                      <span className="absolute right-3 top-3 font-mono text-xs text-gray-700">{i + 1}</span>
                      <Icon name={p.icon} className="h-5 w-5 text-brand" />
                      <p className="mt-2 text-sm font-semibold text-white">{p.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{p.desc}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Detection checks */}
              <section className="card">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Detection checks</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {CHECKS.map((c) => (
                    <div key={c.id} className="flex items-start gap-3 rounded-lg border border-surface-border bg-surface/40 p-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                        <Icon name={c.icon} className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-white">
                          <span className="font-mono text-brand">{c.id}</span> · {c.name}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">{c.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Quick links */}
              <section className="card">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Jump in</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {[
                    { t: "Scan a manifest", d: "Paste a tools/list and get findings", i: "radar" },
                    { t: "Simulate a gateway", d: "Allow / flag / block under a policy", i: "shield" },
                    { t: "Walk the attack range", d: "Five worked scenarios", i: "skull" },
                  ].map((x) => (
                    <div key={x.t} className="rounded-lg border border-surface-border bg-surface/40 p-3">
                      <Icon name={x.i} className="h-5 w-5 text-brand" />
                      <p className="mt-2 text-sm font-semibold text-white">{x.t}</p>
                      <p className="text-xs text-gray-500">{x.d}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-gray-600">
                  Use the tabs above to open each tool. For authorized security testing and education only.
                </p>
              </section>
            </div>
          </TabPanel>

          {/* Scanner */}
          <TabPanel id="scanner">
            <McpScannerPlayground />
          </TabPanel>

          {/* Gateway */}
          <TabPanel id="gateway">
            <McpGatewaySimulator />
          </TabPanel>

          {/* Attack range */}
          <TabPanel id="range">
            <McpAttackRange />
          </TabPanel>

          {/* Benchmark */}
          <TabPanel id="benchmark">
            <McpBenchmark />
          </TabPanel>

          {/* Docs */}
          <TabPanel id="docs">
            <div className="space-y-6">
              <p className="text-sm text-gray-400">
                The Shiva control room — plan, progress, threat model, and attack research, rendered
                live with diagrams.
              </p>
              {groups.map((group) => (
                <section key={group}>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">{group}</h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {docs
                      .filter((d) => d.group === group)
                      .map((d) => (
                        <Link
                          key={d.slug}
                          href={`/dashboard/shiva/${d.slug}`}
                          className="card-hover flex items-center justify-between gap-3"
                        >
                          <span className="font-medium text-white">{d.title}</span>
                          <Icon name="arrow" className="h-4 w-4 text-brand" />
                        </Link>
                      ))}
                  </div>
                </section>
              ))}
            </div>
          </TabPanel>
        </Tabs>
      </div>
    </div>
  );
}
