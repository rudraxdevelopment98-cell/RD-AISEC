// One connection code = the portal origin + an enrollment code, bundled into a
// SINGLE string so a machine — or the desktop app — needs one paste instead of
// two fields (portal URL + code). It is not more secret than the enroll code it
// wraps; it's just a convenience envelope so onboarding is one step.
//
// Format:  RDC1.<base64url(JSON.stringify({ p: origin, c: code }))>
//
// Kept deliberately trivial so the TypeScript portal and the plain-Node desktop
// app (runner-gui) can both encode/decode it without sharing a build.

function b64urlEncode(s: string): string {
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(s, "utf-8").toString("base64")
      : btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  if (typeof Buffer !== "undefined")
    return Buffer.from(b64, "base64").toString("utf-8");
  return decodeURIComponent(escape(atob(b64)));
}

/** Bundle portal origin + enroll code into one connection code. */
export function encodeConnectCode(origin: string, code: string): string {
  const p = String(origin || "").replace(/\/+$/, "");
  const c = String(code || "").trim();
  return "RDC1." + b64urlEncode(JSON.stringify({ p, c }));
}

/** Parse a connection code back to { portal, code }, or null if malformed. */
export function decodeConnectCode(
  input: string,
): { portal: string; code: string } | null {
  const s = String(input || "").trim();
  if (!s.startsWith("RDC1.")) return null;
  try {
    const obj = JSON.parse(b64urlDecode(s.slice(5)));
    if (obj && typeof obj.p === "string" && typeof obj.c === "string" && obj.p && obj.c)
      return { portal: obj.p.replace(/\/+$/, ""), code: obj.c };
  } catch {
    /* fall through */
  }
  return null;
}
