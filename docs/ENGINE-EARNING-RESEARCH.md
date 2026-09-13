# RD-AISEC — What actually earns on bug bounty (2026 research + upgrade plan)

_Research date: 2026-09-13. Purpose: stop building a "toy" and make the engine
find real, PAYABLE bugs. Grounded in current sources (see bottom)._

## 1. The 2026 reality (why the current engine would NOT earn)

- **The market is drowning in "AI slop."** After capable AI tools arrived, report
  volume surged **100%+**. Programs are reacting: **GitHub cut public payouts ~50%**
  and moved big rewards to invite-only; **curl and Google** throttled/paused intake
  because of low-quality AI reports. HackerOne shipped **"Hai Triage"** (July 2025) —
  an AI that auto-detects duplicates and flags likely-invalid reports **before a
  human sees them.**
- **Consequence for us:** submitting raw scanner output (nuclei/dalfox/sqlmap
  findings, unproven) now gets **auto-closed as duplicate/informative** and
  **damages the account's reputation/signal** on the platform. That's worse than
  not submitting. Our current pipeline, as-is, would lose — not earn.
- **What pays (2026 rough bands):** info/low → $0–200; medium (self-only SQLi,
  reflected XSS) → $200–500; high (**IDOR affecting other users, SSRF, stored XSS**)
  → $500–2,500; critical (**RCE, auth bypass, mass ATO, sensitive-data exposure**)
  → $2,500–25,000+ (finance/health/infra up to $50–100k).

## 2. How the winner (XBOW) actually does it

XBOW hit **#1 on HackerOne US** (Apr–Jun 2025): 1,000+ reports, **54 critical /
242 high / 524 medium**. Its methodology (from XBOW's own write-up):

1. **Scope parsing (LLM):** turn program policy/scope into structured, machine-usable data.
2. **Asset expansion + target scoring:** expand subdomains, then **prioritize
   high-value targets** by signals — tech stack, WAF presence, status codes,
   redirects, **auth forms**, number of reachable endpoints. Spend effort where ROI is highest.
3. **Autonomous hypothesis → test** across many targets (LLM-driven, like a human attacker).
4. **VALIDATORS = the secret sauce.** "Automated peer reviewers" that **prove each
   finding is real** before it's surfaced — e.g. for XSS a **headless browser
   actually executes the payload**; validation is LLM-based or programmatic per class.
   This is what kills false positives.
5. **Dedupe:** **SimHash** (content similarity) + **imagehash** on headless
   screenshots (visual similarity) to collapse redundant assets/findings.
6. **Focus classes:** RCE, SQLi, XXE, path traversal, **SSRF**, XSS, info
   disclosure, cache poisoning, **secret exposure**.

**The lesson:** the edge is NOT more scanners. It's **prioritize → understand →
hypothesize → PROVE (validator) → dedupe → only surface proven, high-impact,
novel findings.** Automation wins on recon/triage/volume; humans still win on
business logic + creative chaining, so those stay human-in-the-loop.

## 3. Honest gap analysis — RD-AISEC today vs. what earns

| Capability that earns | Have? | Notes |
|---|---|---|
| High-value target scoring/prioritization | ⚠️ partial | discovery/score.ts scores *programs*, not *assets/endpoints* within a target |
| Target understanding (what the app does) | ⚠️ partial | AI recon (ai-browse) exists but needs ANTHROPIC_API_KEY + isn't in the loop |
| Hypothesis → test loop (LLM brain) | ❌ | lib/ai.ts is a placeholder; no real reason→test→verify loop (Phase 3) |
| **Per-class exploit VALIDATORS (prove it)** | ⚠️ weak | we have `confirmed` flag + validation-guide + exploit-confidence, but NO automated per-class proof (no headless-XSS execute, no SSRF OOB callback, no boolean/time SQLi confirm) |
| Dedupe / novelty check | ❌ | nothing stops us reporting a dup → auto-rejected |
| Payability gate (only promote proven+impactful+novel) | ⚠️ partial | bb-engine bbProb + review gate exist, but not a hard "don't surface unless proven & likely-novel" gate |
| Access-control / IDOR / BOLA (top payer) | ✅ good | two-account idor-core/idor-scan — our strongest real edge |
| Secret exposure that actually validates | ⚠️ partial | JS secret mining + validation guide; no safe live key-validity check wired to a finding |
| Human-approved submission | ✅ | HackerOne draft-intent flow — CORRECT given auto-reject risk |

## 4. Upgrade roadmap (highest leverage first)

**P1 — Exploit Validators + a hard "proof gate" (the single biggest earner).**
Per-class automated proof, run on the runner, that must PASS before a finding is
ever promoted to "reportable":
- XSS → headless Chromium visits, confirms the payload's JS actually executed
  (we already ship Chromium for browser-crawl).
- SSRF → out-of-band interaction (unique callback host) proves the server made the
  request; only "confirmed" if the callback fires.
- SQLi → boolean/time-based differential confirmation (not just sqlmap's word).
- Open redirect / path traversal / secret-exposure → deterministic proof checks.
- Redirect the pipeline so **only validator-CONFIRMED findings** reach the report
  draft. Everything else stays internal (not submitted). This is XBOW's validator
  idea + directly fixes the auto-reject problem.

**P2 — Novelty / dedupe gate.** Before drafting a report: SimHash the finding
(title+asset+class) against our own prior submissions and known-public patterns;
flag likely-duplicate so we never submit a dup and burn reputation.

**P3 — Asset/endpoint scoring (not just program scoring).** Score discovered
endpoints by "attackable surface" (auth forms, params, upload, admin, API, tech)
and spend scan/validate budget on the top ones — XBOW-style target scoring.

**P4 — The LLM hypothesis loop (real brain, Phase 3).** With a key: feed the
target's rendered pages + tech + endpoints to the model; it proposes specific,
testable hypotheses (e.g. "this `id` param on /api/orders looks like BOLA →
run two-account idorprobe"), the engine runs the matching validator, the model
reads the result and iterates. Business-logic/chaining stays human-flagged.

**P5 — Live secret validation (safe).** For a leaked key, a read-only,
provider-specific validity probe (owner-gated, secret never stored) so we only
report keys that actually work = high-impact, non-dup.

## 5. Guardrails (unchanged, now even more important)
Only authorized+in-scope targets; submission stays **human-approved** (auto-reject
risk makes this essential); secrets never stored/transited; validators must be
non-destructive.

## Sources
- XBOW #1 methodology — https://xbow.com/blog/top-1-how-xbow-did-it
- XBOW tops HackerOne — https://www.techrepublic.com/article/news-ai-xbow-tops-hackerone-us-leaderboad/
- State of AI in bug bounty — https://www.inspectiv.com/articles/the-state-of-ai-in-bug-bounty-hunting
- AI bounty volume surge / programs shutting — https://dev.to/dmaxdev/ai-bug-bounty-in-2026-76-more-reports-programs-shutting-down-1a59
- GitHub payout cut — https://www.techtimes.com/articles/321650/20260727/github-bug-bounty-cuts-public-payouts-half-hides-top-rates-invite-only-tier.htm
- Will AI kill bug bounty? — https://www.securityweek.com/will-ai-kill-the-bug-bounty-industry/
