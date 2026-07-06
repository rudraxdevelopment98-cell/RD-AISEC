import { Icon } from "@/components/icons";
import { addEvidence, addCustody, deleteEvidence } from "@/lib/forensics";
import { EVIDENCE_KINDS, CUSTODY_ACTIONS, HASH_ALGOS, kindLabel, actionLabel, actionColor } from "@/lib/forensics-core";

type CustodyEvent = { id: string; action: string; actor: string; notes: string; at: Date };
type EvidenceItem = {
  id: string; name: string; kind: string; source: string; hashAlgo: string; hashValue: string;
  size: string; storage: string; acquiredBy: string; acquiredAt: Date; notes: string; custody: CustodyEvent[];
};

const field = "rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand";

export function EvidencePanel({ engagementId, evidence }: { engagementId: string; evidence: EvidenceItem[] }) {
  return (
    <div id="evidence" className="scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Icon name="fingerprint" className="h-5 w-5 text-brand" /> Evidence &amp; chain of custody
          <span className="text-sm font-normal text-gray-500">({evidence.length})</span>
        </h2>
      </div>
      <p className="mt-1 text-sm text-gray-400">
        Register each acquired item with an integrity hash; every hand-off is logged
        so custody is auditable end to end.
      </p>

      {/* Register evidence */}
      <details className="card mt-3">
        <summary className="cursor-pointer font-semibold text-brand">+ Register evidence</summary>
        <form action={addEvidence} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="engagementId" value={engagementId} />
          <input name="name" required placeholder="Evidence name * (e.g. Laptop-01 disk image)" className={`${field} sm:col-span-2`} />
          <select name="kind" defaultValue="disk" className={`${field} capitalize`}>
            {EVIDENCE_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select>
          <input name="source" placeholder="Source (device / host / path)" className={field} />
          <select name="hashAlgo" defaultValue="sha256" className={field}>
            {HASH_ALGOS.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <input name="hashValue" placeholder="Integrity hash (hex)" className={`${field} font-mono`} />
          <input name="size" placeholder="Size (e.g. 500 GB)" className={field} />
          <input name="storage" placeholder="Stored at (drive / vault)" className={field} />
          <input name="acquiredBy" placeholder="Acquired by (defaults to you)" className={field} />
          <textarea name="notes" rows={2} placeholder="Notes" className={`${field} sm:col-span-2`} />
          <button className="btn-primary sm:col-span-2">Register &amp; open custody</button>
        </form>
      </details>

      {/* Evidence list */}
      {evidence.length === 0 ? (
        <p className="card mt-3 text-sm text-gray-500">No evidence registered yet.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {evidence.map((e) => {
            const hashed = !!e.hashValue;
            return (
              <div key={e.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{e.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="tag">{kindLabel(e.kind)}</span>
                      {e.size && <span className="tag">{e.size}</span>}
                      <span className={`tag ${hashed ? "ring-emerald accent-emerald" : "border-amber-500/40 text-amber-300"}`}>
                        {hashed ? "✓ hashed" : "no hash"}
                      </span>
                    </div>
                  </div>
                  <form action={deleteEvidence}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="engagementId" value={engagementId} />
                    <button className="text-xs text-gray-600 hover:text-red-400">Delete</button>
                  </form>
                </div>

                <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                  {e.source && <Row k="Source" v={e.source} />}
                  {e.storage && <Row k="Stored at" v={e.storage} />}
                  <Row k="Acquired by" v={`${e.acquiredBy} · ${new Date(e.acquiredAt).toLocaleString()}`} />
                  {hashed && <Row k={e.hashAlgo} v={<span className="break-all font-mono">{e.hashValue}</span>} />}
                </dl>
                {e.notes && <p className="mt-2 text-xs text-gray-400">{e.notes}</p>}

                {/* Chain of custody */}
                <div className="mt-3 border-t border-surface-border pt-3">
                  <p className="text-xs font-semibold text-gray-400">Chain of custody</p>
                  <ol className="mt-2 space-y-1.5">
                    {e.custody.map((c) => (
                      <li key={c.id} className="flex items-start gap-2 text-xs">
                        <span className={`mt-0.5 tag ring-${actionColor(c.action)} accent-${actionColor(c.action)}`}>{actionLabel(c.action)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="text-gray-300">{c.actor || "—"}</span>
                          <span className="text-gray-500"> · {new Date(c.at).toLocaleString()}</span>
                          {c.notes && <span className="block text-gray-500">{c.notes}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <form action={addCustody} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="evidenceId" value={e.id} />
                    <input type="hidden" name="engagementId" value={engagementId} />
                    <select name="action" defaultValue="analyzed" className={`${field} py-1.5 text-xs capitalize`}>
                      {CUSTODY_ACTIONS.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
                    </select>
                    <input name="notes" placeholder="Note (who / why)" className={`${field} flex-1 py-1.5 text-xs`} />
                    <button className="btn-ghost px-3 py-1.5 text-xs">Add custody event</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-gray-500">{k}</dt>
      <dd className="min-w-0 text-right text-gray-300">{v}</dd>
    </div>
  );
}
