"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Icon } from "@/components/icons";
import { createRunner } from "@/lib/runners";

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
      {pending ? "Creating…" : "Create runner"}
    </button>
  );
}

export function CreateRunnerForm() {
  const [state, formAction] = useFormState(createRunner, {});
  const [origin, setOrigin] = useState("https://rd-aisec.vercel.app");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  // One paste saves the config permanently (survives reboots / new terminals).
  const setupCmd = state.token
    ? `mkdir -p ~/.config/rdaisec && cat > ~/.config/rdaisec/runner.env <<'EOF'
PORTAL_URL=${origin}
RUNNER_TOKEN=${state.token}
MAX_WORKERS=3
EOF
chmod 600 ~/.config/rdaisec/runner.env`
    : "";

  return (
    <div className="card mt-6">
      <h2 className="font-semibold text-brand">+ Register a runner</h2>
      <p className="mt-1 text-sm text-gray-400">
        Create a runner for the machine that will execute tools (e.g. your Kali VM
        in UTM). You&apos;ll get a token — copy it now, it&apos;s shown only once.
      </p>

      <form action={formAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          name="name"
          required
          placeholder="Runner name — e.g. Kali-UTM-SSD"
          className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <SubmitButton />
      </form>

      {state.error && <p className="mt-2 text-xs text-red-400">{state.error}</p>}

      {state.token && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-300">
            <Icon name="lock" className="mr-1 inline h-4 w-4" />
            Token for “{state.name}” — copy it now, it won&apos;t be shown again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-surface-border bg-black/50 px-3 py-2 font-mono text-xs text-amber-200">
              {state.token}
            </code>
            <CopyButton value={state.token} label="Copy token" />
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-gray-300">
              Turnkey setup — paste this on your Kali machine (saves the token
              permanently):
            </p>
            <CopyButton value={setupCmd} label="Copy setup" />
          </div>
          <pre className="mt-1 overflow-x-auto rounded-md border border-surface-border bg-black/50 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-300">
            {setupCmd}
          </pre>
          <p className="mt-2 text-xs text-gray-400">
            Then start the runner:{" "}
            <code className="rounded bg-black/40 px-1 text-gray-300">python3 rdaisec_runner.py</code>{" "}
            — or run{" "}
            <code className="rounded bg-black/40 px-1 text-gray-300">bash setup.sh</code>{" "}
            to also start it on boot (auto-restart). Real{" "}
            <code className="rounded bg-black/40 px-1 text-gray-300">export</code> vars still override the file.
          </p>
        </div>
      )}
    </div>
  );
}
