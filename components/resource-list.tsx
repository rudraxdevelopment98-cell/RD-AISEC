"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { OpenFromDriveButton } from "@/components/drive";
import { deleteResource } from "@/lib/resources";
import { RESOURCE_TYPES } from "@/lib/resource-constants";

export type ResourceItem = {
  id: string;
  title: string;
  type: string;
  url: string;
  location: string;
  tags: string;
  notes: string;
  engagementName: string | null;
};

const TYPE_STYLE: Record<string, string> = {
  link: "border-sky-500/40 text-sky-300",
  book: "border-amber-500/40 text-amber-300",
  exploit: "border-red-500/40 text-red-300",
  tool: "border-emerald-500/40 text-emerald-300",
  cheatsheet: "border-violet-500/40 text-violet-300",
  other: "border-gray-500/40 text-gray-300",
};

function CopyLocation({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-surface-border bg-black/40 px-2 py-1 font-mono text-xs text-gray-300 hover:border-brand"
      title="Copy drive location"
    >
      <Icon name={copied ? "check" : "lock"} className="h-3 w-3" />
      {value}
    </button>
  );
}

export function ResourceList({ resources }: { resources: ResourceItem[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resources.filter((r) => {
      const matchesType = type === "All" || r.type === type;
      const matchesQuery =
        !q ||
        r.title.toLowerCase().includes(q) ||
        r.tags.toLowerCase().includes(q) ||
        r.notes.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q);
      return matchesType && matchesQuery;
    });
  }, [resources, query, type]);

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search resources…"
          className="flex-1 rounded-lg border border-surface-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-lg border border-surface-border bg-surface px-4 py-2.5 text-sm capitalize outline-none focus:border-brand"
        >
          <option value="All">All types</option>
          {RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {filtered.length} of {resources.length} resources
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {filtered.map((r) => (
          <div key={r.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-white">{r.title}</h3>
              <span className={`tag capitalize ${TYPE_STYLE[r.type] ?? TYPE_STYLE.other}`}>
                {r.type}
              </span>
            </div>

            {r.notes && <p className="mt-1 text-sm text-gray-400">{r.notes}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {r.url && (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost px-2 py-1 text-xs"
                >
                  <Icon name="arrow" className="h-3 w-3" /> Open link
                </a>
              )}
              {r.location && <CopyLocation value={r.location} />}
              {r.location && <OpenFromDriveButton location={r.location} />}
            </div>

            {(r.tags || r.engagementName) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {r.tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                {r.engagementName && (
                  <span className="tag ring-emerald accent-emerald">
                    <Icon name="briefcase" className="h-3 w-3" /> {r.engagementName}
                  </span>
                )}
              </div>
            )}

            <form action={deleteResource} className="mt-3">
              <input type="hidden" name="id" value={r.id} />
              <button type="submit" className="text-xs text-gray-600 hover:text-red-400">
                Remove
              </button>
            </form>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="mt-10 text-center text-sm text-gray-500">
          No resources yet. Add one above — links open directly; offline items
          store a drive location you keep on your external drive.
        </p>
      )}
    </div>
  );
}
