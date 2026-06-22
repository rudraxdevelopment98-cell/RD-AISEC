---
title: Privilege Escalation
category: Post-Exploitation
tags: [privilege escalation, privesc, linux, windows, least privilege, post-exploitation]
summary: Turning limited access into higher privileges (admin/root) by abusing misconfigurations, weak permissions, or vulnerable components.
relatedTools: [Metasploit]
---

## How it works

After initial access as a low-privileged user, an attacker looks for a path to
greater control. Escalation is **vertical** (user → admin/root) or **horizontal**
(accessing another peer's resources). It almost always abuses misconfiguration
rather than magic.

## How it gets exploited

Common paths:
- **Linux:** misconfigured `sudo`, SUID binaries, writable cron/scripts, weak
  file permissions, exposed secrets, kernel exploits.
- **Windows:** unquoted service paths, weak service permissions, token
  impersonation, AlwaysInstallElevated, credential reuse.

```
# quick situational awareness (authorized hosts only)
id; sudo -l; find / -perm -4000 -type f 2>/dev/null   # Linux SUID
```

## How to find the bug

- Run enumeration to map writable paths, SUID/services, and stored credentials.
- Audit `sudo`/service configs and patch levels; look for secrets in files,
  history, and environment.

## How to protect & defend

- **Least privilege** — minimal sudo rights, no unnecessary SUID, scoped service
  accounts.
- Fix file/service permissions; rotate and vault secrets (no plaintext on disk).
- Patch promptly; add monitoring for privilege changes and suspicious escalation.

## How to fix it

Remediate the specific misconfiguration (tighten the sudo rule, remove the SUID
bit, correct the service ACL, rotate the leaked credential) and re-run the
enumeration to confirm the path is closed.
