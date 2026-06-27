"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { SeverityBadge, FindingStatusBadge } from "@/components/badges";
import { FrameworkBadges } from "@/components/framework-badges";
import { bulkDeleteFindings, bulkSetStatus, bulkSetCategory } from "@/lib/finding-actions";

export type FindingRow = {
  id: string;
  title: string;
  severity: string;
  status: string;
  attack: string;
  owasp: string;
  confirmed: boolean;
  category: string;
  engagementId: string;
  engagementName: string | null;
};

const STATUSES = ["open", "fixed", "accepted", "false_positive"];

export function FindingsBulk({ findings }: { findings: FindingRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [status, setStatus] = useState("fixed");
  const [category, setCategory] = useState("");

  const toggle = (id: string) =>
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  function run(action: (fd: FormData) => Promise<void>, extra?: Record<string, string>) {
    const fd = new FormData();
    selected.forEach((id) => fd.append("ids", id));
    if (extra) for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    start(async () => {
      await action(fd);
      setSelected(new Set());
    });
  }

  return (
    <div className="mt-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-surface-card/40 p-2 text-xs">
        <label className="flex items-center gap-1.5 text-gray-400">
          <input
            type="checkbox"
            checked={findings.length > 0 && findings.every((f) => selected.has(f.id))}
            onChange={(e) => setSelected(e.target.checked ? new Set(findings.map((f) => f.id)) : new Set())}
          />
          Select all
        </label>
        <span className="text-gray-600">{selected.size} selected</span>
        {selected.size > 0 && (
          <>
            <span className="text-gray-700">·</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-surface-border bg-surface px-2 py-1 capitalize outline-none focus:border-brand">
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
            <button disabled={pending} onClick={() => run(bulkSetStatus, { status })} className="btn-ghost px-2 py-1">Set status</button>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="category" className="w-28 rounded-md border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand" />
            <button disabled={pending} onClick={() => run(bulkSetCategory, { category })} className="btn-ghost px-2 py-1">Tag</button>
            <button
              disabled={pending}
              onClick={() => { if (confirm(`Delete ${selected.size} finding(s)?`)) run(bulkDeleteFindings); }}
              className="rounded-md border border-red-500/40 px-2 py-1 text-red-300 hover:bg-red-500/10"
            >
              Delete
            </button>
            <button onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-300">Clear</button>
          </>
        )}
      </div>

      {/* Cards */}
      <div className="mt-3 space-y-3">
        {findings.map((f) => (
          <div key={f.id} className={`card ${f.confirmed ? "glow-danger" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(f.id)}
                  onChange={() => toggle(f.id)}
                  className="mt-1 shrink-0"
                  aria-label="Select finding"
                />
                <Link href={`/dashboard/engagements/${f.engagementId}`} className="font-semibold text-white hover:text-brand">
                  {f.title}
                </Link>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {f.confirmed && <span className="tag border-red-500/50 text-red-300">✅ confirmed</span>}
                {f.category && <span className="tag">{f.category}</span>}
                <SeverityBadge value={f.severity} />
                <FindingStatusBadge value={f.status} />
              </div>
            </div>
            <FrameworkBadges attack={f.attack} owasp={f.owasp} className="mt-2 pl-6" linked />
            <div className="mt-2 flex items-center gap-1 pl-6 text-xs text-gray-500">
              <Icon name="briefcase" className="h-3 w-3" />
              <Link href={`/dashboard/engagements/${f.engagementId}`} className="hover:text-gray-300">
                {f.engagementName ?? "Unknown engagement"}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
