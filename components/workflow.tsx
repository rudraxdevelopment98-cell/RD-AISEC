"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import type { Stage } from "@/data/portal";

/** Drop an inline "# comment" so the command is runnable as-is. */
function stripComment(cmd: string): string {
  return cmd.replace(/\s+#\s.*$/, "").trim();
}

function CommandLine({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const runnable = stripComment(cmd);
  return (
    <div className="group flex items-center justify-between gap-3 rounded-md border border-surface-border bg-black/50 px-3 py-2">
      <code className="overflow-x-auto font-mono text-xs text-gray-300">{cmd}</code>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={`/dashboard/jobs?cmd=${encodeURIComponent(runnable)}`}
          title="Run on a machine (opens Jobs, set your target first)"
          className="text-gray-500 transition hover:text-brand"
        >
          <Icon name="bolt" className="h-4 w-4" />
        </Link>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(runnable);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="text-gray-500 transition hover:text-brand"
          title="Copy command"
        >
          <Icon name={copied ? "check" : "copy"} className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StageCard({ stage, index }: { stage: Stage; index: number }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setDone((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const progress = stage.checklist.length
    ? Math.round((done.size / stage.checklist.length) * 100)
    : 0;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-surface-border text-sm font-bold text-brand">
            {index + 1}
          </span>
          <div>
            <h3 className="font-semibold text-white">{stage.name}</h3>
            <p className="mt-0.5 text-sm text-gray-400">{stage.summary}</p>
          </div>
        </div>
        {stage.checklist.length > 0 && (
          <span className="tag shrink-0">{progress}%</span>
        )}
      </div>

      {stage.checklist.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {stage.checklist.map((item, i) => {
            const checked = done.has(i);
            return (
              <li key={item}>
                <button
                  onClick={() => toggle(i)}
                  className="flex w-full items-center gap-2 text-left text-sm"
                >
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                      checked
                        ? "border-brand bg-brand text-black"
                        : "border-surface-border text-transparent"
                    }`}
                  >
                    <Icon name="check" className="h-3 w-3" />
                  </span>
                  <span className={checked ? "text-gray-500 line-through" : "text-gray-300"}>
                    {item}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {stage.tools.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {stage.tools.map((t) => (
            <span key={t} className="tag">
              <Icon name="wrench" className="h-3 w-3" /> {t}
            </span>
          ))}
        </div>
      )}

      {stage.commands.length > 0 && (
        <div className="mt-4 space-y-2">
          {stage.commands.map((c) => (
            <CommandLine key={c} cmd={c} />
          ))}
        </div>
      )}

      {stage.commands.length > 0 && (
        <Link
          href={`/dashboard/jobs?cmd=${encodeURIComponent(stripComment(stage.commands[0]))}`}
          className="btn-ghost mt-4 flex w-full items-center justify-center gap-2 text-sm"
        >
          <Icon name="bolt" className="h-4 w-4" /> Run this stage on a machine
        </Link>
      )}
    </div>
  );
}

export function Workflow({ stages }: { stages: Stage[] }) {
  return (
    <div className="mt-6 space-y-4">
      {stages.map((stage, i) => (
        <StageCard key={stage.name} stage={stage} index={i} />
      ))}
    </div>
  );
}
