"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { runAiRecon } from "@/lib/engagements";
import type { ReconBrief } from "@/lib/engine/ai-browse";

/**
 * AI recon browse — a button that lets the engine's AI read the engagement's
 * in-scope pages and return a structured brief (summary, tech, sensitive
 * endpoints, auth model, prioritized tests + tools). Owner + key + scope gated
 * server-side; this is purely the trigger + render surface.
 */
export function AiRecon({ engagementId, authorized }: { engagementId: string; authorized: boolean }) {
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<ReconBrief | null>(null);

  async function run() {
    setLoading(true);
    setBrief(null);
    try {
      setBrief(await runAiRecon(engagementId));
    } catch {
      setBrief({
        enabled: false,
        error: "The request failed. Check the server logs and ANTHROPIC_API_KEY.",
        summary: "",
        techStack: [],
        sensitiveEndpoints: [],
        authModel: "",
        suggestedTests: [],
        suggestedTools: [],
        pagesFetched: [],
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card mt-4">
      <div className="flex items-center gap-2">
        <Icon name="bot" className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold text-white">AI recon (browse the target)</h3>
        <span className="tag text-[10px]">reads in-scope pages</span>
        <button onClick={run} disabled={loading || !authorized} className="btn-primary ml-auto text-xs">
          {loading ? (
            <>
              <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" />
              Reading…
            </>
          ) : (
            <>
              <Icon name="bolt" className="mr-1 inline h-3.5 w-3.5" />
              Run AI recon
            </>
          )}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        The AI fetches your in-scope URLs (plain GET only — no login, no exploitation), reads them,
        and suggests what to test and which tools to run. Owner-only; needs authorization + a server API key.
      </p>

      {brief && !brief.enabled && (
        <p className="mt-3 rounded-lg border border-sev-med/40 bg-sev-med/10 px-3 py-2 text-xs text-sev-med">
          {brief.error || "AI recon is unavailable."}
        </p>
      )}

      {brief && brief.enabled && (
        <div className="mt-3 space-y-3 border-t border-surface-border pt-3 text-sm">
          {brief.summary && <p className="text-gray-300">{brief.summary}</p>}

          {brief.authModel && (
            <p className="text-xs text-gray-400">
              <span className="font-semibold text-gray-300">Auth model:</span> {brief.authModel}
            </p>
          )}

          {brief.techStack.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {brief.techStack.map((t) => (
                <span key={t} className="tag text-[10px]">{t}</span>
              ))}
            </div>
          )}

          {brief.suggestedTests.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-300">Prioritized tests</p>
              <ul className="space-y-1.5">
                {brief.suggestedTests.map((s, i) => (
                  <li key={i} className="text-xs">
                    <span className="text-brand">▸</span> <span className="text-gray-200">{s.title}</span>
                    {s.why && <span className="text-gray-500"> — {s.why}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.sensitiveEndpoints.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-300">Endpoints worth testing</p>
              <ul className="space-y-0.5">
                {brief.sensitiveEndpoints.map((u) => (
                  <li key={u} className="truncate font-mono text-[11px] text-gray-400">{u}</li>
                ))}
              </ul>
            </div>
          )}

          {brief.suggestedTools.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-300">Run these next</p>
              <div className="flex flex-wrap gap-1.5">
                {brief.suggestedTools.map((t) => (
                  <span key={t} className="tag border-brand/40 text-brand text-[10px]">{t}</span>
                ))}
              </div>
            </div>
          )}

          {brief.pagesFetched.length > 0 && (
            <p className="text-[10px] text-gray-600">Read: {brief.pagesFetched.join("  ·  ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
