"use client";

import { useState } from "react";
import { addFinding } from "@/lib/engagements";
import { SEVERITIES } from "@/lib/engagement-constants";

type StageHint = { name: string; summary: string };

export function EngagementWorkbench({
  engagementId,
  pillarTitle,
  stages,
}: {
  engagementId: string;
  pillarTitle: string | null;
  stages: StageHint[];
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("medium");

  function useStage(stage: StageHint) {
    setTitle(`${stage.name}: `);
    setDescription(`Observed during the ${stage.name} stage. ${stage.summary}`);
  }

  return (
    <details className="card mt-3" open>
      <summary className="cursor-pointer font-semibold text-brand">
        + Add finding
      </summary>

      {stages.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-gray-500">
            Quick-start from a {pillarTitle} workflow stage:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {stages.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => useStage(s)}
                className="tag hover:border-brand hover:text-brand"
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <form action={addFinding} className="mt-4 grid gap-3">
        <input type="hidden" name="engagementId" value={engagementId} />
        <div className="flex gap-3">
          <input
            name="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Finding title *"
            className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <select
            name="severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm capitalize outline-none focus:border-brand"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <textarea
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description — what & where, with evidence"
          rows={2}
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <textarea
          name="recommendation"
          placeholder="Recommendation — how to fix and verify"
          rows={2}
          className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button type="submit" className="btn-primary">
          Add finding
        </button>
      </form>
    </details>
  );
}
