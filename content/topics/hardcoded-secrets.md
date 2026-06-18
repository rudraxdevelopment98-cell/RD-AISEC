---
title: Hardcoded Secrets in a Repo
category: Secrets Detection
tags: [secrets, credentials, api keys, git, supply chain]
summary: API keys, passwords, or tokens committed into source control — readable by anyone with repo access and preserved forever in git history.
relatedTools: [Gitleaks, Trivy, Semgrep]
---

## How it works

A secret pasted into code, a config file, or a `.env` that gets committed lives
in the repository — and crucially in **git history** even after you delete it.
Anyone who can read the repo (or a leaked clone, fork, or CI log) can read the
secret.

## How to do it (recon & testing)

Scan the working tree *and* the full history, since a secret removed in the
latest commit may still sit in an older one.

```
# Scan current tree + history
gitleaks detect --source . --redact

# Look at what a single file revealed over time
git log -p -- path/to/config
```

## How it gets exploited

A valid key is immediate access: cloud accounts spun up for crypto mining,
databases dumped, third-party APIs abused on your bill, or lateral movement
using the credential's privileges. Automated bots scan public pushes within
seconds.

## How to protect & defend

- **Keep secrets out of code** — use environment variables or a secrets manager
  (Vault, AWS/GCP secret stores).
- **Pre-commit scanning** — run Gitleaks as a git hook so secrets never land.
- **`.gitignore`** for `.env*` and credential files.
- **Least privilege + short TTL** so a leak has limited blast radius.

## How to find the bug

```
# Quick local sweep for common patterns
grep -rEn "(api[_-]?key|secret|password|token)\\s*[:=]" . \
  --include=*.{js,ts,py,env,yml,yaml,json}
```

Add a secrets scanner to CI so every PR is checked.

## How to fix it

1. **Rotate the secret immediately** — assume it is compromised the moment it
   was committed. Removing it from history is *not* enough on its own.
2. Move it to an environment variable / secrets manager.
3. Purge it from history if needed (`git filter-repo`) and force-push with care.
4. Add a pre-commit + CI scan so it can't recur. Verify by re-scanning a fresh
   clone.
