"use client";

import { useEffect, useState } from "react";
import { fmtGB } from "@/lib/stats-format";

type Activity = {
  onlineRunners: number;
  running: number;
  queued: number;
  etaSeconds: number;
  machine: {
    name: string;
    cpuPct: number | null;
    memPct: number | null;
    memUsedMb: number | null;
    memTotalMb: number | null;
    diskUsedMb: number | null;
    diskTotalMb: number | null;
    tempC: number | null;
    loadAvg: string | null;
  } | null;
};

function fmtEta(s: number): string {
  if (s <= 0) return "";
  if (s < 60) return `~${s}s left`;
  const m = Math.round(s / 60);
  if (m < 60) return `~${m}m left`;
  return `~${Math.floor(m / 60)}h ${m % 60}m left`;
}

/**
 * Slim footer status line — live processing/activity monitor: what the machines
 * are doing (running/queued jobs + a rough ETA) and their CPU / RAM / temp when
 * reported. Polls a cheap endpoint every few seconds.
 */
export function ActivityBar() {
  const [a, setA] = useState<Activity | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/activity", { cache: "no-store" });
        if (r.ok && alive) setA(await r.json());
      } catch {
        /* transient — keep the last snapshot */
      }
    };
    tick();
    const id = setInterval(tick, 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!a) return null;
  const busy = a.running + a.queued > 0;
  const m = a.machine;

  return (
    <div className="flex shrink-0 items-center gap-x-4 gap-y-1 overflow-x-auto whitespace-nowrap border-t border-surface-border bg-surface/85 px-4 py-1.5 text-[11px] text-gray-400 backdrop-blur sm:px-6 print:hidden">
      <span className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            busy ? "animate-pulse bg-sky-400" : a.onlineRunners ? "bg-emerald-400" : "bg-gray-600"
          }`}
        />
        <span className="text-gray-300">{busy ? "Processing" : a.onlineRunners ? "Idle" : "No machine"}</span>
      </span>

      {busy && (
        <span>
          {a.running} running
          {a.queued > 0 ? ` · ${a.queued} queued` : ""}
        </span>
      )}
      {busy && a.etaSeconds > 0 && <span className="text-gray-300">{fmtEta(a.etaSeconds)}</span>}

      <span className="ml-auto flex items-center gap-3">
        <span>
          {a.onlineRunners} machine{a.onlineRunners === 1 ? "" : "s"} online
        </span>
        {m?.cpuPct != null && <span title={`${m.name} · CPU`}>CPU {m.cpuPct}%</span>}
        {m?.memUsedMb != null ? (
          <span title={`${m.name} · RAM`}>
            RAM {fmtGB(m.memUsedMb)}/{fmtGB(m.memTotalMb)}
          </span>
        ) : (
          m?.memPct != null && <span title={`${m.name} · RAM`}>RAM {m.memPct}%</span>
        )}
        {m?.diskUsedMb != null && (
          <span title={`${m.name} · Disk`}>
            Disk {fmtGB(m.diskUsedMb)}/{fmtGB(m.diskTotalMb)}
          </span>
        )}
        {m?.tempC != null && (
          <span
            title={`${m.name} · temperature`}
            className={m.tempC >= 80 ? "text-sev-crit" : m.tempC >= 70 ? "text-sev-med" : ""}
          >
            {m.tempC}°C
          </span>
        )}
      </span>
    </div>
  );
}
