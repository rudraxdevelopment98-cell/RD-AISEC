"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Icon } from "@/components/icons";
import { createEnrollCode } from "@/lib/runners";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="btn-ghost px-2 py-1 text-xs"
    >
      <Icon name={copied ? "check" : "copy"} className="h-3 w-3" />
      {copied ? "Copied" : label}
    </button>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50">
      {pending ? "Generating…" : "Generate enrollment code"}
    </button>
  );
}

export function EnrollCodeForm() {
  const [state, formAction] = useFormState(createEnrollCode, {});
  const [origin, setOrigin] = useState("https://rd-aisec.vercel.app");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  // One command installs the runner as a self-healing service: it self-enrolls for
  // a token, saves it, and re-enrolls automatically if the token is ever rotated —
  // no editing systemd, ever.
  // ONE line on purpose — multi-line commands with backslash-continuations get
  // mangled when copied through chat apps / paste, so we keep it a single robust
  // chain: clean any old clone, shallow-clone, then run the installer with the
  // enrollment code passed straight through sudo (no token needed).
  const cmd = state.code
    ? `rm -rf rd-aisec && git clone --depth 1 https://github.com/rudraxdevelopment98-cell/rd-aisec.git && cd rd-aisec/runner && RUNNER_ENROLL_CODE=${state.code} PORTAL_URL=${origin} bash install-runner.sh`
    : "";

  const expires = state.expiresAt ? new Date(state.expiresAt).toLocaleDateString() : "";

  return (
    <div className="card mt-6">
      <h2 className="font-semibold text-brand">
        <Icon name="bolt" className="mr-1 inline h-4 w-4" />
        Add a machine
      </h2>
      <p className="mt-1 text-sm text-gray-400">
        Generate an enrollment code, run one command on the machine, and it comes
        online — registering itself for a token. If that token is ever rotated or
        wiped, it fetches a fresh one automatically, so a machine never goes dark
        over a bad token again. The code is reusable and revocable; shown only once.
      </p>

      <form action={formAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          name="label"
          placeholder="Label (optional) — e.g. home-lab machines"
          className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          name="days"
          type="number"
          min={1}
          max={365}
          defaultValue={90}
          title="Days until the code expires"
          className="w-28 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <SubmitButton />
      </form>

      {state.error && <p className="mt-2 text-xs text-sev-crit">{state.error}</p>}

      {state.code && (
        <div className="mt-4 rounded-lg border border-sev-med/40 bg-sev-med/10 p-4">
          <p className="text-sm font-semibold text-sev-med">
            <Icon name="lock" className="mr-1 inline h-4 w-4" />
            Enrollment code {expires && `(expires ${expires})`} — copy it now, it won&apos;t be shown again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-surface-border bg-black/50 px-3 py-2 font-mono text-xs text-sev-med">
              {state.code}
            </code>
            <CopyButton value={state.code} label="Copy code" />
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-gray-300">
              One command on your Kali machine — installs a self-healing service:
            </p>
            <CopyButton value={cmd} label="Copy command" />
          </div>
          <pre className="mt-1 overflow-x-auto rounded-md border border-surface-border bg-black/50 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300">
            {cmd}
          </pre>
          <p className="mt-2 text-xs text-gray-400">
            The machine appears below within a few seconds, online. If its token is
            ever rejected, it re-enrolls with this code on its own.
          </p>
        </div>
      )}
    </div>
  );
}
