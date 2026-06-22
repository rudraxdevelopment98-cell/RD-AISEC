---
title: Cross-Site Request Forgery (CSRF)
category: Web App Testing
tags: [csrf, web, owasp, cookies, samesite, tokens]
summary: A malicious site causes a logged-in user's browser to send an unwanted authenticated request to your app, performing actions without their consent.
relatedTools: [Burp Suite, OWASP ZAP]
---

## How it works

Browsers automatically attach cookies to requests for a site. If your app
trusts the session cookie alone to authorize a state-changing action, another
site can forge that request — the victim's browser sends it already
authenticated.

## How it gets exploited

An attacker page auto-submits a form (or fires a request) to your app:

```html
<form action="https://bank.example.com/transfer" method="POST">
  <input type="hidden" name="to" value="attacker"/>
  <input type="hidden" name="amount" value="5000"/>
</form>
<script>document.forms[0].submit()</script>
```

The logged-in victim just visits the attacker's page and the transfer fires.

## How to find the bug

- Look for state-changing requests (POST/PUT/DELETE) with **no anti-CSRF token**
  or that succeed cross-origin.
- Remove/replace the token and replay; check if the action still works.

## How to protect & defend

- **SameSite cookies** (`Lax` or `Strict`) — blocks most cross-site sends.
- **Anti-CSRF tokens** (synchronizer or double-submit) on every state change.
- Check `Origin`/`Referer` for sensitive actions; require re-auth for critical ones.

## How to fix it

Use your framework's built-in CSRF protection and set `SameSite` on session
cookies. Verify by re-running the forged cross-origin request — it should now be
rejected without a valid token.
