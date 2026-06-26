import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { CreateRunnerForm } from "@/components/runner-create";
import { AutoRefresh } from "@/components/auto-refresh";
import { HelpBanner } from "@/components/hint";
import { deleteRunner, setRunnerAnonymity, requestInstall } from "@/lib/runners";
import {
  RUNNER_ONLINE_WINDOW_MS,
  RUNNER_VERSION,
  INSTALLABLE_PKGS,
} from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

export default async function RunnersPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const [runners, missingFromJobs] = await Promise.all([
    prisma.runner.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        installs: {
          where: { status: { in: ["pending", "installing", "failed"] } },
          orderBy: { createdAt: "desc" },
          take: 6,
        },
      },
    }),
    // Jobs that failed because the tool wasn't installed → install suggestions.
    prisma.job.findMany({
      where: {
        status: "failed",
        output: { contains: "is not installed" },
        runnerId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { runner: { select: { id: true, name: true } } },
    }),
  ]);

  // Build a deduped list of (runner, tool) install suggestions from failures,
  // limited to tools we can install via apt and not already queued/installed.
  const installablePending = new Set(
    runners.flatMap((r) =>
      r.installs
        .filter((i) => i.status === "pending" || i.status === "installing")
        .map((i) => `${r.id}:${i.tool}`),
    ),
  );
  const installedByRunner = new Map(
    runners.map((r) => [r.id, new Set((r.installed ?? "").split(",").map((s) => s.trim()))]),
  );
  const seenSug = new Set<string>();
  const suggestions = missingFromJobs
    .filter((j) => j.runner && INSTALLABLE_PKGS[j.tool])
    .map((j) => ({ runnerId: j.runner!.id, runnerName: j.runner!.name, tool: j.tool }))
    .filter((s) => {
      const key = `${s.runnerId}:${s.tool}`;
      if (seenSug.has(key) || installablePending.has(key)) return false;
      if (installedByRunner.get(s.runnerId)?.has(s.tool)) return false;
      seenSug.add(key);
      return true;
    });

  const now = Date.now();

  return (
    <div className="mx-auto max-w-5xl">
      <AutoRefresh seconds={6} />

      <h1 className="text-2xl font-bold">Machines</h1>
      <p className="mt-1 text-gray-400">
        Connect machines you control (e.g. Kali in UTM/Parallels) as runners. Each
        polls over HTTPS, executes tools locally, and posts results back — nothing
        offensive runs in the cloud. Anything the portal needs to run goes to the
        machine you select. See{" "}
        <code className="font-mono text-xs text-brand">runner/README.md</code>.
      </p>

      <HelpBanner>
        <p>• Create a runner to get a token, then run the Python runner on your machine with it.</p>
        <p>• A green dot = online (polled recently). Install missing tools right from a runner&apos;s card.</p>
        <p>• Toggle Tor per machine to route tool traffic anonymously. Then queue work on the Jobs page.</p>
      </HelpBanner>

      {/* Installations — tools that jobs need but the machine is missing */}
      {suggestions.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <h2 className="text-sm font-semibold text-amber-300">
            <Icon name="wrench" className="mr-1 inline h-4 w-4" />
            Installations needed
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            A job failed because a tool isn&apos;t installed on the machine.
            Approve the install — it runs <code className="font-mono">apt</code>{" "}
            for that package on the machine (needs your authorization).
          </p>
          <div className="mt-3 space-y-2">
            {suggestions.map((s) => (
              <form
                key={`${s.runnerId}:${s.tool}`}
                action={requestInstall}
                className="flex flex-wrap items-center gap-3 rounded-md border border-surface-border bg-black/30 px-3 py-2"
              >
                <input type="hidden" name="runnerId" value={s.runnerId} />
                <input type="hidden" name="tool" value={s.tool} />
                <span className="text-sm">
                  Install <span className="font-mono text-white">{s.tool}</span> on{" "}
                  <span className="text-gray-300">{s.runnerName}</span>
                </span>
                <label className="flex items-center gap-1.5 text-xs text-gray-400">
                  <input type="checkbox" name="confirm" value="true" required className="h-3.5 w-3.5 accent-emerald-500" />
                  I authorize this install
                </label>
                <button className="btn-ghost px-2 py-1 text-xs">Install</button>
              </form>
            ))}
          </div>
        </div>
      )}

      {/* How-to-connect hint */}
      <details className="card mt-6">
        <summary className="cursor-pointer font-semibold text-brand">
          <Icon name="bolt" className="mr-1 inline h-4 w-4" />
          How do I connect my Kali Linux?
        </summary>
        <div className="mt-4 space-y-4 text-sm text-gray-300">
          <p className="text-gray-400">
            Works with any Kali — UTM VM, a physical laptop, bare metal, or a
            cloud box. The runner only makes <strong>outbound HTTPS</strong>{" "}
            calls, so there are no ports to open.
          </p>

          <div>
            <p className="font-semibold text-white">1. Register a runner</p>
            <p className="text-gray-400">
              Use the form below, name it, and <strong>copy the token</strong> —
              it&apos;s shown only once.
            </p>
          </div>

          <div>
            <p className="font-semibold text-white">2. Get the agent onto Kali</p>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-surface-border bg-black/50 p-3 font-mono text-xs text-gray-300">
{`# clone the repo…
git clone https://github.com/rudraxdevelopment98-cell/rd-aisec.git
cd rd-aisec/runner

# …or just grab the single file
curl -O https://raw.githubusercontent.com/rudraxdevelopment98-cell/rd-aisec/main/runner/rdaisec_runner.py`}
            </pre>
          </div>

          <div>
            <p className="font-semibold text-white">3. Install the tools</p>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-surface-border bg-black/50 p-3 font-mono text-xs text-gray-300">
{`sudo apt update && sudo apt install -y nmap whois dnsutils
# optional (ProjectDiscovery): httpx, nuclei`}
            </pre>
          </div>

          <div>
            <p className="font-semibold text-white">
              4. Point it at the portal and run
            </p>
            <p className="text-gray-400">
              Nothing to <code className="font-mono">pip install</code> — it uses
              the Python 3 standard library.
            </p>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-surface-border bg-black/50 p-3 font-mono text-xs text-gray-300">
{`export PORTAL_URL="https://rd-aisec.vercel.app"
export RUNNER_TOKEN="rdr_...."   # the token from step 1
python3 rdaisec_runner.py`}
            </pre>
          </div>

          <div>
            <p className="font-semibold text-white">5. Verify &amp; test</p>
            <p className="text-gray-400">
              The runner flips to <span className="text-emerald-300">online</span>{" "}
              below. Queue an <code className="font-mono">nmap</code> →{" "}
              <em>Quick</em> against{" "}
              <code className="font-mono">scanme.nmap.org</code>, watch it run,
              then <strong>Import to findings</strong>.
            </p>
          </div>

          <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
            💡 Running the portal locally instead of Vercel? Set{" "}
            <code className="font-mono">PORTAL_URL=&quot;http://&lt;your-PC-LAN-IP&gt;:3000&quot;</code>{" "}
            — not <code className="font-mono">localhost</code>, which would point
            at the Kali box itself. Full guide:{" "}
            <code className="font-mono">runner/README.md</code>.
          </p>
        </div>
      </details>

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      <CreateRunnerForm />

      {/* Registered runners */}
      {runners.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {runners.map((r) => {
            const online =
              r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS;
            const installedSet = new Set(
              (r.installed ?? "").split(",").map((s) => s.trim()).filter(Boolean),
            );
            const missing = Object.keys(INSTALLABLE_PKGS).filter(
              (t) => !installedSet.has(t),
            );
            return (
              <div key={r.id} className="card flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Icon name="server" className="h-4 w-4 text-brand" />
                    <span className="font-semibold text-white">{r.name}</span>
                    <span
                      className={`tag ${online ? "ring-emerald accent-emerald" : "border-gray-500/40 text-gray-400"}`}
                    >
                      ● {online ? "online" : "offline"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {r.lastSeenAt
                      ? `Last seen ${new Date(r.lastSeenAt).toLocaleString()}`
                      : "Never connected yet"}
                  </p>
                  {r.lastSeenAt && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {r.toolCount > 0 && (
                        <span className="tag">{r.toolCount} tools</span>
                      )}
                      {r.version && <span className="tag">v{r.version}</span>}
                      {r.version && r.version !== RUNNER_VERSION && (
                        <span className="tag border-amber-500/40 text-amber-300">
                          update available — git pull
                        </span>
                      )}
                      {r.anonymity && (
                        <span
                          className={`tag ${
                            r.anonStatus === "no-tor"
                              ? "border-red-500/40 text-red-300"
                              : "border-violet-500/40 text-violet-300"
                          }`}
                        >
                          🧅 Tor
                          {r.exitIp
                            ? ` · ${r.exitIp}`
                            : r.anonStatus === "no-tor"
                              ? " · not installed"
                              : " · connecting…"}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Anonymity toggle */}
                  <form action={setRunnerAnonymity} className="mt-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="on" value={(!r.anonymity).toString()} />
                    <button
                      className={`text-xs ${
                        r.anonymity
                          ? "text-violet-300 hover:text-violet-200"
                          : "text-gray-500 hover:text-violet-300"
                      }`}
                    >
                      {r.anonymity ? "Turn off Tor" : "🧅 Turn on Tor (anonymize)"}
                    </button>
                  </form>

                  {/* Tor not installed → one-click install */}
                  {r.anonymity && r.anonStatus === "no-tor" && r.lastSeenAt && (
                    <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-200">
                      Tor isn&apos;t installed on this machine, so traffic can&apos;t be
                      anonymized. Install it:
                      <div className="mt-1.5 flex gap-2">
                        {(["tor", "torsocks"] as const).map((pkg) => (
                          <form key={pkg} action={requestInstall}>
                            <input type="hidden" name="runnerId" value={r.id} />
                            <input type="hidden" name="tool" value={pkg} />
                            <input type="hidden" name="confirm" value="true" />
                            <button className="btn-ghost px-2 py-1 text-xs">Install {pkg}</button>
                          </form>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Install missing tools (authorized) */}
                  {r.lastSeenAt && (missing.length > 0 || r.installs.length > 0) && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-gray-500 hover:text-brand">
                        <Icon name="wrench" className="mr-1 inline h-3 w-3" />
                        Install tools{missing.length > 0 ? ` (${missing.length} missing)` : ""}
                      </summary>

                      {missing.length > 0 ? (
                        <form action={requestInstall} className="mt-2 space-y-2">
                          <input type="hidden" name="runnerId" value={r.id} />
                          <select
                            name="tool"
                            className="w-full rounded-md border border-surface-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
                          >
                            {missing.map((t) => (
                              <option key={t} value={t}>
                                {t} → apt {INSTALLABLE_PKGS[t]}
                              </option>
                            ))}
                          </select>
                          <label className="flex items-start gap-2 text-xs text-gray-400">
                            <input
                              type="checkbox"
                              name="confirm"
                              value="true"
                              required
                              className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
                            />
                            I authorize installing software on this machine (I have permission).
                          </label>
                          <button className="btn-ghost px-2 py-1 text-xs">Install</button>
                        </form>
                      ) : (
                        <p className="mt-2 text-xs text-gray-500">
                          All installable tools are present.
                        </p>
                      )}

                      {r.installs.length > 0 && (
                        <ul className="mt-2 space-y-1.5">
                          {r.installs.map((ins) => (
                            <li key={ins.id} className="text-xs">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-gray-300">{ins.tool}</span>
                                <span
                                  className={
                                    ins.status === "failed"
                                      ? "text-red-300"
                                      : ins.status === "installing"
                                        ? "text-sky-300"
                                        : ins.status === "done"
                                          ? "text-emerald-300"
                                          : "text-amber-300"
                                  }
                                >
                                  {ins.status === "installing" && (
                                    <span className="pulse-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
                                  )}
                                  {ins.status}
                                </span>
                              </div>
                              {ins.output && (
                                <details className="mt-1" open={ins.status === "installing"}>
                                  <summary className="cursor-pointer text-[11px] text-gray-500 hover:text-brand">
                                    {ins.status === "installing" ? "Live output" : "Output"}
                                  </summary>
                                  <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-surface-border bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-gray-300">
                                    {ins.output}
                                  </pre>
                                </details>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      <p className="mt-2 text-[11px] text-gray-600">
                        httpx isn&apos;t an apt package — install it manually. Installs
                        need the machine to run the runner as root, set{" "}
                        <code className="font-mono">RUNNER_SUDO_PASS</code>, or have
                        passwordless sudo for apt. (Never put a sudo password in the portal.)
                      </p>
                    </details>
                  )}
                </div>
                <form action={deleteRunner}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-xs text-gray-600 hover:text-red-400">Revoke</button>
                </form>
              </div>
            );
          })}
        </div>
      )}

      <Link
        href="/dashboard/jobs"
        className="card-hover mt-6 flex items-center justify-between"
      >
        <span className="flex items-center gap-2 text-sm text-gray-300">
          <Icon name="bolt" className="h-4 w-4 text-brand" />
          Queue &amp; monitor jobs on these machines
        </span>
        <Icon name="arrow" className="h-4 w-4 text-gray-500" />
      </Link>
    </div>
  );
}
