import { fmtGB, fmtUptime, loadColor, ratioPct } from "@/lib/stats-format";

export type MachineStat = {
  cpuPct?: number | null;
  memPct?: number | null;
  memUsedMb?: number | null;
  memTotalMb?: number | null;
  diskUsedMb?: number | null;
  diskTotalMb?: number | null;
  tempC?: number | null;
  loadAvg?: string | null;
  cores?: number | null;
  uptimeSec?: number | null;
  gpuPct?: number | null;
  batteryPct?: number | null;
  charging?: boolean | null;
  powerW?: number | null;
  maxWorkers?: number | null;
};

function Bar({ label, pct, right }: { label: string; pct: number | null; right: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px]">
        <span className="uppercase tracking-wide text-gray-500">{label}</span>
        <span className="font-mono text-gray-300">{right}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-border">
        <div className="h-full rounded-full transition-[width]" style={{ width: `${pct ?? 0}%`, background: loadColor(pct) }} />
      </div>
    </div>
  );
}

/**
 * Resource stats for a machine: CPU / RAM / disk bars + temp / load / cores /
 * uptime. `compact` drops the secondary chips (used in the right rail).
 */
export function MachineStats({ s, compact = false }: { s: MachineStat; compact?: boolean }) {
  const memPct = ratioPct(s.memUsedMb, s.memTotalMb) ?? s.memPct ?? null;
  const diskPct = ratioPct(s.diskUsedMb, s.diskTotalMb);
  const hasAny = s.cpuPct != null || memPct != null || diskPct != null;
  if (!hasAny) {
    return <p className="text-[10px] text-gray-600">No live stats yet — update the machine's runner to v43+.</p>;
  }
  return (
    <div className="space-y-2">
      <Bar label="CPU" pct={s.cpuPct ?? null} right={s.cpuPct != null ? `${s.cpuPct}%` : "—"} />
      <Bar
        label="RAM"
        pct={memPct}
        right={s.memUsedMb != null ? `${fmtGB(s.memUsedMb)} / ${fmtGB(s.memTotalMb)}` : memPct != null ? `${memPct}%` : "—"}
      />
      <Bar
        label="Disk"
        pct={diskPct}
        right={s.diskUsedMb != null ? `${fmtGB(s.diskUsedMb)} / ${fmtGB(s.diskTotalMb)}` : "—"}
      />
      {s.gpuPct != null && <Bar label="GPU" pct={s.gpuPct} right={`${s.gpuPct}%`} />}
      {!compact && (
        <div className="flex flex-wrap gap-1.5 pt-0.5 text-[10px]">
          {s.tempC != null && (
            <span className={`tag ${s.tempC >= 80 ? "text-red-300" : s.tempC >= 70 ? "text-amber-300" : ""}`}>
              {s.tempC}°C
            </span>
          )}
          {s.batteryPct != null && (
            <span className="tag">
              {s.charging ? "⚡" : "🔋"} {s.batteryPct}%{s.powerW != null ? ` · ${s.powerW}W` : ""}
            </span>
          )}
          {s.cores != null && <span className="tag">{s.cores} cores</span>}
          {s.maxWorkers != null && <span className="tag">{s.maxWorkers}× parallel</span>}
          {s.loadAvg && <span className="tag font-mono">load {s.loadAvg}</span>}
          {s.uptimeSec != null && <span className="tag">up {fmtUptime(s.uptimeSec)}</span>}
        </div>
      )}
    </div>
  );
}
