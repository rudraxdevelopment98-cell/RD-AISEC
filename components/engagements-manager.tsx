"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { EngagementStatusBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import {
  bulkDeleteEngagements,
  bulkSetEngagementCategory,
  bulkSetEngagementStatus,
  bulkSetEngagementType,
} from "@/lib/engagements";

export type EngagementRow = {
  id: string;
  name: string;
  client: string;
  type: string;
  status: string;
  category: string;
  scope: string;
  authorized: boolean;
  findingCount: number;
};

const TYPE_ICON: Record<string, string> = {
  pentest: "target",
  forensics: "fingerprint",
  consulting: "briefcase",
};
const TYPES = ["pentest", "forensics", "consulting"];
const STATUSES = ["planning", "active", "completed"];

export function EngagementsManager({ engagements }: { engagements: EngagementRow[] }) {
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState("");
  const [activeType, setActiveType] = useState("");
  const [activeStatus, setActiveStatus] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const [bulkStatus, setBulkStatus] = useState("active");
  const [bulkType, setBulkType] = useState("pentest");

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const e of engagements) if (e.category) s.add(e.category);
    return [...s].sort();
  }, [engagements]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return engagements.filter((e) => {
      if (activeCat && e.category !== activeCat) return false;
      if (activeType && e.type !== activeType) return false;
      if (activeStatus && e.status !== activeStatus) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.client.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        e.scope.toLowerCase().includes(q)
      );
    });
  }, [engagements, query, activeCat, activeType, activeStatus]);

  const toggle = (id: string) =>
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((e) => selected.has(e.id));

  function withSelection(extra?: Record<string, string>) {
    return (
      <>
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="ids" value={id} />
        ))}
        {extra &&
          Object.entries(extra).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
      </>
    );
  }

  function ChipBtn({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) {
    return (
      <button
        onClick={onClick}
        className={`tag capitalize ${active ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}
      >
        {children}
      </button>
    );
  }

  return (
    <div>
      {/* Action bar */}
      <div className="space-y-2 rounded-lg border border-surface-border bg-surface-card/40 p-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative min-w-[180px] flex-1">
            <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search engagements by name, client, category, scope…"
              className="w-full rounded-md border border-surface-border bg-surface py-1.5 pl-7 pr-2 outline-none focus:border-brand"
            />
          </div>
          <label className="flex items-center gap-1.5 text-gray-400">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(visible.map((x) => x.id)) : new Set())
              }
            />
            Select all
          </label>
          <span className="text-gray-600">{selected.size} selected</span>
        </div>

        {/* Type filter */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-500">Type</span>
          <ChipBtn active={activeType === ""} onClick={() => setActiveType("")}>all</ChipBtn>
          {TYPES.map((t) => (
            <ChipBtn key={t} active={activeType === t} onClick={() => setActiveType(activeType === t ? "" : t)}>
              {t}
            </ChipBtn>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-500">Status</span>
          <ChipBtn active={activeStatus === ""} onClick={() => setActiveStatus("")}>all</ChipBtn>
          {STATUSES.map((s) => (
            <ChipBtn key={s} active={activeStatus === s} onClick={() => setActiveStatus(activeStatus === s ? "" : s)}>
              {s}
            </ChipBtn>
          ))}
        </div>

        {/* Category filter (platform / manual) */}
        {categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-gray-500">Category</span>
            <ChipBtn active={activeCat === ""} onClick={() => setActiveCat("")}>all</ChipBtn>
            {categories.map((c) => (
              <ChipBtn key={c} active={activeCat === c} onClick={() => setActiveCat(activeCat === c ? "" : c)}>
                {c}
              </ChipBtn>
            ))}
          </div>
        )}

        {/* Bulk operations */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-2 text-xs">
            <form action={bulkSetEngagementCategory} className="flex items-center gap-1">
              {withSelection({ category: bulkCat })}
              <input
                value={bulkCat}
                onChange={(e) => setBulkCat(e.target.value)}
                placeholder="category"
                className="w-28 rounded-md border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand"
              />
              <button className="btn-ghost px-2 py-1">Tag</button>
            </form>
            <form action={bulkSetEngagementStatus} className="flex items-center gap-1">
              {withSelection({ status: bulkStatus })}
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                className="rounded-md border border-surface-border bg-surface px-2 py-1 capitalize outline-none focus:border-brand"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="btn-ghost px-2 py-1">Set status</button>
            </form>
            <form action={bulkSetEngagementType} className="flex items-center gap-1">
              {withSelection({ type: bulkType })}
              <select
                value={bulkType}
                onChange={(e) => setBulkType(e.target.value)}
                className="rounded-md border border-surface-border bg-surface px-2 py-1 capitalize outline-none focus:border-brand"
              >
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button className="btn-ghost px-2 py-1">Set type</button>
            </form>
            <form
              action={bulkDeleteEngagements}
              onSubmit={(e) => {
                if (!confirm(`Delete ${selected.size} engagement(s) and their findings?`)) e.preventDefault();
              }}
            >
              {withSelection()}
              <button className="rounded-md border border-red-500/40 px-2 py-1 text-red-300 hover:bg-red-500/10">
                Delete
              </button>
            </form>
            <button onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-300">Clear</button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="mt-4 space-y-3">
        {engagements.length === 0 ? (
          <EmptyState icon="briefcase" title="No engagements yet">
            Create your first engagement above — a pentest, forensics case, or
            consulting job. Findings, scans, and reports all live inside one.
          </EmptyState>
        ) : visible.length === 0 ? (
          <p className="card text-sm text-gray-500">No engagements match your search/filter.</p>
        ) : (
          visible.map((e) => (
            <div key={e.id} className="card-hover flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(e.id)}
                  onChange={() => toggle(e.id)}
                  className="shrink-0"
                  aria-label="Select engagement"
                />
                <Link href={`/dashboard/engagements/${e.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-surface-border text-brand">
                    <Icon name={TYPE_ICON[e.type] ?? "target"} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-semibold text-white">
                      {e.name}
                      {e.category && <span className="tag shrink-0 text-[10px]">{e.category}</span>}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      <span className="capitalize">{e.type}</span> · {e.client || "—"} ·{" "}
                      {e.findingCount} finding{e.findingCount === 1 ? "" : "s"}
                      {!e.authorized && <span className="ml-2 text-amber-400">⚠ unauthorized</span>}
                    </p>
                  </div>
                </Link>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <EngagementStatusBadge value={e.status} />
                <Link
                  href={`/dashboard/engagements/${e.id}/edit`}
                  className="text-xs text-gray-500 hover:text-brand"
                  title="Edit engagement"
                >
                  Edit
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
