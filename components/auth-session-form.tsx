"use client";

import { useState } from "react";
import { setEngagementAuthSession } from "@/lib/engagements";

/**
 * Authenticated-scan session builder. Instead of hand-typing a raw HTTP header,
 * you pick the auth TYPE (cookie / bearer / basic / api-key / custom) and fill in
 * just the value — the header is assembled for you and posted to
 * setEngagementAuthSession (stored encrypted). Scans then run as the logged-in
 * user, reaching IDOR / access-control / business-logic bugs.
 */
type AuthType = "cookie" | "bearer" | "basic" | "apikey" | "custom";

const TYPES: { id: AuthType; label: string }[] = [
  { id: "cookie", label: "Cookie (session)" },
  { id: "bearer", label: "Bearer token" },
  { id: "basic", label: "Basic auth (user + pass)" },
  { id: "apikey", label: "API key header" },
  { id: "custom", label: "Custom header (raw)" },
];

function b64(s: string): string {
  try {
    return typeof btoa === "function" ? btoa(s) : "";
  } catch {
    return "";
  }
}

function buildHeader(type: AuthType, a: string, b: string): string {
  const v = a.trim();
  switch (type) {
    case "cookie":
      return v ? `Cookie: ${v}` : "";
    case "bearer":
      return v ? `Authorization: Bearer ${v}` : "";
    case "basic":
      return v ? `Authorization: Basic ${b64(`${v}:${b}`)}` : "";
    case "apikey": {
      const name = (b.trim() || "X-API-Key").replace(/[^A-Za-z0-9-]/g, "");
      return v ? `${name}: ${v}` : "";
    }
    case "custom":
      return v;
  }
}

/** Preview the header with the secret masked (never echo the value). */
function preview(header: string): string {
  if (!header) return "";
  const [name, ...rest] = header.split(":");
  const val = rest.join(":").trim();
  const masked = val.length <= 6 ? "••••" : `${val.slice(0, 4)}•••••${val.slice(-2)}`;
  return `${name}: ${masked}`;
}

export function AuthSessionForm({
  engagementId,
  active,
}: {
  engagementId: string;
  active?: string;
}) {
  const [type, setType] = useState<AuthType>("cookie");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const header = buildHeader(type, a, b);

  const inputCls =
    "min-w-0 flex-1 rounded-lg border border-surface-border bg-black/40 px-3 py-2 font-mono text-xs text-gray-200 outline-none focus:border-brand";

  return (
    <form action={setEngagementAuthSession} className="mt-3 space-y-2">
      <input type="hidden" name="id" value={engagementId} />
      <input type="hidden" name="authSession" value={header} />

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as AuthType);
            setA("");
            setB("");
          }}
          className="rounded-lg border border-surface-border bg-surface px-2 py-2 text-xs outline-none focus:border-brand"
        >
          {TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        {type === "basic" ? (
          <>
            <input className={inputCls} autoComplete="off" placeholder="username" value={a} onChange={(e) => setA(e.target.value)} />
            <input className={inputCls} autoComplete="off" type="password" placeholder="password" value={b} onChange={(e) => setB(e.target.value)} />
          </>
        ) : type === "apikey" ? (
          <>
            <input className="w-36 rounded-lg border border-surface-border bg-black/40 px-3 py-2 font-mono text-xs text-gray-200 outline-none focus:border-brand" autoComplete="off" placeholder="X-API-Key" value={b} onChange={(e) => setB(e.target.value)} />
            <input className={inputCls} autoComplete="off" placeholder="key value" value={a} onChange={(e) => setA(e.target.value)} />
          </>
        ) : (
          <input
            className={inputCls}
            autoComplete="off"
            placeholder={
              type === "cookie"
                ? "session=abc123; csrftoken=…"
                : type === "bearer"
                  ? "eyJhbGciOi… (token only, no 'Bearer')"
                  : "Full header, e.g. X-Auth: value"
            }
            value={a}
            onChange={(e) => setA(e.target.value)}
          />
        )}

        <button type="submit" disabled={!header} className="btn-ghost text-xs disabled:opacity-50">
          {active ? "Replace" : "Save"}
        </button>
      </div>

      {header && (
        <p className="text-[10px] text-gray-500">
          Will store (encrypted) &amp; inject: <code className="font-mono text-gray-400">{preview(header)}</code>
        </p>
      )}
    </form>
  );
}
