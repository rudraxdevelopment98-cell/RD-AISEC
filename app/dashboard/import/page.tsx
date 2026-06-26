import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { importBurpFindings } from "@/lib/burp-actions";
import { HelpBanner } from "@/components/hint";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const engagements = await prisma.engagement.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Import findings</h1>
      <p className="mt-1 text-gray-400">
        Bring results from tools you run by hand into an engagement. Burp Suite
        manual testing → export the issues as XML and import them here; they join
        the same findings list and report as your automated scans. No AI involved.
      </p>

      <HelpBanner>
        <p>• In Burp: Target → Site map → right-click → Report issues (XML).</p>
        <p>• Pick the engagement, upload the XML, and the issues become findings (tagged to ATT&amp;CK/OWASP).</p>
      </HelpBanner>

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      {engagements.length === 0 ? (
        <div className="card mt-6 text-center">
          <p className="text-gray-400">
            Create an engagement first — findings are imported into one.
          </p>
          <Link href="/dashboard/engagements" className="btn-primary mt-4 inline-flex">
            Create an engagement
          </Link>
        </div>
      ) : (
        <form action={importBurpFindings} className="card mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-300">Engagement</label>
            <select
              name="engagementId"
              defaultValue={engagements[0]?.id}
              className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            >
              {engagements.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-300">
              Burp issues XML file
            </label>
            <input
              type="file"
              name="file"
              accept=".xml,text/xml,application/xml"
              className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand/20 file:px-3 file:py-1 file:text-brand"
            />
          </div>

          <div className="flex items-center gap-3 text-xs text-gray-500">
            <div className="h-px flex-1 bg-surface-border" /> or paste XML{" "}
            <div className="h-px flex-1 bg-surface-border" />
          </div>

          <textarea
            name="xml"
            rows={8}
            placeholder="<issues burpVersion=…> … </issues>"
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-brand"
          />

          <button type="submit" className="btn-primary w-full">
            <Icon name="arrow" className="h-4 w-4" /> Import findings
          </button>
        </form>
      )}

      <div className="card mt-6 text-sm text-gray-400">
        <h2 className="font-semibold text-brand">How to export from Burp</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>In Burp: <strong>Target → Site map</strong> (or the Dashboard issue list).</li>
          <li>Select the host/items, right-click → <strong>Report issues</strong> (Pro) or <strong>Issue activity → Save</strong>.</li>
          <li>Choose <strong>XML</strong> as the format and save the file.</li>
          <li>Upload or paste it above. Burp severities map to RD-AISEC severities automatically.</li>
        </ol>
        <p className="mt-3 text-xs text-gray-500">
          Note: Burp <em>Community</em> has no automated scanner, so it won&apos;t
          have scanner issues to export — this is for Burp Pro issue exports, or
          any tool that produces Burp-format issues XML.
        </p>
      </div>
    </div>
  );
}
