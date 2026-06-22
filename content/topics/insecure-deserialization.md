---
title: Insecure Deserialization
category: Web App Testing
tags: [deserialization, rce, gadget chain, web, owasp]
summary: Deserializing attacker-controlled data can let an attacker tamper with objects or achieve remote code execution via gadget chains.
relatedTools: [Burp Suite]
---

## How it works

Apps serialize objects to store or transmit them (cookies, caches, queues,
APIs). If untrusted bytes are deserialized back into objects, an attacker can
craft input that changes application state — or, with the right "gadget" classes
on the classpath, triggers code execution during deserialization.

## How it gets exploited

- **Object/property tampering** — flip `isAdmin`, change prices, forge identity.
- **Gadget chains** — crafted serialized payloads (e.g. Java/PHP/Python pickle)
  that execute code as they're reconstructed.

```
# Python — never do this on untrusted input
pickle.loads(user_supplied_bytes)   # can execute arbitrary code
```

## How to find the bug

- Look for serialized blobs in cookies, params, or storage (base64 of Java
  `ac ed`, PHP `O:`, Python pickle, etc.).
- Test integrity: tamper a field and see if it's trusted; for known stacks, test
  for gadget-chain exposure with care.

## How to protect & defend

- **Don't deserialize untrusted data.** Prefer data-only formats (JSON) with a
  strict schema.
- If you must, use **signed/encrypted** payloads and verify integrity first.
- Restrict allowed types (allowlist), avoid native pickle/Java serialization for
  external input.

## How to fix it

Switch the channel to schema-validated JSON, or add HMAC signing + type
allowlisting before deserializing. Verify by tampering a signed payload — it
should be rejected, and unsigned/unknown-type input should never be deserialized.
