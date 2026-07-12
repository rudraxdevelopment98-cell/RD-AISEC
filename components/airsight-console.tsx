"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rssiBars, type Survey } from "@/lib/survey-core";
import { surveyToNetworkEvents, surveyToClientEvents, surveyToEvents, eventSummary } from "@/lib/airsight-events";
import type { NetworkEvent, ClientEvent } from "@/lib/airsight-core";

export type ConsoleMachine = { id: string; name: string; wifi: string[] };

function Bars({ dbm }: { dbm: number }) {
  const n = rssiBars(dbm);
  return (
    <span className="inline-flex items-end gap-[1px]" title={`${dbm} dBm`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={`w-[3px] rounded-sm ${i <= n ? "bg-emerald-400" : "bg-white/15"}`} style={{ height: `${3 + i * 2}px` }} />
      ))}
    </span>
  );
}

/**
 * AirSight live console — the unified view. It runs a passive monitor-mode survey
 * on the chosen capture node and renders the ONE canonical event model:
 * networks (network_discovered) + clients (client_seen) + a presence/activity
 * rollup. Survey, monitor and map now share this stream instead of being
 * separate tools. Passive: it only listens.
 */
export function AirsightConsole({ machines, defaultIface }: { machines: ConsoleMachine[]; defaultIface?: string }) {
  const [runnerId, setRunnerId] = useState(machines[0]?.id ?? "");
  const ifaces = machines.find((m) => m.id === runnerId)?.wifi ?? [];
  const [iface, setIface] = useState(defaultIface ?? ifaces[0] ?? "");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [hist, setHist] = useState<{ total: number; clients: number; activeClients: number; newLastHour: number } | null>(null);
  const [samples, setSamples] = useState<{ t: number; networks: number; clients: number }[]>([]);
  const loop = useRef(false);

  useEffect(() => { if (!iface && ifaces[0]) setIface(ifaces[0]); }, [ifaces, iface]);

  // Load persisted rolling history on mount.
  useEffect(() => {
    fetch("/api/sensing/airsight", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d?.summary) setHist(d.summary); if (d?.history?.samples) setSamples(d.history.samples); })
      .catch(() => {});
  }, []);

  // Persist a survey's events into the rolling history + refresh the timeline.
  const persist = useCallback(async (s: Survey) => {
    try {
      const r = await fetch("/api/sensing/airsight", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: surveyToEvents(s), tier: "standard" }),
      }).then((x) => x.json());
      if (r?.summary) setHist(r.summary);
      setSamples((prev) => [...prev.slice(-199), { t: Date.now(), networks: (s.aps ?? []).length, clients: (s.stations ?? []).length }]);
    } catch { /* ignore */ }
  }, []);

  async function clearHistory() {
    if (!confirm("Clear the AirSight device history?")) return;
    await fetch("/api/sensing/airsight", { method: "DELETE" });
    setHist({ total: 0, clients: 0, activeClients: 0, newLastHour: 0 });
    setSamples([]);
  }

  const run = useCallback(async () => {
    if (loop.current) return;
    loop.current = true;
    try {
      while (loop.current) {
        setStatus("listening…");
        const res = await fetch("/api/sensing/survey", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runnerId, iface, live: true, seconds: 12 }),
        });
        const j = await res.json();
        if (j.error || !j.jobId) { setStatus(j.error || "could not start"); break; }
        let done = false;
        for (let i = 0; i < 20 && loop.current && !done; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const p = await fetch(`/api/sensing/survey?job=${j.jobId}`, { cache: "no-store" }).then((r) => r.json());
          if (p.status === "done") { done = true; if (p.survey) { setSurvey(p.survey); setStatus(p.survey.error ? String(p.survey.message || p.survey.error) : "live"); if (!p.survey.error) persist(p.survey); } }
          else if (p.status === "error" || p.status === "canceled") { setStatus(p.status); done = true; }
        }
      }
    } finally { loop.current = false; }
  }, [runnerId, iface, persist]);

  useEffect(() => {
    if (running) run();
    return () => { loop.current = false; };
  }, [running, run]);

  const nets: NetworkEvent[] = survey ? surveyToNetworkEvents(survey).sort((a, b) => b.signalDbm - a.signalDbm) : [];
  const clients: ClientEvent[] = survey ? surveyToClientEvents(survey).sort((a, b) => b.signalDbm - a.signalDbm) : [];
  const sum = survey ? eventSummary(survey) : null;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="card flex flex-wrap items-center gap-3">
        <button onClick={() => setRunning((r) => !r)} disabled={!runnerId || !iface} className={`${running ? "btn-ghost" : "btn-primary"} text-sm disabled:opacity-50`}>
          {running ? "⏸ Stop" : "▶ Start passive listen"}
        </button>
        {machines.length > 0 ? (
          <>
            <label className="flex items-center gap-1.5 text-xs text-gray-400">Machine
              <select value={runnerId} onChange={(e) => { setRunnerId(e.target.value); setSurvey(null); }} className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand">
                {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-400">Monitor adapter
              <select value={iface} onChange={(e) => setIface(e.target.value)} className="rounded-lg border border-surface-border bg-surface px-2 py-1 font-mono text-xs outline-none focus:border-brand">
                {(ifaces.length ? ifaces : ["(none)"]).map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
          </>
        ) : (
          <span className="text-xs text-sev-med">Connect a capture machine with a monitor adapter.</span>
        )}
        <span className="ml-auto text-xs text-gray-500">{status}</span>
      </div>

      {/* Summary tiles */}
      {sum && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Networks" value={String(sum.networks)} sub="APs heard" />
          <Tile label="Clients" value={String(sum.clients)} sub={`${sum.associated} associated`} accent="sky" />
          <Tile label="Strongest" value={sum.strongest ? `${sum.strongest.signalDbm}` : "—"} sub={sum.strongest?.ssid ?? "dBm"} accent="amber" />
          <Tile label="Encryption" value={sum.encryptions[0]?.name ?? "—"} sub={`${sum.encryptions.length} types`} />
        </div>
      )}

      {/* Rolling history + presence timeline (persisted) */}
      {(hist || samples.length > 0) && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">Presence timeline <span className="text-xs font-normal text-gray-500">· rolling history</span></p>
            <div className="flex items-center gap-2">
              <a href="/api/sensing/airsight?export=json" className="btn-ghost text-xs" download>⬇ Export JSON</a>
              <button onClick={clearHistory} className="text-[11px] text-gray-500 hover:text-sev-crit">clear</button>
            </div>
          </div>
          {hist && (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="tag border-brand/40 text-brand">{hist.total} devices seen</span>
              <span className="tag">{hist.clients} clients</span>
              <span className="tag border-emerald-500/40 text-emerald-300">{hist.activeClients} active now</span>
              <span className="tag">{hist.newLastHour} new / hr</span>
            </div>
          )}
          {samples.length > 1 && (
            <svg viewBox="0 0 240 40" preserveAspectRatio="none" className="mt-3 h-12 w-full">
              {(() => {
                const max = Math.max(4, ...samples.map((s) => Math.max(s.clients, s.networks)));
                const pts = (key: "clients" | "networks") =>
                  samples.map((s, i) => `${((i / (samples.length - 1)) * 240).toFixed(1)},${(40 - (s[key] / max) * 37 - 1.5).toFixed(1)}`).join(" ");
                return (
                  <>
                    <polyline points={pts("clients")} fill="none" stroke="rgb(56 189 248)" strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
                    <polyline points={pts("networks")} fill="none" stroke="rgb(52 211 153)" strokeWidth={1.1} vectorEffect="non-scaling-stroke" opacity={0.7} />
                  </>
                );
              })()}
            </svg>
          )}
          <p className="mt-1 text-[10px] text-gray-500"><span className="text-sev-low">clients</span> / <span className="text-emerald-400">networks</span> per listen, over time. History persists across restarts.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Networks (network_discovered events) */}
        <div className="card">
          <p className="text-sm font-semibold text-white">Networks <span className="text-xs font-normal text-gray-500">· network_discovered</span></p>
          <div className="mt-2 max-h-80 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface-card text-[10px] uppercase text-gray-500">
                <tr><th className="py-1 pr-2">SSID</th><th className="py-1 pr-2">Ch</th><th className="py-1 pr-2">Enc</th><th className="py-1 pr-2">Vendor</th><th className="py-1 pr-2 text-right">Signal</th></tr>
              </thead>
              <tbody className="text-gray-300">
                {nets.map((n) => (
                  <tr key={n.bssid} className="border-t border-surface-border">
                    <td className="py-1 pr-2">{n.ssid}<span className="block font-mono text-[10px] text-gray-600">{n.bssid}</span></td>
                    <td className="py-1 pr-2">{n.channel || "—"}</td>
                    <td className="py-1 pr-2">{n.encryption}</td>
                    <td className="py-1 pr-2">{n.vendor}</td>
                    <td className="py-1 pr-2 text-right"><Bars dbm={n.signalDbm} /></td>
                  </tr>
                ))}
                {nets.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-gray-600">{running ? "listening…" : "start a passive listen"}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Clients (client_seen events) */}
        <div className="card">
          <p className="text-sm font-semibold text-white">Clients <span className="text-xs font-normal text-gray-500">· client_seen</span></p>
          <div className="mt-2 max-h-80 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface-card text-[10px] uppercase text-gray-500">
                <tr><th className="py-1 pr-2">Device</th><th className="py-1 pr-2">Vendor</th><th className="py-1 pr-2">Assoc. AP</th><th className="py-1 pr-2 text-right">Signal</th></tr>
              </thead>
              <tbody className="text-gray-300">
                {clients.map((c) => (
                  <tr key={c.clientMac} className="border-t border-surface-border">
                    <td className="py-1 pr-2 font-mono text-[10px]">{c.clientMac}</td>
                    <td className="py-1 pr-2">{c.vendor}</td>
                    <td className="py-1 pr-2 font-mono text-[10px] text-gray-500">{c.associatedBssid ?? "—"}</td>
                    <td className="py-1 pr-2 text-right"><Bars dbm={c.signalDbm} /></td>
                  </tr>
                ))}
                {clients.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-gray-600">{running ? "listening…" : "no clients yet"}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-500">
        Passive monitor-mode listen — networks + clients are captured without transmitting. This is the
        unified AirSight event stream the Auto Map and live monitor also feed.
      </p>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: "sky" | "amber" }) {
  const color = accent === "sky" ? "text-sev-low" : accent === "amber" ? "text-sev-med" : "text-brand";
  return (
    <div className="card !p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${color}`}>{value}</p>
      <p className="truncate text-[10px] text-gray-500">{sub}</p>
    </div>
  );
}
