---
title: SQL Injection
category: Web App Testing
tags: [sqli, injection, database, web, owasp]
summary: Untrusted input reaches a SQL query, letting an attacker change the query's meaning — read, modify, or destroy data.
relatedTools: [sqlmap, Burp Suite, OWASP ZAP, Semgrep]
---

## How it works

An application builds a SQL query by concatenating user input directly into the
query string. Because the database can't tell *data* from *code*, input like
`' OR '1'='1` changes the **logic** of the query instead of being treated as a
value. The trust boundary that should sit between the user and the database is
missing.

## How to do it (recon & testing)

In an authorized test, find inputs that reach the database (search boxes, login
forms, URL parameters, headers) and probe how the app reacts to a single quote
or a boolean condition.

```
# A simple manual probe — does breaking the quote change the response?
https://target.example.com/item?id=10'
https://target.example.com/item?id=10 AND 1=1   -- expect normal
https://target.example.com/item?id=10 AND 1=2   -- expect different

# Automated confirmation (authorized scope only)
sqlmap -u "https://target.example.com/item?id=10" --batch
```

## How it gets exploited

Once injectable, an attacker can bypass authentication (`' OR 1=1 --`), read
other tables via **UNION** queries, extract data **blind** (boolean/time based)
when no output is shown, or in bad cases run stacked queries that modify data.

## How to protect & defend

- **Parameterized queries / prepared statements** — the single most important
  fix. Data is sent separately from the query, so it can never become code.
- **ORMs** used correctly (avoid raw string interpolation).
- **Least privilege** DB accounts — the app user shouldn't be able to `DROP`.
- **Input validation** as defense in depth, never as the only control.
- **WAF + logging** to detect and slow probing.

## How to find the bug

Search the codebase for string-built queries and dynamic execution:

```
# Patterns worth reviewing by hand
grep -rEn "execute\(|query\(|f\"SELECT|\\+ *\"SELECT" src/
```

Run a SAST tool (e.g. Semgrep) with SQL-injection rules in CI so new instances
are caught before they ship.

## How to fix it

Replace the concatenated query with a parameterized one. Verify the fix by
re-running the probe that previously worked — it should now be treated as a
literal value. Add a regression test that feeds `' OR '1'='1` and asserts no
extra rows are returned.

```python
# Before (vulnerable)
cur.execute("SELECT * FROM items WHERE id = " + user_id)

# After (safe)
cur.execute("SELECT * FROM items WHERE id = %s", (user_id,))
```
