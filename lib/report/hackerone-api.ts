/**
 * Thin HackerOne Hacker API client (report intents = drafts, then submit).
 * Base: https://api.hackerone.com/v1 — HTTP Basic auth with API username:token.
 * See https://api.hackerone.com/hacker-resources/. Network only; no persistence.
 *
 * Flow: createReportIntent (draft) → human approves → submitReportIntent.
 */

const BASE = "https://api.hackerone.com/v1";

export type H1Creds = { username: string; token: string };

export type H1Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

function authHeader(c: H1Creds): string {
  return "Basic " + Buffer.from(`${c.username}:${c.token}`).toString("base64");
}

async function h1Fetch<T>(creds: H1Creds, method: string, path: string, body?: unknown): Promise<H1Result<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(BASE + path, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: authHeader(creds),
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      const err = extractError(json) || `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: err };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, status: 0, error: `request failed: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull a human-readable message out of a JSON:API error body. */
function extractError(json: unknown): string {
  const errs = (json as { errors?: { title?: string; detail?: string }[] })?.errors;
  if (Array.isArray(errs) && errs.length) {
    return errs.map((e) => e.detail || e.title).filter(Boolean).join("; ");
  }
  return "";
}

type H1Object = { data?: { id?: string; attributes?: Record<string, unknown> } };

/** Create a report intent (draft). Returns its id. */
export async function createReportIntent(
  creds: H1Creds,
  teamHandle: string,
  title: string,
  description: string,
): Promise<H1Result<{ id: string }>> {
  const res = await h1Fetch<H1Object>(creds, "POST", "/hackers/report_intents", {
    data: { type: "report-intent", attributes: { team_handle: teamHandle, title, description } },
  });
  if (!res.ok) return res;
  const id = res.data?.data?.id;
  if (!id) return { ok: false, status: 0, error: "HackerOne returned no draft id" };
  return { ok: true, data: { id } };
}

/** Submit a report intent → converts it into a real report. Returns report id + url. */
export async function submitReportIntent(
  creds: H1Creds,
  intentId: string,
): Promise<H1Result<{ reportId: string; url: string }>> {
  const res = await h1Fetch<H1Object>(creds, "POST", `/hackers/report_intents/${intentId}/submit`, {});
  if (!res.ok) return res;
  const reportId = res.data?.data?.id ?? "";
  const url = reportId ? `https://hackerone.com/reports/${reportId}` : "";
  return { ok: true, data: { reportId, url } };
}

/** Cheap credential check: list report intents (read scope). */
export async function verifyCreds(creds: H1Creds): Promise<H1Result<unknown>> {
  return h1Fetch(creds, "GET", "/hackers/report_intents");
}
