import { Scanner } from "@/components/scanner";
import { listEngagements } from "@/lib/engagements";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const engagements = await listEngagements();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Auto Scan</h1>
      <p className="mt-1 text-gray-400">
        Automated web security posture check. Enter an authorized target and the
        scanner analyzes its HTTPS, security headers, and cookie hardening — then
        turns every gap into a finding you can save to an engagement.
      </p>
      <Scanner engagements={engagements.map((e) => ({ id: e.id, name: e.name }))} />
    </div>
  );
}
