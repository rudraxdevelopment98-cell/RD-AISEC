# RD-AISEC — Engine Reality Check & Roadmap to a Useful Bug-Finding System

_Owner: Kuldeep J. · Written 2026-08-14 · Honest internal assessment, not marketing._

The question that matters: **does this engine actually find real, reportable
vulnerabilities — or is it a prototype that wraps tools?** This document answers
that bluntly, grounds it in how the leading 2025–2026 systems work, and lays out
a phased plan to close the gap. No comment-driven optimism — file-level evidence.

---

## 1. Honest scorecard (what the engine REALLY does today)

| Capability | Verdict | Evidence |
|---|---|---|
| Tool orchestration (nuclei/nmap/sqlmap/dalfox/httpx/katana/…) | **REAL** | `lib/engine/strategy.ts`, `lib/pipeline-engine.ts` — solid, deduped, per-tool timeouts |
| Accuracy layer (gate, freshness, KEV, dedup, scoring) | **REAL** | `lib/bb-engine.ts`, `lib/finding-gate.ts`, `lib/vuln-freshness.ts`, `lib/finding-ingest.ts` |
| Reporting & submission drafts | **REAL** | `lib/report.ts`, `lib/report-narrative.ts`, `lib/submission.ts` |
| Execution sandbox + job pipeline (the Kali runner) | **REAL** — and a genuine head start | `runner/rdaisec_runner.py`, job queue + result routes |
| Recon depth (iterative: crawl → JS analysis → param discovery → re-scan) | **SHALLOW** | Each stage runs a fixed tool list roughly once; no feedback loop that re-scans newly discovered assets/params |
| Proof-by-exploitation (multi-step, real proof) | **SHALLOW** | "Exploit" mostly = run one tool + set a flag. `validateHypothesis` (new) is the first real step toward proof |
| Authenticated IDOR / BOLA / access-control testing | **MISSING** | `lib/auth-scan.ts` injects ONE session's header into tools. No two-account differential testing — so the top-paying class is structurally invisible |
| Business-logic testing | **MISSING** | No workflow/state tampering engine |
| LLM / agentic reasoning loop | **MISSING** | `lib/ai.ts` is a knowledge-base placeholder; the Claude call is commented out. All "intelligence" is deterministic regex + scoring |
| Continuous ASM (asset inventory, re-test over time) | **MISSING** | Every scan is one-shot |

**Bottom line:** we have a strong *tool-orchestrator with a good accuracy and
reporting layer, plus a real execution sandbox*. What we do **not** have is the
three things that separate a useful autonomous finder from a scanner wrapper.

---

## 2. Why it feels like a prototype (3 root causes)

1. **It can't see the bugs that pay.** IDOR/BOLA, broken access control and
   business logic are the highest-payout, least-automated classes — and every one
   of them needs **two authenticated accounts** and response comparison (fetch
   user B's object with user A's session; a leak still returns a clean `200`, so a
   single-session scanner is blind). We are single-session. This is the #1 gap.
2. **Recon is one-shot, not a pipeline.** Real results come from layered,
   iterative recon: enumerate → resolve → crawl → **mine JS for endpoints/secrets**
   → discover parameters → feed the new surface back into scanning. We largely run
   a fixed battery once.
3. **There is no reasoning.** The winning systems (XBOW, MAPTA, PentestGPT) are an
   LLM loop: *observe → hypothesize → pick a tool → execute in a sandbox → read the
   result → refine → synthesize a PoC → validate by actually exploiting.* Ours is
   static rules. Rules classify; they don't discover novel, chained, app-specific bugs.

## 3. What world-class engines actually do (2025–2026 research)

- **XBOW** took #1 on HackerOne US (June 2025): 1,060+ valid submissions, incl. a
  48-step blind-SSRF→full-compromise chain; matched a 40-hour manual pentest in 28 min.
- **MAPTA** (open research): coordinator (orchestrate) + sandbox (act) + validation
  (verify), ~77% on the 104-challenge XBOW benchmark; 83% on broken authorization.
- **Universal pattern:** exploit-**validation over detection** — a finding counts
  only if it's actually exploited → ~zero false positives.
- **Reality check:** the same systems drop from ~77% on lab benchmarks to ~13% on
  real CVEs. "Useful" is not "magic" — it's deep recon + testing the classes that
  pay + *proving* what's found. That's an achievable bar; XBOW-parity is not the goal.

Sources: XBOW (digitowl.io, xbow.com/blog), MAPTA (arxiv 2508.20816,
emergentmind.com), scanner blind spots (stingrai.io, precursorsecurity.com),
recon methodology (Bug-Bounty-Hunting-Methodology-2025).

---

## 4. Roadmap — prototype → useful (each phase is independently valuable & shippable)

**Phase 1 — Authenticated IDOR / BOLA differential engine.** _(highest value, no LLM needed)_
Two in-scope accounts (A, B). Crawl object-id-bearing endpoints; for each, replay
A's request with B's session (and unauthenticated), and **compare responses** —
same body/length/status where it should be denied ⇒ IDOR/BOLA. Deterministic,
testable, and it finds the class that actually pays. Foundation module:
`lib/idor-core.ts` (pure diff logic) → runner-executed replay → findings.

**Phase 2 — Iterative recon pipeline.** ✅ _Done (first cut)._ `lib/recon-extract.ts`
mines a crawl's output (absolute URLs + JS-embedded relative paths, assets
dropped, paths resolved to the host) into an endpoint + parameter inventory. On a
crawl result (katana/gau/…), the run-result route now feeds the PARAMETERIZED URLs
back into targeted follow-up scans — dalfox + nuclei DAST per URL (`queueEndpointScans`,
deduped + capped). Same miner enriches the IDOR candidate pool. Next: loop until
the surface stops growing + arjun-style param discovery + secret mining in JS.

**Phase 3 — The reasoning loop (leverage the runner as the sandbox).** Add an
agent orchestrator on the portal that calls Claude (the app is already wired for
`ANTHROPIC_API_KEY`): give it recon output, let it hypothesize, dispatch a bounded
tool command to the runner, read the result, iterate to a PoC — owner-gated,
budget-capped, allowlisted tools only. This is the transformative step, and we
already own the hard part (the sandbox + job pipeline).

**Phase 4 — Proof-by-exploitation & chaining.** Only surface a finding with a
reproducible proof (extracted row, OOB callback, reflected marker). Correlate
findings into chains (we have `attackChains`) and let the loop pursue them.

**Phase 5 — Continuous ASM.** Persist an asset inventory; re-run recon on a
schedule; diff for new subdomains/endpoints/tech; alert + auto-scan the delta.

---

## 5. What "useful" means (measurable exit criteria)

- Finds and **proves** at least one MEDIUM+ finding on an authorized target that a
  bare `nuclei` pass does not (esp. an IDOR/BOLA via two accounts).
- Every "confirmed" finding carries reproducible evidence, not just a flag.
- A generated report is accepted-quality: class, impact, repro steps, PoC, fix.
- False-positive rate on the informational/recon noise stays ~0 (already strong).

**Immediate next build:** Phase 1, starting with the pure `lib/idor-core.ts`
differential engine (below) — the piece that makes the top-paying class findable.
