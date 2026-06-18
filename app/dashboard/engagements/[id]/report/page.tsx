import Link from "next/link";
import { notFound } from "next/navigation";
import { getEngagement } from "@/lib/engagements";
import { sortFindings, severityCounts } from "@/lib/report";
import { SeverityBadge, FindingStatusBadge } from "@/components/badges";
import { PrintButton } from "@/components/print-button";
import { Icon } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: { id: string };
}) {
  const e = await getEngagement(params.id);
  if (!e) notFound();

  const open = e.findings.filter((f) => f.status === "open").length;
  const counts = severityCounts(e.findings);
  const sorted = sortFindings(e.findings);
  const date = new Date(e.createdAt).toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl">
      {/* Toolbar — hidden when printing */}
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/dashboard/engagements/${e.id}`}
          className="text-sm text-gray-500 hover:text-brand"
        >
          ← Back to engagement
        </Link>
        <div className="flex gap-2">
          <a href={`/api/engagements/${e.id}/report`} className="btn-ghost">
            <Icon name="copy" className="h-4 w-4" /> Download Markdown
          </a>
          <PrintButton />
        </div>
      </div>

      {/* Report — also the print surface */}
      <article className="card mt-4 print:border-0 print:bg-white print:text-black">
        <header className="border-b border-surface-border pb-4 print:border-gray-300">
          <p className="text-xs uppercase tracking-wider text-gray-500">
            Security Assessment Report
          </p>
          <h1 className="mt-1 text-2xl font-bold">{e.name}</h1>
          <div className="mt-3 grid grid-cols-2 gap-1 text-sm text-gray-400 print:text-gray-700 sm:grid-cols-4">
            <p><span className="text-gray-500">Client:</span> {e.client || "—"}</p>
            <p className="capitalize"><span className="text-gray-500">Type:</span> {e.type}</p>
            <p className="capitalize"><span className="text-gray-500">Status:</span> {e.status}</p>
            <p><span className="text-gray-500">Date:</span> {date}</p>
          </div>
          <p
            className={`mt-3 text-sm ${
              e.authorized ? "text-emerald-400" : "text-amber-400"
            } print:text-black`}
          >
            {e.authorized
              ? `Authorized${e.authorizedBy ? ` by ${e.authorizedBy}` : ""}`
              : "⚠ NOT AUTHORIZED — this report should not be issued."}
          </p>
        </header>

        <section className="mt-6">
          <h2 className="text-lg font-semibold">Executive Summary</h2>
          <p className="mt-2 text-sm text-gray-300 print:text-black">
            This engagement recorded <strong>{e.findings.length}</strong>{" "}
            finding{e.findings.length === 1 ? "" : "s"}, of which{" "}
            <strong>{open}</strong> remain open.
          </p>
          {counts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {counts.map((c) => (
                <span key={c.severity} className="flex items-center gap-2">
                  <SeverityBadge value={c.severity} />
                  <span className="text-sm text-gray-400 print:text-black">× {c.count}</span>
                </span>
              ))}
            </div>
          )}
        </section>

        {e.scope && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold">Scope</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300 print:text-black">
              {e.scope}
            </p>
          </section>
        )}

        <section className="mt-6">
          <h2 className="text-lg font-semibold">Findings</h2>
          {sorted.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No findings recorded.</p>
          ) : (
            <ol className="mt-3 space-y-4">
              {sorted.map((f, i) => (
                <li
                  key={f.id}
                  className="border-l-2 border-surface-border pl-4 print:border-gray-300"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-white print:text-black">
                      {i + 1}. {f.title}
                    </h3>
                    <span className="flex gap-2">
                      <SeverityBadge value={f.severity} />
                      <FindingStatusBadge value={f.status} />
                    </span>
                  </div>
                  {f.description && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300 print:text-black">
                      {f.description}
                    </p>
                  )}
                  {f.recommendation && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300 print:text-black">
                      <span className="text-gray-500">Recommendation: </span>
                      {f.recommendation}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="mt-8 border-t border-surface-border pt-4 text-xs text-gray-500 print:border-gray-300">
          Generated by RD-AISEC. For authorized security testing and education
          only.
        </footer>
      </article>
    </div>
  );
}
