import { PageHeader } from "@/components/page-header";
import { Icon } from "@/components/icons";
import { HelpBanner } from "@/components/hint";
import { DiscoveryPanel } from "@/components/discovery-panel";
import { getHackerOneStatus } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export default async function DiscoveryPage({
  searchParams,
}: {
  searchParams: { ok?: string; error?: string };
}) {
  const h1 = await getHackerOneStatus();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Program discovery"
        subtitle="Find and rank bug-bounty programs worth your time — then engage the good ones."
      />

      {searchParams.ok && (
        <div className="mt-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand">✓ {searchParams.ok}</div>
      )}
      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-sev-crit/40 bg-sev-crit/10 px-4 py-2 text-sm text-sev-crit">
          <Icon name="alert" className="mr-1 inline h-4 w-4" /> {searchParams.error}
        </div>
      )}

      <HelpBanner>
        <p>• Ranks programs by what makes them worth hunting: pays bounties, broad/open scope, safe harbour, open to submissions, and freshness.</p>
        <p>• <b>Create engagement</b> pre-fills an <b>unauthorized</b> engagement from the program&apos;s in-scope assets — record authorization (and flip autopilot) before anything runs.</p>
        <p>• Uses your HackerOne API credentials from Settings → Integrations.</p>
      </HelpBanner>

      <div className="card mt-4">
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
    </div>
  );
}
