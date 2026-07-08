"use client";

import { useEffect, useState } from "react";
import {
  PIPELINE,
  STAGE_INFO,
  scheduleLabel,
  stageInfo,
  summarizeMaintenance,
  type MaintStage,
} from "@/lib/maintenance-core";

export type MaintProps = {
  stage?: string | null;
  note?: string | null;
  pct?: number | null;
  startedAt?: string | null; // ISO
  updatedAt?: string | null; // ISO
  /** window bounds shown as the schedule label */
  startHour?: number;
  endHour?: number;
  /** whether the daily pass is scheduled at all */
  enabled?: boolean;
};

function relTime(ms: number | null): string {
  if (ms == null) return "";
  const d = Date.now() - ms;
  if (d < 0) return "just now";
  const s = Math.round(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtElapsed(ms: number | null): string {
  if (ms == null || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

/** Compact one-line pill for the machine list — icon + label + progress dot. */
export function MaintenanceBadge(props: MaintProps) {
  const s = summarizeMaintenance({
    maintStage: props.stage,
    maintNote: props.note,
    maintPct: props.pct,
    maintStartedAt: props.startedAt,
    maintUpdatedAt: props.updatedAt,
  });

  const tone = s.stale
    ? "text-amber-300 border-amber-500/40 bg-amber-500/10"
    : s.stage === "failed"
    ? "text-red-300 border-red-500/40 bg-red-500/10"
    : s.active
    ? "text-sky-300 border-sky-500/40 bg-sky-500/10"
    : s.stage === "done"
    ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
    : "text-gray-400 border-surface-border bg-white/5";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tone}`}>
      <span aria-hidden>{s.info.icon}</span>
      {s.stale ? "Maintenance stalled" : s.active ? `Maintenance · ${s.info.label}` : s.info.label}
      {s.active && !s.stale && <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />}
    </span>
  );
}

/** Full pipeline card for the machine detail page. */
export function MaintenanceIndicator(props: MaintProps) {
  // Re-tick relative times each 15s without a full page refresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const s = summarizeMaintenance({
    maintStage: props.stage,
    maintNote: props.note,
    maintPct: props.pct,
    maintStartedAt: props.startedAt,
    maintUpdatedAt: props.updatedAt,
  });

  const currentIdx = PIPELINE.indexOf(s.stage);
  const barColor = s.stale
    ? "bg-amber-400"
    : s.stage === "failed"
    ? "bg-red-400"
    : s.stage === "done"
    ? "bg-emerald-400"
    : "bg-brand";

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-surface-border text-lg" aria-hidden>
            {s.info.icon}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Self-heal &amp; maintenance</h3>
            <p className="text-[11px] text-gray-500">
              {props.enabled === false
                ? "Disabled — no scheduled pass"
                : `${scheduleLabel(props.startHour ?? 6, props.endHour ?? 8)} · unattended`}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div
            className={`text-sm font-semibold ${
              props.enabled === false
                ? "text-gray-500"
                : s.stale
                ? "text-amber-300"
                : s.stage === "failed"
                ? "text-red-300"
                : s.active
                ? "text-sky-300"
                : "text-gray-200"
            }`}
          >
            {props.enabled === false ? "Off" : s.stale ? "Stalled" : s.info.label}
          </div>
          {s.updatedAt && <div className="text-[11px] text-gray-500">updated {relTime(s.updatedAt)}</div>}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${s.progress}%` }}
        />
      </div>

      {/* Stage rail */}
      <ol className="mt-4 grid grid-cols-7 gap-1.5">
        {PIPELINE.map((stg, i) => {
          const info = STAGE_INFO[stg];
          const state =
            s.stage === "done"
              ? "done"
              : i < currentIdx
              ? "done"
              : i === currentIdx && s.active
              ? s.stale
                ? "stalled"
                : "active"
              : "todo";
          return <StageDot key={stg} icon={info.icon} label={info.label} state={state} />;
        })}
      </ol>

      {/* Note / current step blurb */}
      <p className="mt-4 text-xs text-gray-400">
        {s.note ? (
          <span className="text-gray-300">{s.note}</span>
        ) : (
          stageInfo(s.stage).blurb
        )}
        {s.active && s.elapsedMs != null && (
          <span className="text-gray-500"> · running {fmtElapsed(s.elapsedMs)}</span>
        )}
        {!s.active && s.stage === "done" && s.elapsedMs != null && (
          <span className="text-gray-500"> · last pass took {fmtElapsed(s.elapsedMs)}</span>
        )}
      </p>

      {s.stale && (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          The machine started a maintenance step but hasn&apos;t reported in a while — it may have
          restarted or lost connection mid-pass. It will resume on the next cycle.
        </p>
      )}
    </div>
  );
}

function StageDot({
  icon,
  label,
  state,
}: {
  icon: string;
  label: string;
  state: "done" | "active" | "todo" | "stalled";
}) {
  const ring =
    state === "done"
      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
      : state === "active"
      ? "border-sky-400/60 bg-sky-500/15 text-sky-200"
      : state === "stalled"
      ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
      : "border-surface-border bg-white/5 text-gray-500";
  return (
    <li className="flex flex-col items-center gap-1 text-center" title={label}>
      <span
        className={`relative grid h-8 w-8 place-items-center rounded-full border text-sm ${ring} ${
          state === "active" ? "pulse-dot" : ""
        }`}
      >
        {state === "done" ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3.5 w-3.5" aria-hidden>
            <path d="M5 12l5 5L20 7" />
          </svg>
        ) : (
          <span aria-hidden>{icon}</span>
        )}
      </span>
      <span className="w-full truncate text-[9px] leading-tight text-gray-500">{label}</span>
    </li>
  );
}
