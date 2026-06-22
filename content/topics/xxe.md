---
title: XML External Entity (XXE)
category: Web App Testing
tags: [xxe, xml, ssrf, file disclosure, owasp, injection]
summary: An XML parser that processes external entities lets an attacker read local files, reach internal systems, or trigger denial of service.
relatedTools: [Burp Suite, OWASP ZAP]
---

## How it works

XML supports "entities," including **external** ones that load content from a
URI. If the parser resolves them and the app accepts attacker-supplied XML
(uploads, SOAP, SVG, document formats), the attacker controls what the parser
fetches.

## How it gets exploited

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<foo>&xxe;</foo>
```

- **File disclosure** (`file://`), **SSRF** (`http://internal`), or DoS
  ("billion laughs" entity expansion).

## How to find the bug

- Find endpoints that accept XML (or formats backed by XML: SVG, DOCX, SAML).
- Submit a payload with an external entity pointing at a file or an OOB URL you
  control; watch for the content or the callback.

## How to protect & defend

- **Disable DOCTYPE / external entities** in the XML parser (the single most
  important fix).
- Prefer less complex formats (JSON) where possible.
- Patch/upgrade parsers; disable entity expansion.

## How to fix it

Configure the parser to forbid `DOCTYPE` and external entities (e.g.
`disallow-doctype-decl`, disable external general/parameter entities). Verify by
resubmitting the entity payload — the file/OOB fetch should no longer occur.
