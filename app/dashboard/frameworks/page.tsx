import { Icon } from "@/components/icons";
import {
  MITRE_TACTICS,
  OWASP_TOP10,
  NIST_CSF,
  TOOL_FRAMEWORKS,
} from "@/data/frameworks";

export const dynamic = "force-dynamic";

export default function FrameworksPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Frameworks &amp; standards</h1>
        <p className="mt-1 max-w-2xl text-gray-400">
          The references RD-AISEC works from — attacker tactics, common web risks,
          a governance model, and the tooling our scans build on. The knowledge
          base and assistant draw on these, and findings can be mapped to them.
        </p>
      </div>

      {/* MITRE ATT&CK */}
      <section>
        <div className="flex items-center gap-2">
          <Icon name="skull" className="h-5 w-5 text-red-400" />
          <h2 className="text-lg font-bold">MITRE ATT&amp;CK — Enterprise tactics</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          The adversary&apos;s goals across the attack lifecycle. Map each finding
          to the tactic it enables.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MITRE_TACTICS.map((t) => (
            <div key={t.id} className="card">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-white">{t.name}</p>
                <span className="tag font-mono text-[10px]">{t.id}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">{t.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* OWASP Top 10 */}
      <section>
        <div className="flex items-center gap-2">
          <Icon name="alert" className="h-5 w-5 text-amber-400" />
          <h2 className="text-lg font-bold">OWASP Top 10 (2021)</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">The most critical web-app security risks.</p>
        <div className="mt-4 space-y-2">
          {OWASP_TOP10.map((o) => (
            <div key={o.id} className="card flex items-start gap-3 py-3">
              <span className="tag shrink-0 font-mono text-amber-300">{o.id}</span>
              <div>
                <p className="font-semibold text-white">{o.name}</p>
                <p className="text-xs text-gray-400">{o.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* NIST CSF */}
      <section>
        <div className="flex items-center gap-2">
          <Icon name="shield" className="h-5 w-5 text-sky-400" />
          <h2 className="text-lg font-bold">NIST Cybersecurity Framework 2.0</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">The six core functions of a security program.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {NIST_CSF.map((n) => (
            <div key={n.id} className="card text-center">
              <span className="tag font-mono">{n.id}</span>
              <p className="mt-2 text-sm font-semibold text-white">{n.name}</p>
              <p className="mt-1 text-[11px] text-gray-500">{n.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tools & detection frameworks */}
      <section>
        <div className="flex items-center gap-2">
          <Icon name="wrench" className="h-5 w-5 text-brand" />
          <h2 className="text-lg font-bold">Tooling &amp; detection frameworks</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">What the runner and detections build on.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {TOOL_FRAMEWORKS.map((t) => (
            <a
              key={t.name}
              href={t.url}
              target="_blank"
              rel="noopener noreferrer"
              className="card-hover"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-white">{t.name}</p>
                <span className="tag">{t.kind}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">{t.desc}</p>
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-brand">
                Docs <Icon name="arrow" className="h-3 w-3" />
              </p>
            </a>
          ))}
        </div>
      </section>

      <p className="text-xs text-gray-600">
        References to MITRE ATT&amp;CK®, OWASP, NIST, and the listed tools belong to
        their respective owners. Shown for authorized testing and education.
      </p>
    </div>
  );
}
