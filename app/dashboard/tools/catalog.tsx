"use client";

import { useMemo, useState } from "react";
import type { SecurityTool } from "@/data/tools";

const LICENSE_STYLES: Record<SecurityTool["license"], string> = {
  "Open Source": "text-emerald-300 border-emerald-500/40",
  Freemium: "text-sky-300 border-sky-500/40",
  Paid: "text-amber-300 border-amber-500/40",
};

export function ToolCatalog({
  tools,
  categories,
}: {
  tools: SecurityTool[];
  categories: string[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((t) => {
      const matchesCategory = category === "All" || t.category === category;
      const matchesQuery =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.useCase.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [tools, query, category]);

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tools…"
          className="flex-1 rounded-lg border border-surface-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-surface-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand"
        >
          <option value="All">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        {filtered.length} of {tools.length} tools
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {filtered.map((t) => (
          <a
            key={t.name}
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            className="card transition hover:border-brand"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-white">{t.name}</h3>
              <span className={`tag ${LICENSE_STYLES[t.license]}`}>
                {t.license}
              </span>
            </div>
            <p className="mt-1 text-xs text-brand-glow">{t.category}</p>
            <p className="mt-2 text-sm text-gray-300">{t.description}</p>
            <p className="mt-2 text-xs text-gray-500">{t.useCase}</p>
          </a>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="mt-10 text-center text-sm text-gray-500">
          No tools match your search.
        </p>
      )}
    </div>
  );
}
