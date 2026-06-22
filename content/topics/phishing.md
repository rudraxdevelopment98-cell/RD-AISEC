---
title: Phishing & Social Engineering
category: Social Engineering
tags: [phishing, social engineering, email, awareness, mfa, credential theft]
summary: Tricking people into revealing credentials or running malicious actions via deceptive emails, messages, or sites — the most common initial access vector.
relatedTools: []
---

## How it works

Phishing targets people, not code. An attacker impersonates a trusted sender and
creates urgency ("your account will be locked") to get the victim to click a
link, enter credentials on a lookalike site, open a malicious attachment, or
approve an MFA prompt.

## How it gets exploited

- **Credential harvesting** via a cloned login page.
- **Malware** delivered through attachments or links.
- **Business Email Compromise (BEC)** — spoofed executives requesting payments.
- **MFA fatigue** — spamming push approvals until the user accepts.

## How to find the bug (authorized assessment)

- Run **authorized** phishing simulations with leadership sign-off; measure
  click and report rates.
- Review email authentication (SPF, DKIM, DMARC) and lookalike-domain exposure.

## How to protect & defend

- **Phishing-resistant MFA** (FIDO2 / passkeys) — defeats credential + push attacks.
- Enforce **SPF, DKIM, DMARC**; flag external senders; sandbox attachments.
- Security-awareness training and an easy **"report phish"** button.
- Number-matching MFA and approval throttling to stop MFA fatigue.

## How to fix it (after an incident)

Reset affected credentials and sessions, revoke tokens, hunt for attacker
activity, and close the delivery gap (block the domain, tune filters). Verify
with a follow-up simulation and confirm reporting/response times improved.
