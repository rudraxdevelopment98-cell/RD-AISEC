---
title: Cross-Site Scripting (XSS)
category: Web App Testing
tags: [xss, injection, javascript, web, owasp, csp]
summary: Untrusted input is rendered into a page without escaping, letting an attacker run JavaScript in another user's browser.
relatedTools: [Burp Suite, OWASP ZAP, Semgrep]
---

## How it works

The browser trusts whatever the server sends it. If user-controlled data is
placed into HTML, an attribute, or a script context without being encoded for
that context, the browser executes it as code. The three classic forms are
**stored** (saved server-side), **reflected** (echoed from the request), and
**DOM-based** (sink in client-side JS).

## How to do it (recon & testing)

Identify every place input is reflected back, then test with a context-aware,
non-destructive marker.

```
# A harmless probe that proves rendering without alert() spam
"><svg onload=console.log('xss-test')>

# Check reflection points
- URL/query params
- form fields shown back to the user
- values written into the DOM by JavaScript (innerHTML, document.write)
```

## How it gets exploited

Executing script in the victim's session means stealing cookies/tokens,
performing actions as the victim (CSRF-style), keylogging, or rewriting the page
for phishing. Stored XSS is worst — it hits every viewer automatically.

## How to protect & defend

- **Context-aware output encoding** — HTML, attribute, JS, and URL contexts each
  need different escaping. Use the framework's auto-escaping (React, Angular)
  and avoid bypasses.
- **Avoid dangerous sinks** — `innerHTML`, `dangerouslySetInnerHTML`,
  `document.write`, `eval`.
- **Content Security Policy (CSP)** — a strong fallback that blocks inline and
  unauthorized scripts.
- **HttpOnly cookies** so script can't read session tokens.

## How to find the bug

```
# Client-side sinks worth reviewing
grep -rEn "innerHTML|dangerouslySetInnerHTML|document.write|eval\(" src/
```

Use a scanner (ZAP/Burp) for reflected/stored cases and SAST for risky sinks.

## How to fix it

Render the value as text, not markup. If HTML really must be allowed, sanitize
with a vetted library (e.g. DOMPurify) and add a CSP. Verify by re-submitting
your marker — it should appear as literal text, not execute.

```jsx
// Before (vulnerable)
<div dangerouslySetInnerHTML={{ __html: comment }} />

// After (safe)
<div>{comment}</div>
```
