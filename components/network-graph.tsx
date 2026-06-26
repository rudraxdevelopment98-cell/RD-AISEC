"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { hostLabel, type NetworkHost } from "@/lib/network";

// Ports worth flagging — exposing these often warrants a closer look.
const RISKY = new Set([21, 23, 25, 135, 139, 445, 1433, 3306, 3389, 5432, 5900, 6379]);

const COLORS = {
  up: "#38bdf8", // sky — alive, no open ports
  open: "#10b981", // emerald — has open ports
  risky: "#f59e0b", // amber — has a sensitive port
  center: "#34d399",
  line: "rgba(148,163,184,0.25)",
  lineActive: "#34d399",
};

function hostColor(h: NetworkHost): string {
  if (h.ports.some((p) => RISKY.has(p.port))) return COLORS.risky;
  if (h.ports.length > 0) return COLORS.open;
  return COLORS.up;
}

function truncate(s: string, n = 16): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

const W = 760;
const H = 560;
const CX = W / 2;
const CY = H / 2;

export function NetworkGraph({
  hosts,
  subnet,
}: {
  hosts: NetworkHost[];
  subnet: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  // Radial layout — one ring for small sets, two concentric rings when crowded.
  const positions = useMemo(() => {
    const n = hosts.length;
    const twoRings = n > 18;
    const outer: number[] = [];
    const inner: number[] = [];
    hosts.forEach((_, i) => (twoRings && i % 2 ? inner : outer).push(i));

    const place = (idxs: number[], r: number) => {
      const pos: Record<number, { x: number; y: number }> = {};
      idxs.forEach((idx, k) => {
        const a = (k / Math.max(1, idxs.length)) * 2 * Math.PI - Math.PI / 2;
        pos[idx] = { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
      });
      return pos;
    };

    const Router = Math.min(235, 110 + n * 4);
    return { ...place(outer, Router), ...place(inner, Router * 0.6) };
  }, [hosts]);

  const sel = selected != null ? hosts[selected] : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="card overflow-hidden p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
          {/* edges */}
          {hosts.map((_, i) => {
            const p = positions[i];
            if (!p) return null;
            const active = selected === i;
            return (
              <line
                key={`l${i}`}
                x1={CX}
                y1={CY}
                x2={p.x}
                y2={p.y}
                stroke={active ? COLORS.lineActive : COLORS.line}
                strokeWidth={active ? 1.5 : 1}
              />
            );
          })}

          {/* center / subnet node */}
          <circle cx={CX} cy={CY} r={26} fill={COLORS.center} opacity={0.18} />
          <circle cx={CX} cy={CY} r={16} fill={COLORS.center} />
          <text
            x={CX}
            y={CY + 42}
            textAnchor="middle"
            className="fill-gray-300"
            fontSize="13"
            fontFamily="monospace"
          >
            {truncate(subnet || "scan", 22)}
          </text>

          {/* host nodes */}
          {hosts.map((h, i) => {
            const p = positions[i];
            if (!p) return null;
            const r = Math.max(6, Math.min(20, 6 + h.ports.length * 1.6));
            const active = selected === i;
            const isGw = (h.ip ?? "").endsWith(".1");
            return (
              <g
                key={`h${i}`}
                onClick={() => setSelected(active ? null : i)}
                className="cursor-pointer"
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={active ? r + 4 : r}
                  fill={hostColor(h)}
                  stroke={active ? "#fff" : isGw ? "#34d399" : "rgba(0,0,0,0.4)"}
                  strokeWidth={active ? 2 : isGw ? 2 : 1}
                />
                {isGw && (
                  <text
                    x={p.x}
                    y={p.y + r + 12}
                    textAnchor="middle"
                    fontSize="9"
                    className="fill-emerald-300"
                  >
                    gateway
                  </text>
                )}
                {h.ports.length > 0 && (
                  <text
                    x={p.x}
                    y={p.y + 4}
                    textAnchor="middle"
                    fontSize="10"
                    className="fill-black/80"
                    fontWeight="bold"
                  >
                    {h.ports.length}
                  </text>
                )}
                <text
                  x={p.x}
                  y={p.y - r - 6}
                  textAnchor="middle"
                  fontSize="11"
                  className="fill-gray-400"
                  fontFamily="monospace"
                >
                  {truncate(h.host)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* legend */}
        <div className="flex flex-wrap items-center gap-4 px-3 pb-2 pt-1 text-xs text-gray-400">
          <Legend color={COLORS.open} label="open ports" />
          <Legend color={COLORS.risky} label="sensitive port" />
          <Legend color={COLORS.up} label="alive, no open ports" />
          <span className="text-gray-600">node size = open-port count · tap a host</span>
        </div>
      </div>

      {/* detail panel */}
      <div className="card">
        {sel ? (
          <>
            <div className="flex items-center gap-2">
              <Icon name="server" className="h-4 w-4 text-brand" />
              <h3 className="truncate font-mono font-semibold text-white">{hostLabel(sel)}</h3>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {sel.ports.length} open port{sel.ports.length === 1 ? "" : "s"}
            </p>
            {sel.ports.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">Host is up; no open ports found.</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {sel.ports
                  .slice()
                  .sort((a, b) => a.port - b.port)
                  .map((p) => (
                    <li
                      key={`${p.port}/${p.proto}`}
                      className="flex items-center justify-between rounded-md border border-surface-border bg-black/30 px-2 py-1 text-xs"
                    >
                      <span className="font-mono text-gray-200">
                        {p.port}/{p.proto}
                        {RISKY.has(p.port) && (
                          <span className="ml-1 text-amber-400">●</span>
                        )}
                      </span>
                      <span className="truncate pl-2 text-gray-400">
                        {p.service}
                        {p.version ? ` · ${p.version}` : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-500">
            Tap a host in the map to see its open ports and services.
          </p>
        )}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
