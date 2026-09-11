import { PageHeader } from "@/components/page-header";
import { Icon } from "@/components/icons";
import { DiscoveryPanel } from "@/components/discovery-panel";
import { Console, RailPanel } from "@/components/console";
import { getHackerOneStatus } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: { ok?: string; error?: string };
}) {
  const h1 = await getHackerOneStatus();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Program discovery" />

      {searchParams.ok && (
        <div className="mt-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand">✓ {searchParams.ok}</div>
      )}
      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-sev-crit/40 bg-sev-crit/10 px-4 py-2 text-sm text-sev-crit">
          <Icon name="alert" className="mr-1 inline h-4 w-4" /> {searchParams.error}
        </div>
      )}

      <div className="mt-4">
        <Console
          rail={
            <RailPanel title="Program discovery">
              <p className="text-[13px] leading-relaxed text-gray-300">
                Find &amp; rank bug-bounty programs worth your time — then engage the good ones.
              </p>
              <hr className="hairline my-3" />
              <ul className="space-y-2 text-[11px] leading-relaxed text-gray-500">
                <li>Ranked by pay, scope breadth, safe harbour, and freshness.</li>
                <li><b className="text-gray-300">Create engagement</b> pre-fills an <b>unauthorized</b> engagement from the program&apos;s scope — you authorize before anything runs.</li>
                <li>Uses your HackerOne credentials from <a href="/dashboard/settings" className="text-brand hover:underline">Settings → Integrations</a>.</li>
              </ul>
            </RailPanel>
          }
        >
          <div className="card">
            {h1.configured ? (
              <DiscoveryPanel />
            ) : (
              <p className="text-sm text-gray-400">
                Add your HackerOne API credentials in{" "}
                <a href="/dashboard/settings" className="text-brand hover:underline">Settings → Integrations</a>{" "}
                to discover programs.
              </p>
            )}
          </div>
        </Console>
      </div>
    </div>
  );
}
