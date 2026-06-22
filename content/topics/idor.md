---
title: Insecure Direct Object Reference (IDOR)
category: Web App Testing
tags: [idor, access control, authorization, broken access control, web, owasp]
summary: The app uses a user-supplied identifier to fetch a record without checking the requester is allowed to access it — so changing the ID exposes other users' data.
relatedTools: [Burp Suite, OWASP ZAP]
---

## How it works

An endpoint references an object by ID (e.g. `/api/orders/1043`) and returns it
based on the ID alone, trusting that the user "wouldn't" request one that isn't
theirs. With no server-side ownership check, the ID is the only thing standing
between an attacker and someone else's data.

## How it gets exploited

The attacker simply changes the identifier:

```
GET /api/orders/1043   # mine
GET /api/orders/1044   # someone else's — returned anyway
```

This applies to numeric IDs, UUIDs, filenames, and account references — for
reads *and* writes (editing/deleting other users' objects).

## How to find the bug

- Log in as two separate users and try to access user A's objects as user B.
- Increment/iterate IDs, swap UUIDs between accounts, and watch for 200s where
  you expect 403/404.

## How to protect & defend

- **Enforce authorization on every object access** — check that the current user
  owns or may access the requested record, server-side, every time.
- Prefer access checks tied to the session, not to client-supplied IDs.
- Unguessable IDs (UUIDs) help but are **not** a substitute for authorization.

## How to fix it

Add an ownership/permission check in the data layer (e.g. scope queries to the
authenticated user). Verify by repeating the cross-account test — the other
user's object should now return 403/404.
