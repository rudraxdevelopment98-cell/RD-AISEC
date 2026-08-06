"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { MachineOps } from "@/components/machine-ops";

// xterm needs the DOM — load it client-only, scoped to this panel so its weight
// never hits other pages.
const MachineTerminal = dynamic(
  () => import("@/components/machine-terminal").then((m) => m.MachineTerminal),
  { ssr: false, loading: () => <div className="text-xs text-gray-500">loading terminal…</div> },
);

export function MachineControlPanel({ runnerId, unlocked }: { runnerId: string; unlocked: boolean }) {
  const [open, setOpen] = useState(false);
  const [asRoot, setAsRoot] = useState(false);
  const [instance, setInstance] = useState(0);

  if (!unlocked) {
    return (
      <p className="text-xs text-gray-500">
        🔒 Locked. Unlock full control above to open an interactive terminal, browse
        files, list processes, control services, or install packages on this machine.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!open ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => { setInstance((i) => i + 1); setOpen(true); }}
            className="btn-primary text-xs"
          >
            Open terminal
          </button>
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={asRoot}
              onChange={(e) => setAsRoot(e.target.checked)}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            Run as root
          </label>
        </div>
      ) : (
        <div className="space-y-2">
          <MachineTerminal key={instance} runnerId={runnerId} asRoot={asRoot} />
          <button onClick={() => setOpen(false)} className="btn-ghost text-xs">
            Close terminal
          </button>
        </div>
      )}

      {/* Files + processes, always available while unlocked. */}
      <MachineOps runnerId={runnerId} />
    </div>
  );
}
