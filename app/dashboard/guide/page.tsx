import Link from "next/link";
import { Icon } from "@/components/icons";

export const dynamic = "force-dynamic";

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/20 text-sm font-semibold text-brand">
        {n}
      </span>
      <div className="min-w-0 flex-1 pb-5">
        <h3 className="font-semibold text-white">{title}</h3>
        <div className="mt-1 space-y-1 text-sm text-gray-400">{children}</div>
      </div>
    </div>
  );
}

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">How it works — full guide</h1>
      <p className="mt-1 text-gray-400">
        End-to-end: from a bug-bounty program to a confirmed, reported bug. Follow
        the worked example, then do it on your own engaged program.
      </p>

      {/* Worked example banner */}
      <div className="mt-5 rounded-xl border border-brand/30 bg-brand/5 p-4">
        <p className="text-sm font-semibold text-brand-glow">🧪 Worked example</p>
        <p className="mt-1 text-sm text-gray-300">
          You&apos;ve engaged a program — say <b>Acme</b> on HackerOne, scope{" "}
          <code className="font-mono text-xs">*.acme.com, api.acme.com, www.acme.com</code>.
          Here&apos;s exactly what to click and what happens at each step.
        </p>
      </div>

      {/* Prereqs */}
      <h2 className="mt-8 text-lg font-semibold">Before you start (one time)</h2>
      <div className="card mt-3 space-y-2 text-sm text-gray-400">
        <p>
          <Icon name="server" className="mr-1 inline h-4 w-4 text-brand" />
          Your <Link href="/dashboard/runners" className="text-brand hover:underline">Kali machine</Link> must
          be online and running the latest runner (re-pull if the Machines page flags it outdated).
        </p>
        <p>
          <Icon name="wrench" className="mr-1 inline h-4 w-4 text-brand" />
          Tools installed (nuclei, nmap, httpx, gobuster, nikto, sslscan, searchsploit, sqlmap, wpscan, metasploit).
          The engagement&apos;s <b>Readiness check</b> tells you what&apos;s missing and installs it in one click.
        </p>
        <p>
          <Icon name="bot" className="mr-1 inline h-4 w-4 text-brand" />
          Optional: set a <Link href="/dashboard/settings" className="text-brand hover:underline">Discord/Slack webhook</Link> so
          you get pinged when a finding is confirmed.
        </p>
      </div>

      {/* The flow */}
      <h2 className="mt-8 text-lg font-semibold">The flow, step by step</h2>
      <div className="card mt-3">
        <Step n="1" title="Add the program">
          <p>
            Go to <Link href="/dashboard/bugbounty" className="text-brand hover:underline">Bug Bounty</Link>,
            add <b>Acme</b>, and paste the in-scope targets (one per line). Tip: tag it with a
            category (e.g. <code className="text-xs">HackerOne</code>) so you can filter later.
          </p>
        </Step>
        <Step n="2" title="Engage it (create the engagement)">
          <p>
            On the program card click <b>Create engagement</b>. This makes an{" "}
            <i>authorized</i> engagement from the scope — that authorization is what
            unlocks scanning &amp; exploitation. Only engaged programs are automated.
          </p>
        </Step>
        <Step n="3" title="Open the engagement → check Readiness">
          <p>
            Open the engagement. The <b>Readiness check</b> at the top should be all
            green. If anything is red (runner offline, tools missing, no scope),
            fix it there first — that&apos;s the #1 reason scans find nothing.
          </p>
        </Step>
        <Step n="4" title="Run the scan — two ways">
          <p>
            <b>A) Quick:</b> in the <b>Command center</b>, click <b>Scan &amp; recon</b>{" "}
            (or <b>⚡ Deep scan</b> for all-ports + vuln scripts). It runs immediately
            on your runner.
          </p>
          <p>
            <b>B) Guided:</b> in the <b>Assessment pipeline</b>, click{" "}
            <b>Run full assessment</b>. It runs recon → scan → exploit → triage →
            report, pausing for your <b>approval</b> between stages (or flip{" "}
            <b>auto-approve</b> to run hands-off). Each stage shows live progress;
            you can <b>↻ re-run a stage deeper</b> any time.
          </p>
        </Step>
        <Step n="5" title="Findings appear automatically">
          <p>
            As tools finish, results are parsed into <Link href="/dashboard/findings" className="text-brand hover:underline">Findings</Link>{" "}
            — auto-tagged to MITRE ATT&amp;CK / OWASP, with a risk-coloured glow.
            Critical/high nuclei hits and validated issues come in pre-confirmed.
          </p>
        </Step>
        <Step n="6" title="Pick a finding → ⚔ Exploit it">
          <p>
            On any finding click <b>⚔ Exploit it</b>. On the exploit page hit{" "}
            <b>Check exploitability &amp; find exploit</b> — it searches Exploit-DB and
            runs the right non-destructive validations (nmap vuln, sslscan, sqlmap
            detect, focused nuclei, Metasploit checks). Watch the output stream{" "}
            <b>live</b> right there.
          </p>
        </Step>
        <Step n="7" title="Do the real test">
          <p>
            Under <b>Exploit techniques</b> you get the matched playbook&apos;s commands,
            pre-filled to the target — click <b>▶ Run this on the runner</b> to actually
            test it, and watch it live. No public exploit? Click <b>Build exploit in the
            Lab</b> to generate a PoC (edit it, optionally AI-draft it, save it to your
            Kali folder, run it).
          </p>
        </Step>
        <Step n="8" title="Confirm it yourself">
          <p>
            When a check proves it, a glowing <b>✅ Confirmed exploitable</b> banner
            appears. Once you&apos;ve seen it work with your own eyes, click{" "}
            <b>✅ I tested it — mark confirmed</b>. It records who/when, glows the
            finding red everywhere, and pings your webhook.
          </p>
        </Step>
        <Step n="9" title="Report it">
          <p>
            Open the engagement <b>Report</b> for the write-up (with remediation the
            triage stage filled in), copy the submission draft, and submit it on the
            platform. Mark the finding fixed/accepted as the program responds.
          </p>
        </Step>
      </div>

      {/* Tips */}
      <h2 className="mt-8 text-lg font-semibold">Tips that matter</h2>
      <div className="card mt-3 space-y-2 text-sm text-gray-400">
        <p>• <b>CDN/cloud targets</b> (Cloudflare/Fastly, like big SaaS): full port scans find little — lean on web scans (nuclei/nikto/gobuster) and app-layer tests.</p>
        <p>• <b>Nothing found?</b> Open Readiness → look for job <b>timeouts</b> or failures. Re-pull the runner (latest = bounded, longer scans).</p>
        <p>• <b>Go deeper</b> on a promising target with <b>Deep scan</b>, or <b>↻ Re-run deeper</b> on a single pipeline stage.</p>
        <p>• Everything is <b>authorization-gated</b> — only what the program&apos;s scope explicitly allows. Keep it in scope.</p>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/dashboard/bugbounty" className="btn-primary text-sm">
          <Icon name="target" className="mr-1 inline h-4 w-4" /> Go to Bug Bounty
        </Link>
        <Link href="/dashboard/engagements" className="btn-ghost text-sm">
          <Icon name="briefcase" className="mr-1 inline h-4 w-4" /> Open Engagements
        </Link>
      </div>

      <p className="mt-8 text-center text-xs text-gray-600">
        AI Security Operating System — Founded, Architected &amp; Led by — Kuldeep J
      </p>
    </div>
  );
}
