---
title: Server-Side Request Forgery (SSRF)
category: Web App Testing
tags: [ssrf, web, owasp, cloud, metadata, injection]
summary: An app fetches a URL supplied by the user, letting an attacker make the server send requests to internal systems it shouldn't reach.
relatedTools: [Burp Suite, OWASP ZAP, Nuclei]
---

## How it works

Many apps take a URL from the user and fetch it server-side (webhooks, link
previews, image fetchers, PDF generators). If the destination isn't restricted,
the attacker controls where the *server* connects — including internal-only
hosts that are normally unreachable from outside.

## How it gets exploited

The attacker points the parameter at internal targets:

```
https://app.example.com/fetch?url=http://169.254.169.254/latest/meta-data/
https://app.example.com/fetch?url=http://localhost:6379/   # internal Redis
```

Classic impact: stealing **cloud instance metadata / credentials**, scanning the
internal network, or hitting unauthenticated internal services.

## How to find the bug

- Find any feature that fetches a user-supplied URL or hostname.
- Test with a collaborator/OOB endpoint you control to detect blind SSRF, and
  with internal targets (`localhost`, `169.254.169.254`, RFC1918 ranges).

## How to protect & defend

- **Allowlist** destinations (schemes, hosts, ports) instead of blocklisting.
- Resolve the hostname and **block private/link-local IP ranges** — re-check
  after DNS resolution to defeat rebinding.
- Disable unused URL schemes (`file://`, `gopher://`), drop redirects.
- Use IMDSv2 / metadata protections in cloud.

## How to fix it

Route outbound fetches through a vetted proxy that enforces the allowlist and
blocks internal ranges. Verify the fix by re-testing the internal payloads —
they should be rejected before any connection is made.
