"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import type { TopicMeta } from "@/lib/knowledge";

export function KnowledgeList({ topics }: { topics: TopicMeta[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [topics, query]);

  const categories = useMemo(
    () => Array.from(new Set(filtered.map((t) => t.category))).sort(),
    [filtered],
  );

  return (
    <div className="mt-6">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search topics…"
        className="w-full rounded-lg border border-surface-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand"
      />
      <p className="mt-2 text-xs text-gray-500">
        {filtered.length} of {topics.length} topics
      </p>

      {categories.map((cat) => (
        <section key={cat} className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            {cat}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {filtered
              .filter((t) => t.category === cat)
              .map((t) => (
                <Link
                  key={t.slug}
                  href={`/dashboard/knowledge/${t.slug}`}
                  className="card-hover"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-white">{t.title}</h3>
                    <Icon name="arrow" className="h-4 w-4 shrink-0 text-brand" />
                  </div>
                  {t.summary && (
                    <p className="mt-1 text-sm text-gray-400">{t.summary}</p>
                  )}
                </Link>
              ))}
          </div>
        </section>
      ))}

      {filtered.length === 0 && (
        <p className="mt-10 text-center text-sm text-gray-500">
          No topics match your search.
        </p>
      )}
    </div>
  );
}
