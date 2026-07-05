"use client";

import { useState } from "react";
import { addBugProgram } from "@/lib/bugbounty";
import { BUG_PLATFORMS } from "@/lib/bugbounty-core";

const FIELD =
  "rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand";

/**
 * "Add a program" form with one-click scope auto-fill from the program link.
 * HackerOne uses the saved API token for exact scope; Bugcrowd and other
 * platforms are scraped best-effort (targets to review). Submits via the
 * addBugProgram server action.
 */
export function AddProgramForm() {
  const [platform, setPlatform] = useState("hackerone");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState("");
  const [outScope, setOutScope] = useState("");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  async function autofill() {
    if (!url.trim()) {
      setNote({ kind: "warn", text: "Paste a program link first." });
      return;
    }
    setLoading(true);
    setNote(null);
    try {
      const res = await fetch("/api/bugbounty/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote({ kind: "err", text: data?.error ?? "Couldn't read scope from that link." });
        return;
      }
      if (data.platform && data.platform !== "other") setPlatform(data.platform);
      if (data.name && !name.trim()) setName(String(data.name).slice(0, 120));
      const ins: string[] = Array.isArray(data.inScope) ? data.inScope : [];
      const outs: string[] = Array.isArray(data.outScope) ? data.outScope : [];
      if (ins.length) setScope(ins.join("\n"));
      if (outs.length) setOutScope(outs.join("\n"));
      const found = ins.length + outs.length;
      if (found > 0) {
        setNote({
          kind: data.source === "hackerone-api" ? "ok" : "warn",
          text:
            `Filled ${ins.length} in-scope · ${outs.length} out-of-scope` +
            (data.source === "hackerone-api"
              ? " from the HackerOne API."
              : " — scraped from the page, review before scanning."),
        });
      } else {
        setNote({ kind: "warn", text: data?.note ?? "No scope detected — paste it manually." });
      }
    } catch {
      setNote({ kind: "err", text: "Network error fetching scope." });
    } finally {
      setLoading(false);
    }
  }

  const noteColor =
    note?.kind === "err" ? "text-red-300" : note?.kind === "warn" ? "text-amber-300" : "text-emerald-300";

  return (
    <form action={addBugProgram} className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <select name="platform" value={platform} onChange={(e) => setPlatform(e.target.value)} className={FIELD}>
          {BUG_PLATFORMS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Program name"
          className={FIELD}
        />
      </div>

      {/* Link + auto-fill */}
      <div className="flex flex-wrap gap-2">
        <input
          name="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Program/brief link (HackerOne, Bugcrowd, Intigriti, YesWeHack…)"
          className={`min-w-[12rem] flex-1 ${FIELD}`}
        />
        <button
          type="button"
          onClick={autofill}
          disabled={loading}
          className="btn-ghost shrink-0 whitespace-nowrap text-sm disabled:opacity-60"
        >
          {loading ? "Reading…" : "🪄 Auto-fill scope"}
        </button>
      </div>
      {note && <p className={`text-xs ${noteColor}`}>{note.text}</p>}
      <p className="text-[11px] text-gray-500">
        Paste the program link and Auto-fill pulls its in/out-of-scope. HackerOne is exact
        (needs your API token on the Accounts tab); Bugcrowd &amp; others are read from the
        public page — always review the targets before scanning.
      </p>

      <div>
        <label className="text-xs font-semibold text-gray-400">In-scope targets (one per line)</label>
        <textarea
          name="scope"
          rows={4}
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          placeholder={"*.example.com\napi.example.com\nexample.com"}
          className={`mt-1 w-full font-mono ${FIELD}`}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-semibold text-gray-400">Out of scope (one per line)</label>
          <textarea
            name="outScope"
            rows={2}
            value={outScope}
            onChange={(e) => setOutScope(e.target.value)}
            placeholder="admin.example.com"
            className={`mt-1 w-full font-mono ${FIELD}`}
          />
        </div>
        <div className="flex flex-col gap-3 sm:pt-5">
          <input name="reward" placeholder="Rewards (e.g. up to $5,000)" className={FIELD} />
          <input name="category" placeholder="Category (e.g. web, mobile, priority)" className={FIELD} />
        </div>
      </div>
      <button className="btn-primary text-sm">Add program</button>
    </form>
  );
}
