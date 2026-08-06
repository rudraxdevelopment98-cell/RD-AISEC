"use client";

import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { openControlSession, closeControlSession } from "@/lib/control";

type Props = { runnerId: string; asRoot?: boolean };

// base64 <-> bytes helpers (browser).
const encB64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const decBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * A live interactive terminal (PTY) to a machine, streamed over the control
 * channel: keystrokes POST to /input, output arrives via the SSE /stream. Requires
 * the machine to be unlocked (the server actions + input route enforce it).
 */
export function MachineTerminal({ runnerId, asRoot = false }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | undefined;
    let es: EventSource | undefined;
    let sessionId = "";
    let cursor = 0;
    let ro: ResizeObserver | undefined;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !holder.current) return;
      term = new Terminal({
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        cursorBlink: true,
        theme: { background: "#0a0e14", foreground: "#d7dce2" },
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(holder.current);
      try { fit.fit(); } catch { /* ignore */ }

      let res: { id: string };
      try {
        res = await openControlSession({
          runnerId, kind: "pty", cols: term.cols, rows: term.rows, asRoot,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Cannot open terminal");
        setStatus("error");
        return;
      }
      if (disposed) { closeControlSession(res.id).catch(() => {}); return; }
      sessionId = res.id;
      setStatus("open");

      const post = (msg: { kind: string; data: string }) =>
        fetch(`/api/control/${sessionId}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(msg),
        }).catch(() => {});

      term.onData((d) => post({ kind: "data", data: encB64(d) }));
      term.onResize(({ cols, rows }) => post({ kind: "resize", data: JSON.stringify({ cols, rows }) }));

      const connect = () => {
        if (disposed) return;
        es = new EventSource(`/api/control/${sessionId}/stream?after=${cursor}`);
        es.addEventListener("msg", (ev) => {
          try {
            const m = JSON.parse((ev as MessageEvent).data) as { seq: number; kind: string; data: string };
            cursor = m.seq;
            if (m.kind === "data") term?.write(decBytes(m.data));
            else if (m.kind === "exit") { term?.writeln("\r\n\x1b[90m[session ended]\x1b[0m"); setStatus("closed"); es?.close(); }
          } catch { /* ignore bad frame */ }
        });
        es.addEventListener("closed", () => es?.close());
        es.onerror = () => { es?.close(); if (!disposed && status !== "closed") setTimeout(connect, 800); };
      };
      connect();

      ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* ignore */ } });
      ro.observe(holder.current);
    })();

    return () => {
      disposed = true;
      try { ro?.disconnect(); } catch { /* ignore */ }
      try { es?.close(); } catch { /* ignore */ }
      if (sessionId) {
        // Tell the runner to tear down the PTY now (keepalive so it sends during
        // unload); the idle reaper is the backstop if this never lands.
        fetch(`/api/control/${sessionId}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "close", data: "" }),
          keepalive: true,
        }).catch(() => {});
        closeControlSession(sessionId).catch(() => {});
      }
      try { term?.dispose(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerId, asRoot]);

  return (
    <div className="rounded-lg border border-surface-border bg-[#0a0e14] p-2">
      <div className="mb-1 flex items-center justify-between px-1 text-xs text-gray-400">
        <span>
          {status === "open" && <span className="text-emerald-400">● live</span>}
          {status === "connecting" && "connecting…"}
          {status === "closed" && <span className="text-gray-500">● ended</span>}
          {status === "error" && <span className="text-sev-crit">● {error}</span>}
          {asRoot && status === "open" && <span className="ml-2 text-amber-400">root</span>}
        </span>
        <span className="text-gray-600">interactive terminal</span>
      </div>
      <div ref={holder} style={{ height: 420 }} />
    </div>
  );
}
