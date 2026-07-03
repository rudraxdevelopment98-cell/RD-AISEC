"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { queueCustomJob } from "@/lib/runners";

// Quick commands that need no target — verify the machine and its tools fast.
// Grouped so the console reads like a real ops panel. The runner executes argv
// via shlex (no shell), queued only by your authenticated session.
const PRESETS: { group: string; cmds: string[] }[] = [
  {
    group: "System",
    cmds: ["whoami", "id", "uname -a", "cat /etc/os-release", "uptime", "df -h", "free -h"],
  },
  {
    group: "Network",
    cmds: ["hostname -I", "ip -brief address", "ip route", "cat /etc/resolv.conf"],
  },
  {
    group: "Tool check",
    cmds: [
      "nmap --version",
      "nuclei -version",
      "httpx -version",
      "gobuster version",
      "sqlmap --version",
      "nikto -Version",
      "which nmap nuclei httpx gobuster sqlmap",
    ],
  },
];

export function MachineConsole({
  runnerId,
  online,
}: {
  runnerId: string;
  online: boolean;
}) {
  const [cmd, setCmd] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const back = `/dashboard/runners/${runnerId}`;

  return (
    <div>
      <form action={queueCustomJob} className="space-y-2">
        <input type="hidden" name="runnerId" value={runnerId} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="confirm" value={authorized ? "true" : ""} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            name="command"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder="Run any command on this machine, e.g. nmap -sV -Pn scanme.nmap.org"
            className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-brand"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-400">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(e) => setAuthorized(e.target.checked)}
                className="h-3.5 w-3.5 accent-emerald-500"
              />
              Authorized
            </label>
            <button
              className="btn-primary px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!cmd.trim() || !authorized}
              title={!online ? "Machine is offline — the command will run once it reconnects" : undefined}
            >
              ▶ Run
            </button>
          </div>
        </div>
      </form>

      {/* Quick commands */}
      <div className="mt-3 space-y-2">
        {PRESETS.map((p) => (
          <div key={p.group} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {p.group}
            </span>
            {p.cmds.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCmd(c)}
                className="rounded-md border border-surface-border bg-black/20 px-2 py-1 font-mono text-[11px] text-gray-300 hover:border-brand hover:text-white"
              >
                {c}
              </button>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-600">
        Runs as one argv (no shell) on this machine only. Output appears under
        Recent jobs below and on the Jobs page. Authorized targets only.
      </p>
    </div>
  );
}
