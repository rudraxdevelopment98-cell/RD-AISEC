# Improvements — how to make the plan sharper

[← back to control room](index.md)

Your plan is strong: right problem, right timing, fits your constraints, honest about risk. These are additions that raise the **interesting** and the **useful**, ordered by leverage. Each is a suggestion, not a rewrite.

---

## 0. Naming

`Sentry-MCP` collides hard with **Sentry** (the observability company). Avoid it for anything public. Candidates that are descriptive and less crowded:
- **Toolgate** / **Toolwall** (gateway framing)
- **Warden**, **Aegis-MCP**, **MCP-Sentinel** (sentinel/sentinel-ish are somewhat used — check)
- Repo codename **Shiva** works well internally (guardian + destroyer).

> **Do a 10-minute name check before committing:** GitHub org search, npm/PyPI, a domain, and a trademark glance.

---

## 1. ⚠️ Prior art exists — sharpen the wedge

This space is **not empty**. Before building the scanner, spend half a day mapping who's already here so you don't ship a duplicate:
- **Invariant Labs `mcp-scan`** — a static + runtime MCP scanner already exists and is well-known.
- Various "MCP security" GitHub projects and awesome-lists.
- The MCP spec itself is adding security guidance.

**Implication:** a *plain static scanner* may already be commoditised. Your defensible wedge is more likely:
1. **The Attack Range / benchmark** (see #2) — datasets + evals are stickier than scanners.
2. **The runtime Gateway with drift + sequence anomaly detection** — your SOC edge, harder to copy.
3. **Detection-rule format** (see #3) — owning a standard beats owning a tool.

➡️ **Action:** add a "competitive landscape" section to the repo and revisit Gate 1 with eyes open. Don't let prior art kill the plan — let it *redirect the wedge*.

---

## 2. 🎯 Make the Attack Range the hero asset (not a side test suite)

The plan lists the malicious-server library as a test harness. **Promote it to a first-class public benchmark** — it may be the real moat:
- A versioned, documented corpus of poisoned/drift/escalation/confused-deputy servers.
- A scoring harness: any scanner/gateway (yours *or others'*) runs against it and gets a detection-rate / FP-rate score.
- A public **leaderboard**.

Why this wins: benchmarks become *infrastructure*. If "the Shiva Range" becomes how people measure MCP security, you're the reference point even if someone out-engineers your scanner. It's the strongest "give-first" magnet and the hardest thing for an incumbent to casually absorb.

---

## 3. 📏 Pioneer a detection-rule format — "Sigma for agent tool calls"

Your SOC background is the unfair advantage here. There's no shared, portable way to express *"detect this pattern in agent/MCP tool traffic."*
- Define a small YAML rule format (think Sigma/Falco, but for MCP events).
- Ship a starter rule pack with the Gateway.
- Let the community contribute rules.

Owning the *format* is higher leverage than owning the engine — Sigma made its authors central to detection without selling a SIEM.

---

## 4. 🔭 Measurement rigor from day one

The plan mentions FP-rate late. Define the metrics *now* so every phase is judged honestly:
- **Detection rate** (caught / total) on the Range.
- **False-positive rate** on a corpus of *benign* servers (you need a benign corpus too).
- **Gateway latency overhead** (ms added per call) — adoption killer if high.
- **Coverage** — # of distinct attack classes.

Put these on a dashboard in [progress.md](progress.md#signals-to-watch-your-real-metrics). Numbers turn write-ups into credibility.

---

## 5. 🔌 Emit OpenTelemetry (GenAI semantic conventions)

Make the Gateway's structured events **OpenTelemetry-compatible** (there are emerging GenAI/agent semantic conventions). Payoff:
- Plugs straight into existing SOC/SIEM (Splunk, Elastic, Grafana) — enterprises don't adopt a new silo.
- "Drop-in to your existing observability" is a far easier sell than "learn our dashboard."
- It's *your* domain (log normalisation) applied directly.

---

## 6. 🔐 Provenance + trust-on-first-use (TOFU)

Drift detection is reactive. Add a proactive identity layer:
- **Hash-pin** tool manifests; alert on any change (TOFU, like SSH host keys).
- Explore **signed manifests** (Sigstore-style) so servers can prove identity.
- An allowlist keyed on *content hash*, not just name (defeats typosquatting + silent swaps).

This turns "we detected drift" into "drift is structurally impossible without a re-approval."

---

## 7. 🏛️ Play the standards game early

Incumbent-absorption is your biggest risk. The hedge is to become *part of the standard*, not just a vendor:
- Engage the **MCP spec** security discussions; propose a security extension.
- Track and align to **NIST AI agent standards** + **OWASP Agentic** as they form.
- Being cited in the standard is worth more than any feature.

---

## 8. 🧪 Phase 0: add two more reproductions

Beyond poisoning/drift/escalation, two more are high-impact and easy demos:
- **Credential/token exfiltration** from a server that legitimately holds OAuth tokens.
- **The "do-nothing baseline"** — film an *unprotected* agent getting owned, side-by-side with the Gateway blocking it. That comparison video is your best marketing asset.

---

## 9. 🧹 Verify the market claims (don't repeat them unsourced)

Several headline stats ($1.4T, "200,000 vulnerable instances", specific Gartner %s) are *persuasive but need provenance* — some may be projections, paraphrases, or dated. Treat them as claims to verify, not facts to assert. Every number that goes in a blog/pitch gets a row in **[evidence.md](evidence.md)** with a real source + date. A wrong stat in a security pitch costs you credibility with exactly the technical buyers you want.

---

## 10. 💸 Business-model nuance

- **Open-core tension:** decide *early* what's forever-free (scanner, Range, rule format) vs paid (hosted registry, multi-team policy, compliance reports). Moving something behind a paywall later burns goodwill.
- **The durable asset** even if the company doesn't happen: the benchmark, the rule format, the community, and *you* as the named MCP-security person. That's the high floor — make it explicit in your own head.
- **First revenue** is likely *consulting / "secure my agent deployment"* off the OSS reputation, well before the hosted SaaS. Don't despise it — it funds Phase 3 and finds design partners.

---

## Decision log

Append decisions here so future-you knows *why*. Format: date · decision · rationale.

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-10 | Use Markdown + Mermaid in-repo (+ Obsidian) for all charts | Free, linked, version-controlled, renders on GitHub | 
| 2026-06-10 | Repo codename **Shiva**; public name TBD | Avoid Sentry trademark clash | 
| 2026-06-10 | Hosted project **platform** is a planned component, staged (GitHub→Pages→custom auth/RBAC) | Avoid the "build tooling instead of product" trap during Phase 0; see [platform.md](platform.md#when-to-build-it-staged) |
| _add next_ | | |

[← back to control room](index.md)
