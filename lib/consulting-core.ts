// Security-consulting helpers — pure (no DB/IO). Framework templates + scoring
// for control/maturity assessments. Seed an assessment from a template, score
// each control, and roll the results up into an advisory picture.

export const CONTROL_STATUSES = ["pass", "partial", "fail", "na"] as const;
export type ControlStatus = (typeof CONTROL_STATUSES)[number];

export type TemplateControl = { id: string; domain: string; title: string };
export type Framework = { id: string; name: string; description: string; controls: TemplateControl[] };

// Compact, practical framework templates. Not exhaustive standards — a strong
// starting checklist per framework that you refine per engagement.
export const FRAMEWORKS: Framework[] = [
  {
    id: "nist-csf",
    name: "NIST CSF",
    description: "Identify · Protect · Detect · Respond · Recover.",
    controls: [
      { id: "ID.AM", domain: "Identify", title: "Asset inventory is complete and current" },
      { id: "ID.RA", domain: "Identify", title: "Risk assessment performed and tracked" },
      { id: "PR.AC", domain: "Protect", title: "Access control & least privilege enforced" },
      { id: "PR.DS", domain: "Protect", title: "Data protected at rest and in transit" },
      { id: "PR.IP", domain: "Protect", title: "Secure config / patch baselines maintained" },
      { id: "DE.CM", domain: "Detect", title: "Continuous monitoring & logging in place" },
      { id: "DE.AE", domain: "Detect", title: "Anomalies & events are analyzed" },
      { id: "RS.RP", domain: "Respond", title: "Incident response plan exists and is tested" },
      { id: "RC.RP", domain: "Recover", title: "Backups & recovery plan validated" },
    ],
  },
  {
    id: "cis8",
    name: "CIS Controls v8 (IG1)",
    description: "Essential cyber-hygiene safeguards.",
    controls: [
      { id: "CIS-1", domain: "Inventory", title: "Inventory of enterprise assets" },
      { id: "CIS-2", domain: "Inventory", title: "Inventory of software assets" },
      { id: "CIS-3", domain: "Data", title: "Data protection & classification" },
      { id: "CIS-4", domain: "Config", title: "Secure configuration of assets & software" },
      { id: "CIS-5", domain: "Access", title: "Account management" },
      { id: "CIS-6", domain: "Access", title: "Access control management (MFA, least priv)" },
      { id: "CIS-7", domain: "Vuln", title: "Continuous vulnerability management" },
      { id: "CIS-8", domain: "Logging", title: "Audit log management" },
      { id: "CIS-10", domain: "Malware", title: "Malware defenses" },
      { id: "CIS-11", domain: "Recovery", title: "Data recovery" },
    ],
  },
  {
    id: "owasp-asvs",
    name: "OWASP ASVS (L1)",
    description: "Application security verification.",
    controls: [
      { id: "V2", domain: "Auth", title: "Authentication is strong (MFA, no defaults)" },
      { id: "V3", domain: "Session", title: "Session management is secure" },
      { id: "V4", domain: "Access", title: "Access control enforced server-side" },
      { id: "V5", domain: "Validation", title: "Input validation & output encoding" },
      { id: "V7", domain: "Logging", title: "Error handling & logging are safe" },
      { id: "V9", domain: "Comms", title: "TLS everywhere, strong config" },
      { id: "V12", domain: "Files", title: "File upload & resource handling safe" },
      { id: "V13", domain: "API", title: "API & web-service controls" },
    ],
  },
  { id: "custom", name: "Custom", description: "Start empty and add your own controls.", controls: [] },
];

export function getFramework(id: string): Framework | undefined {
  return FRAMEWORKS.find((f) => f.id === id);
}

export function statusLabel(s: string): string {
  return ({ pass: "Pass", partial: "Partial", fail: "Fail", na: "N/A" } as Record<string, string>)[s] ?? s;
}
export function statusColor(s: string): string {
  return ({ pass: "emerald", partial: "amber", fail: "red", na: "gray" } as Record<string, string>)[s] ?? "gray";
}

export type Scored = {
  total: number;
  pass: number;
  partial: number;
  fail: number;
  na: number;
  assessed: number; // non-na
  maturityAvg: number; // 0..5 over assessed
  score: number; // 0..100 posture score
  byDomain: { domain: string; pass: number; partial: number; fail: number; total: number; score: number }[];
};

/** Roll control results into a posture score + per-domain breakdown. */
export function scoreControls(controls: { domain: string; status: string; maturity: number }[]): Scored {
  const s: Scored = { total: controls.length, pass: 0, partial: 0, fail: 0, na: 0, assessed: 0, maturityAvg: 0, score: 0, byDomain: [] };
  let matSum = 0;
  const dom: Record<string, { pass: number; partial: number; fail: number; total: number }> = {};
  for (const c of controls) {
    const st = c.status as ControlStatus;
    if (st === "pass") s.pass++; else if (st === "partial") s.partial++; else if (st === "fail") s.fail++; else s.na++;
    if (st !== "na") { s.assessed++; matSum += Math.max(0, Math.min(5, c.maturity || 0)); }
    const d = (dom[c.domain] ??= { pass: 0, partial: 0, fail: 0, total: 0 });
    d.total++; if (st === "pass") d.pass++; else if (st === "partial") d.partial++; else if (st === "fail") d.fail++;
  }
  s.maturityAvg = s.assessed ? matSum / s.assessed : 0;
  // Posture: pass=1, partial=0.5, fail=0, over assessed controls.
  s.score = s.assessed ? Math.round(((s.pass + s.partial * 0.5) / s.assessed) * 100) : 0;
  s.byDomain = Object.entries(dom).map(([domain, d]) => {
    const assessed = d.pass + d.partial + d.fail;
    return { domain, ...d, score: assessed ? Math.round(((d.pass + d.partial * 0.5) / assessed) * 100) : 0 };
  }).sort((a, b) => a.domain.localeCompare(b.domain));
  return s;
}
