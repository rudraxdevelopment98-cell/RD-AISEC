"use client";

import { createSubmission, updateSubmission, deleteSubmission } from "@/lib/submissions";
import { BUG_PLATFORMS, platformLabel } from "@/lib/bugbounty-core";
import {
  SUBMISSION_STATUSES,
  STATUS_LABEL,
  STATUS_CLASS,
  formatReward,
  submissionStats,
} from "@/lib/submission-core";

export type SubmissionRow = {
  id: string;
  title: string;
  platform: string;
  status: string;
  severity: string;
  rewardCents: number;
  reportUrl: string;
  submittedAt: string;
  engagementName: string | null;
};

const FIELD =
  "rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand";

export function SubmissionsManager({ submissions }: { submissions: SubmissionRow[] }) {
  const stats = submissionStats(submissions);

  return (
    <div>
      {/* Earnings + status roll-up */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Submitted" value={String(stats.total)} />
        <Stat label="Accepted / paid" value={String(stats.won)} accent="text-emerald-300" />
        <Stat label="Pending" value={String(stats.pending)} accent="text-sev-low" />
        <Stat label="Bounty earned" value={formatReward(stats.earnedCents)} accent="text-brand" />
      </div>

      {/* Log a submission */}
      <details className="card mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-200 hover:text-brand">
          ＋ Log a submission
        </summary>
        <form action={createSubmission} className="mt-3 space-y-3">
          <input name="title" required placeholder="Vulnerability title (as submitted)" className={`w-full ${FIELD}`} />
          <div className="grid gap-3 sm:grid-cols-3">
            <select name="platform" className={FIELD} defaultValue="hackerone">
              {BUG_PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <select name="severity" className={FIELD} defaultValue="medium">
              {["critical", "high", "medium", "low", "info"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select name="status" className={FIELD} defaultValue="submitted">
              {SUBMISSION_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="reward" placeholder="Bounty (e.g. $1,500 or 1.5k)" className={FIELD} />
            <input name="reportUrl" placeholder="Report link (optional)" className={FIELD} />
          </div>
          <input name="notes" placeholder="Notes (optional)" className={`w-full ${FIELD}`} />
          <button className="btn-primary text-sm">Log submission</button>
        </form>
      </details>

      {/* List */}
      {submissions.length === 0 ? (
        <p className="card mt-4 text-sm text-gray-500">
          No submissions logged yet. When you submit a bug, log it here to track triage → accepted → bounty.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {submissions.map((s) => (
            <div key={s.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-white break-words">{s.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="tag text-brand">{platformLabel(s.platform)}</span>
                    <span className="tag capitalize">{s.severity}</span>
                    <span className={`tag ${STATUS_CLASS[s.status] ?? ""}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
                    {s.rewardCents > 0 && <span className="tag ring-emerald accent-emerald">{formatReward(s.rewardCents)}</span>}
                    {s.engagementName && <span className="text-gray-500">· {s.engagementName}</span>}
                    <span className="text-gray-600">· {new Date(s.submittedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                {s.reportUrl && (
                  <a href={s.reportUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline">
                    open report →
                  </a>
                )}
              </div>

              {/* Inline update: status + bounty (sibling forms, not nested) */}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-surface-border pt-3 text-xs">
                <form action={updateSubmission} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={s.id} />
                  <select name="status" defaultValue={s.status} className="rounded-md border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand">
                    {SUBMISSION_STATUSES.map((st) => (
                      <option key={st} value={st}>{STATUS_LABEL[st]}</option>
                    ))}
                  </select>
                  <input
                    name="reward"
                    defaultValue={s.rewardCents ? String(s.rewardCents / 100) : ""}
                    placeholder="bounty $"
                    className="w-28 rounded-md border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand"
                  />
                  <button className="btn-ghost px-2 py-1">Update</button>
                </form>
                <form action={deleteSubmission} className="ml-auto">
                  <input type="hidden" name="id" value={s.id} />
                  <button className="text-gray-500 hover:text-sev-crit">Remove</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = "text-white" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="card">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}
