import { queueCustomJob } from "@/lib/runners";

type Opt = { id: string; name: string };

/**
 * Run an arbitrary command on a connected machine. Collapsed by default. The
 * command runs only on the selected runner (your own authorized machine), via
 * argv (no shell). Gated on an authorization checkbox.
 */
export function CustomJobForm({
  runners,
  engagements,
  back = "/dashboard/jobs",
  defaultCommand = "",
}: {
  runners: Opt[];
  engagements: Opt[];
  back?: string;
  defaultCommand?: string;
}) {
  return (
    <details className="card mt-4 group" open={!!defaultCommand}>
      <summary className="cursor-pointer list-none font-semibold text-white">
        <span className="text-brand">⌘</span> Run a custom command
        <span className="ml-2 text-xs font-normal text-gray-500 group-open:hidden">
          (advanced — any tool installed on the machine)
        </span>
      </summary>

      {runners.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">
          Connect a machine first on the Machines page.
        </p>
      ) : (
        <form action={queueCustomJob} className="mt-4 space-y-3">
          <input type="hidden" name="back" value={back} />
          <div>
            <label className="text-xs font-semibold text-gray-400">Command</label>
            <input
              name="command"
              defaultValue={defaultCommand}
              required
              placeholder="e.g. nmap -sV --script vuln scanme.nmap.org"
              className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-brand"
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Runs as a single command (argv, no shell). Use the program plus its
              flags — e.g. <code>searchsploit apache 2.4.49</code> or{" "}
              <code>msfconsole -q -x &quot;use auxiliary/scanner/...; run; exit&quot;</code>.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-gray-400">Machine</label>
              <select
                name="runnerId"
                required
                className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
              >
                {runners.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400">
                Engagement (optional)
              </label>
              <select
                name="engagementId"
                className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
              >
                <option value="">Quick run (no engagement)</option>
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-start gap-2 text-xs text-gray-400">
            <input type="checkbox" name="confirm" value="true" required className="mt-0.5" />
            <span>
              I&apos;m authorized to run this command on this machine and against
              any target it touches. Offensive tools are for authorized testing
              only.
            </span>
          </label>
          <button className="btn-primary text-sm">Run command</button>
        </form>
      )}
    </details>
  );
}
