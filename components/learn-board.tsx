"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { LEARN_CATEGORIES, type LearnTopic } from "@/data/learn";
import { setLearnStatus } from "@/lib/learn";

const LEVEL_TONE: Record<string, string> = {
  beginner: "border-brand/40 text-brand",
  intermediate: "border-sev-med/40 text-sev-med",
  advanced: "border-sev-crit/40 text-sev-crit",
};
const STATUS_TONE: Record<string, string> = {
  todo: "text-gray-500",
  learning: "text-sev-low",
  done: "text-brand",
};

export function LearnBoard({
  topics,
  progress,
}: {
  topics: LearnTopic[];
  progress: Record<string, string>;
}) {
  const [cat, setCat] = useState("");
  const [stat, setStat] = useState("");

  const visible = useMemo(
    () =>
      topics.filter((t) => {
        if (cat && t.category !== cat) return false;
        if (stat && (progress[t.id] ?? "todo") !== stat) return false;
        return true;
      }),
    [topics, cat, stat, progress],
  );

  const done = topics.filter((t) => progress[t.id] === "done").length;
  const learning = topics.filter((t) => progress[t.id] === "learning").length;
  const pct = topics.length ? Math.round((done / topics.length) * 100) : 0;

  const byCat = LEARN_CATEGORIES.map((c) => ({
    cat: c,
    items: visible.filter((t) => t.category === c),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      {/* Progress */}
      <div className="card mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-gray-300">
            <b className="text-brand">{done}</b> learned ·{" "}
            <b className="text-sev-low">{learning}</b> in progress ·{" "}
            <b>{topics.length}</b> total
          </span>
          <span className="text-gray-400">{pct}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-border">
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-gray-500">Category</span>
          <button onClick={() => setCat("")} className={`tag ${cat === "" ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}>all</button>
          {LEARN_CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCat(cat === c ? "" : c)} className={`tag ${cat === c ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-gray-500">Status</span>
          {["", "todo", "learning", "done"].map((s) => (
            <button key={s || "all"} onClick={() => setStat(s)} className={`tag capitalize ${stat === s ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}>
              {s || "all"}
            </button>
          ))}
        </div>
      </div>

      {/* Topics by category */}
      <div className="mt-5 space-y-6">
        {byCat.map((g) => (
          <div key={g.cat}>
            <h2 className="text-sm font-semibold text-gray-400">{g.cat}</h2>
            <div className="mt-2 space-y-3">
              {g.items.map((t) => {
                const st = progress[t.id] ?? "todo";
                return (
                  <div key={t.id} className={`card ${st === "done" ? "ring-emerald accent-emerald" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
                          {t.title}
                          <span className={`tag text-[10px] ${LEVEL_TONE[t.level] ?? ""}`}>{t.level}</span>
                          <span className={`text-[10px] ${STATUS_TONE[st]}`}>
                            {st === "done" ? "✓ learned" : st === "learning" ? "● learning" : "○ to learn"}
                          </span>
                        </p>
                        <p className="mt-1 text-sm text-gray-400">{t.summary}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          <span className="text-gray-400">Practice:</span> {t.practice}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-3 text-xs">
                          {t.href && (
                            <Link href={t.href} className="text-brand hover:underline">Open in portal →</Link>
                          )}
                          {t.resource && (
                            <a href={t.resource} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-200">
                              Reference ↗
                            </a>
                          )}
                        </div>
                      </div>
                      {/* Status buttons */}
                      <div className="flex shrink-0 gap-1">
                        {(["todo", "learning", "done"] as const).map((s) => (
                          <form key={s} action={setLearnStatus}>
                            <input type="hidden" name="key" value={t.id} />
                            <input type="hidden" name="status" value={s} />
                            <button
                              className={`rounded-md border px-2 py-1 text-[10px] capitalize ${
                                st === s
                                  ? "border-brand bg-brand/15 text-brand-glow"
                                  : "border-surface-border text-gray-400 hover:text-gray-200"
                              }`}
                              title={`Mark as ${s}`}
                            >
                              {s === "todo" ? "to learn" : s}
                            </button>
                          </form>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {byCat.length === 0 && (
          <p className="card text-sm text-gray-500">Nothing matches these filters.</p>
        )}
      </div>
    </div>
  );
}
