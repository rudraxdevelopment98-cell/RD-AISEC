import { auth, isOwnerEmail } from "@/auth";
import { Icon } from "@/components/icons";
import { HelpBanner } from "@/components/hint";
import { prisma } from "@/lib/db";
import { saveNotifySetting, testNotify } from "@/lib/notify-actions";

export const dynamic = "force-dynamic";

const SEVERITIES = ["info", "low", "medium", "high", "critical"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { ok?: string; error?: string };
}) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  if (!isOwnerEmail(email)) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-3 card text-sm text-gray-400">Only an owner can change settings.</p>
      </div>
    );
  }

  const cfg = await prisma.notifySetting.findFirst();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-gray-400">Portal-wide settings.</p>

      {searchParams.ok && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          ✓ {searchParams.ok}
        </div>
      )}
      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      <h2 className="mt-8 text-lg font-bold">Notifications</h2>
      <HelpBanner>
        <p>• Get a free <b>Discord</b> webhook: Server Settings → Integrations → Webhooks → New Webhook → Copy URL.</p>
        <p>• Slack works too (Incoming Webhook URL).</p>
        <p>• You&apos;ll be pinged when a new finding at/above your chosen severity lands — including from automation.</p>
      </HelpBanner>

      <form action={saveNotifySetting} className="card mt-4 space-y-3">
        <div>
          <label className="text-xs font-semibold text-gray-400">Discord / Slack webhook URL</label>
          <input
            name="discordWebhook"
            type="url"
            defaultValue={cfg?.discordWebhook ?? ""}
            placeholder="https://discord.com/api/webhooks/…"
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-xs font-semibold text-gray-400">
            Notify at or above
            <select
              name="minSeverity"
              defaultValue={cfg?.minSeverity ?? "high"}
              className="ml-2 rounded-lg border border-surface-border bg-surface px-2 py-1 text-sm capitalize outline-none focus:border-brand"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" name="enabled" value="true" defaultChecked={cfg?.enabled ?? true} />
            Enabled
          </label>
        </div>
        <button className="btn-primary text-sm">Save</button>
      </form>

      <form action={testNotify} className="mt-3">
        <button className="btn-ghost text-sm">Send test notification</button>
      </form>
    </div>
  );
}
