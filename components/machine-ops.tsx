"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openControlSession, closeControlSession } from "@/lib/control";

type Entry = { name: string; dir: boolean; size?: number; mtime?: number };
const decText = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/**
 * File browser (list/upload/download) + live process list for a machine, over the
 * control-session bus. Only mounted when the machine is unlocked. One session
 * carries the request/response frames; output arrives on its SSE stream.
 */
export function MachineOps({ runnerId }: { runnerId: string }) {
  const [tab, setTab] = useState<"files" | "procs">("files");
  const [sessionId, setSessionId] = useState("");
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [procs, setProcs] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dlRef = useRef<{ name: string; chunks: Uint8Array[] } | null>(null);

  // Open the session + subscribe to its output once.
  useEffect(() => {
    let disposed = false;
    let es: EventSource | undefined;
    let cursor = 0;
    let sid = "";
    (async () => {
      let res;
      try {
        res = await openControlSession({ runnerId, kind: "file" });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Cannot open");
        return;
      }
      if (disposed) { closeControlSession(res.id).catch(() => {}); return; }
      sid = res.id;
      setSessionId(sid);
      const connect = () => {
        if (disposed) return;
        es = new EventSource(`/api/control/${sid}/stream?after=${cursor}`);
        es.addEventListener("msg", (ev) => {
          try {
            const m = JSON.parse((ev as MessageEvent).data) as { seq: number; kind: string; data: string };
            cursor = m.seq;
            if (m.kind === "ls") {
              const d = JSON.parse(m.data) as { path: string; entries: Entry[] };
              setCwd(d.path);
              setEntries(d.entries);
              setBusy(false);
            } else if (m.kind === "proc") {
              setProcs(decText(m.data));
              setBusy(false);
            } else if (m.kind === "file-chunk" && dlRef.current) {
              dlRef.current.chunks.push(Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)));
            } else if (m.kind === "file-eof" && dlRef.current) {
              const blob = new Blob(dlRef.current.chunks as BlobPart[]);
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = m.data || dlRef.current.name;
              a.click();
              URL.revokeObjectURL(a.href);
              dlRef.current = null;
              setBusy(false);
            } else if (m.kind === "error") {
              setErr(m.data);
              setBusy(false);
            }
          } catch { /* ignore */ }
        });
        es.onerror = () => { es?.close(); if (!disposed) setTimeout(connect, 800); };
      };
      connect();
      send(sid, { kind: "ls", data: JSON.stringify({ path: "" }) }); // home dir
    })();
    return () => {
      disposed = true;
      try { es?.close(); } catch { /* ignore */ }
      if (sid) closeControlSession(sid).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerId]);

  const send = (sid: string, msg: { kind: string; data: string }) =>
    fetch(`/api/control/${sid}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    }).catch(() => {});

  const go = useCallback((path: string) => {
    if (!sessionId) return;
    setErr(""); setBusy(true);
    send(sessionId, { kind: "ls", data: JSON.stringify({ path }) });
  }, [sessionId]);

  const download = (name: string) => {
    if (!sessionId) return;
    setErr(""); setBusy(true);
    dlRef.current = { name, chunks: [] };
    send(sessionId, { kind: "download", data: JSON.stringify({ path: joinPath(cwd, name) }) });
  };

  const refreshProcs = () => {
    if (!sessionId) return;
    setErr(""); setBusy(true);
    send(sessionId, { kind: "proc", data: "{}" });
  };

  const upload = async (file: File) => {
    if (!sessionId) return;
    setErr(""); setBusy(true);
    const dest = joinPath(cwd, file.name);
    send(sessionId, { kind: "file-open", data: JSON.stringify({ path: dest }) });
    const buf = new Uint8Array(await file.arrayBuffer());
    for (let i = 0; i < buf.length; i += 36000) {
      send(sessionId, { kind: "file-chunk", data: b64(buf.subarray(i, i + 36000)) });
    }
    send(sessionId, { kind: "file-eof", data: "" });
    setTimeout(() => { setBusy(false); go(cwd); }, 400);
  };

  return (
    <div className="rounded-lg border border-surface-border">
      <div className="flex items-center gap-1 border-b border-surface-border px-2 py-1.5 text-xs">
        <button onClick={() => setTab("files")} className={tab === "files" ? "rounded bg-white/10 px-2 py-1 text-white" : "px-2 py-1 text-gray-400"}>Files</button>
        <button onClick={() => { setTab("procs"); refreshProcs(); }} className={tab === "procs" ? "rounded bg-white/10 px-2 py-1 text-white" : "px-2 py-1 text-gray-400"}>Processes</button>
        {busy && <span className="ml-2 text-gray-500">…</span>}
        {err && <span className="ml-2 text-sev-crit">{err}</span>}
      </div>

      {tab === "files" ? (
        <div className="p-2">
          <div className="mb-2 flex items-center gap-2 font-mono text-xs text-gray-400">
            <button onClick={() => go(joinPath(cwd, ".."))} className="btn-ghost px-1.5 py-0.5">↑ up</button>
            <span className="truncate">{cwd || "~"}</span>
            <label className="btn-ghost ml-auto cursor-pointer px-1.5 py-0.5">
              ⬆ upload
              <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          </div>
          <div className="max-h-72 overflow-y-auto font-mono text-xs">
            {entries.map((en) => (
              <div key={en.name} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-white/5">
                {en.dir ? (
                  <button onClick={() => go(joinPath(cwd, en.name))} className="text-brand">📁 {en.name}/</button>
                ) : (
                  <>
                    <span className="text-gray-300">📄 {en.name}</span>
                    <span className="text-gray-600">{fmtSize(en.size)}</span>
                    <button onClick={() => download(en.name)} className="ml-auto text-gray-400 hover:text-white">⬇</button>
                  </>
                )}
              </div>
            ))}
            {entries.length === 0 && !busy && <div className="text-gray-600">empty</div>}
          </div>
        </div>
      ) : (
        <div className="p-2">
          <button onClick={refreshProcs} className="btn-ghost mb-2 px-1.5 py-0.5 text-xs">↻ refresh</button>
          <pre className="max-h-72 overflow-auto whitespace-pre rounded bg-black/40 p-2 font-mono text-[11px] leading-tight text-gray-300">{procs || "…"}</pre>
        </div>
      )}
    </div>
  );
}

function joinPath(base: string, name: string): string {
  if (name === "..") {
    const p = (base || "/").replace(/\/+$/, "");
    return p.slice(0, p.lastIndexOf("/")) || "/";
  }
  return `${(base || "").replace(/\/+$/, "")}/${name}`;
}
function fmtSize(n?: number): string {
  if (n == null) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1048576) return `${Math.round(n / 1024)}K`;
  return `${(n / 1048576).toFixed(1)}M`;
}
