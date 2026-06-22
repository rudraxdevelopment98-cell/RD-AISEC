---
title: Broken Authentication
category: Web App Testing
tags: [authentication, auth, credentials, mfa, sessions, brute force, owasp]
summary: Weaknesses in login, session, or credential handling that let attackers take over accounts — weak passwords, no rate limiting, poor session management.
relatedTools: [Burp Suite, Hashcat, John the Ripper]
---

## How it works

Authentication proves who a user is; session management keeps them logged in.
When either is weak — guessable passwords, no lockout, predictable or
long-lived tokens, credentials sent or stored insecurely — attackers can
impersonate users.

## How it gets exploited

- **Credential stuffing / brute force** when there's no rate limiting or MFA.
- **Session hijacking** via tokens leaked in URLs, logs, or non-HttpOnly cookies.
- **Weak resets** (predictable tokens, no expiry) to take over accounts.
- Login responses that reveal whether a username exists (enumeration).

## How to find the bug

- Test login for rate limiting/lockout and username enumeration.
- Inspect session cookies (HttpOnly, Secure, SameSite) and token lifetimes.
- Review password reset flow and password storage (hashing algorithm).

## How to protect & defend

- **MFA** for sensitive accounts; **rate limiting + lockout/backoff** on login.
- Strong password hashing (**bcrypt/argon2/scrypt**), never plaintext or fast hashes.
- Secure cookies (`HttpOnly`, `Secure`, `SameSite`), rotate session IDs on login,
  expire idle sessions.
- Generic, non-enumerable login/reset messages; short-lived single-use reset tokens.

## How to fix it

Adopt a vetted auth library/IdP rather than rolling your own, enable MFA, and
harden sessions. Verify by re-running brute-force and session tests — lockout
should trigger and tokens should be unguessable and short-lived.
