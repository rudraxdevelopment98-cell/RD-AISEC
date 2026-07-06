"use client";

import { useState } from "react";
import type { Device } from "@/lib/devices-core";

export type DeviceMachine = { id: string; name: string };

/**
 * "What's on my WiFi" — runs a real LAN discovery on a connected machine and
 * lists the devices (IP / MAC / vendor / type). This is the honest answer to
 * "who's connected", kept SEPARATE from motion sensing: these are devices on the
 * network, not detected people.
 */
export function WifiDevices({ machines }: { machines: DeviceMachine[] }) {
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [status, setStatus] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [summary, setSummary] = useState<{ total: number; byType: { type: string; count: number }[] } | null>(null);

  async function scan() {
    if (!machineId) { setStatus("error"); setMsg("Connect a machine first."); return; }
    setStatus("scanning"); setMsg(""); setDevices([]); setSummary(null);
    try {
      const res = await fetch("/api/sensing/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runnerId: machineId }),
      });
      const d = await res.json();
      if (!res.ok || !d.jobId) { setStatus("error"); setMsg(d.error ?? "Couldn't start scan."); return; }
      const started = Date.now();
      const poll = async () => {
        try {
          const r = await fetch(`/api/sensing/devices?job=${d.jobId}`, { cache: "no-store" }).then((x) => x.json());
          if (r.status === "done") {
            setDevices(r.devices ?? []);
            setSummary(r.summary ?? null);
            setStatus("done");
            return;
          }
          if (r.status === "failed" || r.status === "canceled") { setStatus("error"); setMsg(r.status); return; }
          if (Date.now() - started > 120000) { setStatus("error"); setMsg("Timed out."); return; }
          setTimeout(poll, 2000);
        } catch { setTimeout(poll, 2500); }
      };
      setTimeout(poll, 2500);
    } catch { setStatus("error"); setMsg("Network error."); }
  }

  return (
    <div className="card mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-white">Devices on this network</span>
        <span className="text-xs text-gray-500">real LAN scan · devices ≠ people</span>
        {machines.length > 0 ? (
          <div className="ml-auto flex items-center gap-2">
            <select
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
            >
              {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button onClick={scan} disabled={status === "scanning"} className="btn-primary text-xs disabled:opacity-60">
              {status === "scanning" ? "Scanning…" : "Scan devices"}
            </button>
          </div>
        ) : (
          <span className="ml-auto text-xs text-amber-300">Connect a machine to scan the LAN</span>
        )}
      </div>

      {msg && <p className="mt-2 text-xs text-amber-300">{msg}</p>}

      {summary && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="tag border-brand/40 text-brand">{summary.total} devices</span>
          {summary.byType.map((t) => (
            <span key={t.type} className="tag">{t.type}: {t.count}</span>
          ))}
        </div>
      )}

      {devices.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-1.5 pr-3">IP</th>
                <th className="py-1.5 pr-3">MAC</th>
                <th className="py-1.5 pr-3">Vendor</th>
                <th className="py-1.5 pr-3">Type</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {devices.map((d) => (
                <tr key={d.ip} className="border-t border-surface-border">
                  <td className="py-1.5 pr-3 font-mono text-xs">{d.ip}</td>
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-gray-500">{d.mac || "—"}</td>
                  <td className="py-1.5 pr-3">{d.vendor || "Unknown"}</td>
                  <td className="py-1.5 pr-3">{d.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-gray-500">
            MAC + vendor need the scan to run as root; without it you still get IPs. This lists network
            devices — it does not detect or count people.
          </p>
        </div>
      )}
    </div>
  );
}
