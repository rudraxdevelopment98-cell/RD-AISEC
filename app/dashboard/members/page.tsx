import { auth, isOwnerEmail } from "@/auth";
import { Icon } from "@/components/icons";
import { HelpBanner } from "@/components/hint";
import { listMembers, ownerEmails } from "@/lib/members";
import { addMember, updateMemberAccess, setMemberStatus, removeMember } from "@/lib/member-actions";
import { GRANTABLE_ITEMS } from "@/lib/access";

export const dynamic = "force-dynamic";

// Grantable items grouped for the access checkboxes.
const GROUPS = GRANTABLE_ITEMS.reduce<Record<string, typeof GRANTABLE_ITEMS>>((acc, i) => {
  (acc[i.group] ??= []).push(i);
  return acc;
}, {});

const STATUS_STYLE: Record<string, string> = {
  approved: "ring-emerald accent-emerald",
  pending: "ring-amber accent-amber",
  suspended: "border-red-500/40 text-red-300",
};

function AccessCheckboxes({ checked }: { checked: Set<string> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Object.entries(GROUPS).map(([group, items]) => (
        <div key={group}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{group}</p>
          <div className="mt-1 space-y-1">
            {items.map((i) => (
              <label key={i.key} className="flex items-center gap-2 text-xs text-gray-300">
                <input type="checkbox" name="access" value={i.key} defaultChecked={checked.has(i.key)} />
                {i.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: { ok?: string; error?: string };
}) {
  const session = await auth();
  const email = session?.user?.email ?? "";

  if (!isOwnerEmail(email)) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">Members</h1>
        <p className="mt-3 card text-sm text-gray-400">
          Only an owner can manage members. Owners are set via the
          <code className="mx-1 rounded bg-black/40 px-1">AUTHORIZED_EMAILS</code>
          environment variable.
        </p>
      </div>
    );
  }

  const members = await listMembers();
  const owners = ownerEmails();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold">Members</h1>
      <p className="mt-1 text-gray-400">
        Invite teammates by email and scope what they can see. They sign in with
        the same email (Google) — only approved members get in.
      </p>

      <HelpBanner>
        <p>• Add a member by email and tick the sections they should access.</p>
        <p>• They sign in via Google with that email; un-approved emails are blocked.</p>
        <p>• Edit access anytime, suspend to revoke without deleting, or remove entirely.</p>
        <p>• Owners (set via AUTHORIZED_EMAILS) always have full access and aren&apos;t listed here.</p>
      </HelpBanner>

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

      {owners.length > 0 && (
        <p className="mt-4 text-xs text-gray-500">
          Owners (full access): {owners.join(", ")}
        </p>
      )}

      {/* Add member */}
      <form action={addMember} className="card mt-4 space-y-3">
        <p className="font-semibold text-white">Add a member</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            name="email"
            type="email"
            required
            placeholder="teammate@email.com"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            name="name"
            placeholder="Name (optional)"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-400">Access</p>
          <div className="mt-2">
            <AccessCheckboxes checked={new Set()} />
          </div>
        </div>
        <button className="btn-primary text-sm">Add member</button>
      </form>

      {/* Members list */}
      <h2 className="mt-8 text-lg font-bold">
        Team {members.length > 0 && <span className="text-sm font-normal text-gray-500">({members.length})</span>}
      </h2>
      {members.length === 0 ? (
        <p className="mt-3 card text-sm text-gray-500">No members yet. Add one above.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {members.map((m) => {
            const checked = new Set((m.access ?? "").split(",").map((s) => s.trim()).filter(Boolean));
            const labels = GRANTABLE_ITEMS.filter((i) => checked.has(i.key)).map((i) => i.label);
            return (
              <div key={m.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{m.name || m.email}</p>
                    {m.name && <p className="text-xs text-gray-500">{m.email}</p>}
                    <p className="mt-1 text-xs text-gray-400">
                      Access: {labels.length ? labels.join(", ") : "— none yet"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`tag capitalize ${STATUS_STYLE[m.status] ?? ""}`}>{m.status}</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <form action={setMemberStatus}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="status" value={m.status === "approved" ? "suspended" : "approved"} />
                    <button className={m.status === "approved" ? "text-amber-400 hover:text-amber-300" : "text-emerald-400 hover:text-emerald-300"}>
                      {m.status === "approved" ? "Suspend" : "Approve"}
                    </button>
                  </form>
                  <form action={removeMember}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="text-gray-500 hover:text-red-400">Remove</button>
                  </form>
                </div>

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-brand hover:underline">Edit access</summary>
                  <form action={updateMemberAccess} className="mt-3 space-y-3">
                    <input type="hidden" name="id" value={m.id} />
                    <AccessCheckboxes checked={checked} />
                    <button className="btn-ghost text-xs">Save access</button>
                  </form>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
