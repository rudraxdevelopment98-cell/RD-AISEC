import Link from "next/link";
import { Icon } from "@/components/icons";
import { stageDef } from "@/lib/pipeline-core";
import {
  startAssessment,
  approveStage,
  pauseAssessment,
  resumeAssessment,
  cancelAssessment,
  toggleAutoApprove,
} from "@/lib/pipeline";

type Stage = {
  key: string;
  title: string;
  order: number;
  status: string;
  summary: string;
};
type Pipeline = {
  status: string;
  currentKey: string;
  autoApprove: boolean;
  stages: Stage[];
};

const STAGE_TONE: Record<string, string> = {
  done: "border-emerald-500/40 text-emerald-300",
  running: "border-sky-500/50 text-sky-300",
  pending: "border-surface-border text-gray-500",
  skipped: "border-gray-600/40 text-gray-500",
};

export function PipelinePanel({
  engagementId,
  authorized,
  hasRunner,
  pipeline,
  progress,
}: {
  engagementId: string;
  authorized: boolean;
  hasRunner: boolean;
  pipeline: Pipeline | null;
  progress: Record<string, { done: number; total: number }>;
}) {
  const blocked = !authorized || !hasRunner;

  return (
    <section className="mt-8">
      <div className="flex items-center gap-2">
        <Icon name="bolt" className="h-4 w-4 text-brand" />
        <h2 className="text-lg font-semibold">Assessment pipeline</h2>
      </div>
      <p className="mt-1 text-sm text-gray-400">
        Runs every stage in order — recon, scan, exploit, triage, report. Each
        stage finishes, asks for your approval, then the next runs automatically
        until the report is ready. Turn on auto-approve to run hands-off.
      </p>

      {/* No pipeline yet — start it */}
      {!pipeline || pipeline.status === "canceled" ? (
        <form action={startAssessment} className="card mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="engagementId" value={engagementId} />
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" name="autoApprove" className="h-4 w-4 accent-emerald-500" />
            Auto-approve every stage (hands-off)
          </label>
          <button
            type="submit"
            disabled={blocked}
            className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="bolt" className="mr-1 inline h-4 w-4" />
            {pipeline?.status === "canceled" ? "Restart assessment" : "Run full assessment"}
          </button>
          {blocked && (
            <span className="text-xs text-amber-400">
              {!authorized ? "Record authorization first." : "Register a runner first."}
            </span>
          )}
        </form>
      ) : (
        <div className="card mt-3">
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={`tag ${
                pipeline.status === "done"
                  ? "border-emerald-500/40 text-emerald-300"
                  : pipeline.status === "awaiting_approval"
                    ? "border-amber-500/40 text-amber-300"
                    : pipeline.status === "paused"
                      ? "border-gray-500/40 text-gray-400"
                      : "border-sky-500/50 text-sky-300"
              }`}
            >
              {pipeline.status === "awaiting_approval"
                ? "⏸ Awaiting approval"
                : pipeline.status === "running"
                  ? "▶ Running"
                  : pipeline.status === "done"
                    ? "✓ Complete"
                    : "⏸ Paused"}
            </span>
            <div className="flex items-center gap-3 text-xs">
              <form action={toggleAutoApprove}>
                <input type="hidden" name="engagementId" value={engagementId} />
                <input type="hidden" name="autoApprove" value={(!pipeline.autoApprove).toString()} />
                <button className={pipeline.autoApprove ? "text-emerald-400 hover:text-emerald-300" : "text-gray-400 hover:text-gray-200"}>
                  {pipeline.autoApprove ? "🤖 Auto-approve: on" : "Auto-approve: off"}
                </button>
              </form>
              {pipeline.status === "running" && (
                <form action={pauseAssessment}>
                  <input type="hidden" name="engagementId" value={engagementId} />
                  <button className="text-gray-400 hover:text-amber-300">Pause</button>
                </form>
              )}
              {pipeline.status === "paused" && (
                <form action={resumeAssessment}>
                  <input type="hidden" name="engagementId" value={engagementId} />
                  <button className="text-emerald-400 hover:text-emerald-300">Resume</button>
                </form>
              )}
              {pipeline.status !== "done" && (
                <form action={cancelAssessment}>
                  <input type="hidden" name="engagementId" value={engagementId} />
                  <button className="text-gray-500 hover:text-red-400">Cancel</button>
                </form>
              )}
            </div>
          </div>

          {/* Stage stepper */}
          <ol className="mt-4 space-y-2">
            {[...pipeline.stages]
              .sort((a, b) => a.order - b.order)
              .map((s) => {
                const def = stageDef(s.key);
                const isCurrent = s.key === pipeline.currentKey;
                const awaiting = isCurrent && pipeline.status === "awaiting_approval";
                const prog = progress[s.key];
                const tone = awaiting ? "border-amber-500/50 text-amber-300" : STAGE_TONE[s.status] ?? STAGE_TONE.pending;
                return (
                  <li
                    key={s.key}
                    className={`flex items-start gap-3 rounded-lg border bg-black/20 px-3 py-2 ${tone}`}
                  >
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-current/30">
                      {s.status === "done" ? (
                        <Icon name="check" className="h-4 w-4" />
                      ) : (
                        <Icon name={def?.icon ?? "bolt"} className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-white">{s.title}</span>
                        <span className="text-xs">
                          {awaiting ? "awaiting approval" : s.status}
                        </span>
                        {prog && prog.total > 0 && (
                          <span className="text-[11px] text-gray-500">
                            · {prog.done}/{prog.total} jobs
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{s.summary || def?.desc}</p>
                      {prog && prog.total > 0 && s.status !== "pending" && (
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-border">
                          <div
                            className="h-full rounded-full bg-brand"
                            style={{ width: `${Math.round((prog.done / prog.total) * 100)}%` }}
                          />
                        </div>
                      )}
                      {awaiting && (
                        <form action={approveStage} className="mt-2">
                          <input type="hidden" name="engagementId" value={engagementId} />
                          <button className="btn-primary px-3 py-1 text-xs">
                            Approve &amp; continue →
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
          </ol>

          {pipeline.status === "done" && (
            <div className="mt-4 flex items-center gap-3">
              <Link href={`/dashboard/engagements/${engagementId}/report`} className="btn-primary text-sm">
                <Icon name="book" className="mr-1 inline h-4 w-4" /> View report
              </Link>
              <form action={startAssessment}>
                <input type="hidden" name="engagementId" value={engagementId} />
                <button className="text-xs text-gray-500 hover:text-brand">Run again</button>
              </form>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
