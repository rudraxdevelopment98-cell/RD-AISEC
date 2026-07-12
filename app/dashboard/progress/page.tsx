import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { PROGRESS } from "@/data/progress";

export const dynamic = "force-dynamic";

export default function ProgressPage() {
  const totalDone = PROGRESS.reduce((n, a) => n + a.done.length, 0);
  const totalTodo = PROGRESS.reduce((n, a) => n + a.todo.length, 0);
  const overall = Math.round((totalDone / (totalDone + totalTodo)) * 100);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Progress"
        subtitle="What's built and what's still to do, per area — a live map of accuracy and feature work."
        actions={
          <span className="tag ring-emerald accent-emerald">
            {overall}% · {totalDone} done · {totalTodo} to do
          </span>
        }
      />

      {/* Overall bar */}
      <div className="card">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span className="font-semibold text-white">Overall</span>
          <span>
            {totalDone}/{totalDone + totalTodo} shipped
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-border">
          <div className="h-full rounded-full bg-brand" style={{ width: `${overall}%` }} />
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {PROGRESS.map((a) => {
          const pct = Math.round((a.done.length / (a.done.length + a.todo.length)) * 100);
          return (
            <div key={a.area} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon name={a.icon} className="h-4 w-4 text-brand" />
                  <h2 className="font-semibold text-white">{a.area}</h2>
                  <span className="text-xs text-gray-500">{a.summary}</span>
                </div>
                <span className="tag">{pct}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-border">
                <div className="h-full rounded-full bg-brand/80" style={{ width: `${pct}%` }} />
              </div>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-brand">
                    Done ({a.done.length})
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {a.done.map((d, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-gray-300">
                        <span className="mt-0.5 shrink-0 text-brand">✓</span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-sev-med">
                    Remaining ({a.todo.length})
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {a.todo.map((d, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-gray-400">
                        <span className="mt-0.5 shrink-0 text-gray-600">○</span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
