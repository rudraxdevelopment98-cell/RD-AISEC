"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { launchAutoscan } from "@/lib/autoscan";

/**
 * Global floating autoscan launcher — fixed to the bottom-right on every page.
 * Type any in-scope target, pick a machine (and optionally an engagement to
 * auto-import findings), and queue a scan without leaving the current page.
 */
export function AutoscanFab({
  runners,
  engagements,
}: {
  runners: { id: string; name: string }[];
  engagements: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-10 right-5 z-40 flex flex-col items-end print:hidden">
      {open && (
        <form
          action={launchAutoscan}
          className="mb-3 w-72 rounded-xl border border-surface-border bg-surface/95 p-3 shadow-2xl backdrop-blur"
        >
          <div className="flex items-center gap-2">
            <Icon name="radar" className="h-4 w-4 text-brand" />
            <span className="text-sm font-semibold text-white">Autoscan a target</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Host or URL. Only scan what you&apos;re authorized to test.
          </p>
          <input
            name="target"
            required
            placeholder="example.com or https://app.example.com"
            className="mt-2 w-full rounded-lg border border-surface-border bg-black/40 px-3 py-2 text-xs text-gray-200 outline-none focus:border-brand"
          />
          <select
            name="runnerId"
            className="mt-2 w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand"
          >
            {runners.length === 0 ? (
              <option value="">No machine online</option>
            ) : (
              runners.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))
            )}
          </select>
          <select
            name="engagementId"
            defaultValue=""
            className="mt-2 w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand"
          >
            <option value="">Ad-hoc (don&apos;t import findings)</option>
            {engagements.map((e) => (
              <option key={e.id} value={e.id}>
                Import into: {e.name}
              </option>
            ))}
          </select>
          <input type="hidden" name="back" value="/dashboard/jobs" />
          <button
            type="submit"
            disabled={runners.length === 0}
            className="btn-primary mt-3 w-full text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name="bolt" className="mr-1 inline h-4 w-4" /> Launch autoscan
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Autoscan a target"
        className="grid h-12 w-12 place-items-center rounded-full bg-brand text-black shadow-xl transition hover:scale-105"
      >
        <Icon name={open ? "x" : "radar"} className="h-6 w-6" />
      </button>
    </div>
  );
}
