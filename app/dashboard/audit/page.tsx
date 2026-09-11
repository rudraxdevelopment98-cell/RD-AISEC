import { auth, isOwnerEmail } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { Icon } from "@/components/icons";
import { Console, RailPanel } from "@/components/console";
import { runSelfAudit, type AuditLevel } from "@/lib/self-audit";

export const dynamic = "force-dynamic";

const TONE: Record<AuditLevel, string> = {
  ok: "border-brand/30 text-brand",
  warn: "border-amber-400/40 text-amber-300",
  gap: "border-sev-crit/40 text-sev-crit",
};
const DOT: Record<AuditLevel, string> = { ok: "bg-brand", warn: "bg-amber-400", gap: "bg-sev-crit" };

export default async function AuditPage() {
  const session = await auth();
  const email = session?.user?.email ?? "";
  if (!isOwnerEmail(email)) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">Self-audit</h1>
        <p className="mt-3 card text-sm text-gray-400">Only an owner can view the engine self-audit.</p>
      </div>
    );
  }

  const audit = await runSelfAudit();
  const scoreTone = audit.score >= 80 ? "text-brand" : audit.score >= 50 ? "text-amber-300" : "text-sev-crit";

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Engine self-audit" />

      <div className="mt-4">
        <Console
          rail={
            <RailPanel title="Self-audit">
              <p className="text-[13px] leading-relaxed text-gray-300">
                Where the engine&apos;s coverage is thin — and what to teach it next.
              </p>
              <ul className="mt-3 space-y-2 text-[11px] leading-relaxed text-gray-500">
                <li>The engine refreshes its detections (nuclei templates, EPSS, threat-intel, exploit-db) automatically in each machine&apos;s daily maintenance window.</li>
                <li>This page reports the gaps that still need a human or a rule change — the &quot;research list&quot; is what to fold back into the engine&apos;s knowledge.</li>
              </ul>
            </RailPanel>
          }
        >
      <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="card flex flex-col items-center justify-center py-6">
          <div className={`text-4xl font-bold ${scoreTone}`}>{audit.score}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">health</div>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500">
            Generated {new Date(audit.generatedAt).toLocaleString()} · {audit.items.length} check(s)
          </p>
          <ul className="mt-3 space-y-2.5">
            {audit.items.map((it, i) => (
              <li key={i} className={`rounded-lg border bg-black/20 px-3 py-2 ${TONE[it.level]}`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[it.level]}`} />
                  <span className="text-sm font-semibold text-white">{it.title}</span>
                  {typeof it.count === "number" && <span className="tag text-[10px]">{it.count}</span>}
                </div>
                <p className="mt-1 text-xs text-gray-400">{it.detail}</p>
                {it.action && <p className="mt-1 text-[11px] text-gray-500">→ {it.action}</p>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {audit.researchList.length > 0 && (
        <div className="card mt-4">
          <div className="flex items-center gap-2">
            <Icon name="book" className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-semibold text-white">Research list — teach the engine</h3>
            <span className="tag text-[10px]">{audit.researchList.length}</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Unclassified findings and un-enriched CVEs. These are the candidates for new taxonomy/playbook rules or an intel refresh.
          </p>
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            {audit.researchList.map((r, i) => (
              <li key={i} className="truncate rounded border border-surface-border bg-black/20 px-2 py-1 font-mono text-[11px] text-gray-300">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
        </Console>
      </div>
    </div>
  );
}
