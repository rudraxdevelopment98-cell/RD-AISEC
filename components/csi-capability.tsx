"use client";

import { useState } from "react";
import { csiCapability, CSI_CHIPSETS } from "@/lib/csi-capability";

/**
 * In-app "can my WiFi card do CSI?" checker. CSI depends on the RECEIVER chipset
 * + toolchain, not the access point — so pick your laptop/adapter's chipset and
 * get an honest verdict + the toolchain (and how to find your chipset).
 */
export function CsiCapability() {
  const [chip, setChip] = useState("ax210");
  const v = csiCapability(chip === "other" ? "" : chip);

  return (
    <details className="card mt-4">
      <summary className="cursor-pointer text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
        📡 Can my WiFi do CSI? (angle-of-arrival / pose / multi-person)
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-xs text-gray-500">
          CSI comes from the card doing the measuring — <b>not</b> the access point. Any AP works as
          the transmitter; your laptop/adapter&apos;s chipset decides if CSI is possible.
        </p>
        <label className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
          My WiFi chipset
          <select
            value={chip}
            onChange={(e) => setChip(e.target.value)}
            className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-sm outline-none focus:border-brand"
          >
            {CSI_CHIPSETS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>

        <div className={`rounded-xl border px-4 py-3 ${v.supported ? "border-brand/40 bg-brand/10" : "border-sev-med/40 bg-sev-med/10"}`}>
          <p className={`flex flex-wrap items-center gap-2 font-medium ${v.supported ? "text-brand" : "text-sev-med"}`}>
            {v.supported ? "✓ CSI supported" : "✗ No CSI on this chip"}
            {v.supported && <span className="tag border-brand/40 text-brand">{v.tool}</span>}
            <span className="tag">{v.antennas} antenna{v.antennas > 1 ? "s" : ""}{v.antennas >= 2 ? " · AoA possible" : " · no bearing"}</span>
          </p>
          <p className="mt-2 text-xs text-gray-300">{v.note}</p>
        </div>

        <p className="text-[11px] text-gray-500">
          Find your exact chipset on the machine: <code className="font-mono">lspci -k | grep -A3 -i net</code>{" "}
          (built-in) or <code className="font-mono">lsusb</code> (USB), and{" "}
          <code className="font-mono">ethtool -i wlan0</code> for the driver.
        </p>
      </div>
    </details>
  );
}
