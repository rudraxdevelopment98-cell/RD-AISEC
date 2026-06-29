// Human-quality bug-report generation. Pure + deterministic (no AI key, no
// prisma) so it runs on the server or the client and is unit-testable.
//
// Two outputs per finding:
//   buildStructuredReport — a clean, sectioned "engine" writeup (for our records)
//   buildHumanReport      — a natural, first-person researcher narrative (what we
//                           actually submit); varied per finding, no machine tells
// Plus assessValidity — a heuristic "is this submittable yet?" check.

export type ReportInput = {
  title: string;
  severity: string; // info|low|medium|high|critical
  target?: string; // affected asset (URL/host)
  description?: string;
  recommendation?: string;
  program?: string | null;
  engagement?: string | null;
  attackLabel?: string | null;
  owaspLabel?: string | null;
  confirmed?: boolean;
  evidence?: string; // PoC / tool output snippet
  scope?: string; // program/engagement scope text (for validity + scope match)
};

// --- tiny deterministic RNG so phrasing varies per finding but stays stable ---
function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pick<T>(seed: number, salt: number, arr: T[]): T {
  return arr[(seed + salt) % arr.length];
}

function asset(i: ReportInput): string {
  return (i.target || i.engagement || "the target").trim();
}

const SEV_IMPACT: Record<string, string> = {
  critical:
    "fully compromise the affected system or its data — this is about as serious as it gets",
  high: "do real damage: take over accounts, reach data they shouldn't, or pivot further in",
  medium: "abuse this to get at things they shouldn't, especially chained with another bug",
  low: "use this as a stepping stone or to gather information that helps a bigger attack",
  info: "learn something about the setup that's useful for planning a real attack",
};

// --- the human-voice narrative (what we send) ---------------------------------
export function buildHumanReport(i: ReportInput): string {
  const seed = seedFrom(i.title + (i.target ?? ""));
  const a = asset(i);
  const sev = (i.severity || "medium").toLowerCase();

  const opener = pick(seed, 1, [
    `While poking at ${a}, I ran into something that caught my eye and I was able to confirm it.`,
    `I was testing ${a} and found an issue I could reproduce reliably — writing it up below.`,
    `Spent some time on ${a} and turned up a problem worth flagging. Here's the full rundown.`,
    `Came across this one while going over ${a}. I've confirmed it end to end.`,
  ]);
  const confirmLine = i.confirmed
    ? pick(seed, 2, [
        " I didn't just spot it on paper — I actually triggered it and watched it work.",
        " To be clear, this isn't theoretical; I reproduced the behaviour directly.",
        " I validated it hands-on rather than relying on a scanner's word.",
      ])
    : "";

  const what =
    (i.description || "").trim() ||
    `The issue is best summarised by its title: ${i.title}.`;

  const steps = reproSteps(i, seed);
  const impact = pick(seed, 3, [
    `In practical terms, someone could ${SEV_IMPACT[sev] ?? SEV_IMPACT.medium}.`,
    `If this were left as-is, an attacker could realistically ${SEV_IMPACT[sev] ?? SEV_IMPACT.medium}.`,
    `The reason this matters: it lets an attacker ${SEV_IMPACT[sev] ?? SEV_IMPACT.medium}.`,
  ]);

  const fix =
    (i.recommendation || "").trim() ||
    pick(seed, 4, [
      "The cleanest fix is to patch the affected component and re-test once it's out.",
      "I'd remediate this at the source rather than filtering symptoms, then re-verify.",
      "Addressing the root cause (not just the observable symptom) and re-testing should close it.",
    ]);

  const out: string[] = [];
  out.push(`${opener}${confirmLine}`);
  out.push("");
  out.push(what);
  out.push("");
  out.push("**Steps to reproduce**");
  out.push(...steps);
  if (i.evidence?.trim()) {
    out.push("");
    out.push("**What I saw**");
    out.push("```");
    out.push(i.evidence.trim().slice(0, 1500));
    out.push("```");
  }
  out.push("");
  out.push("**Impact**");
  out.push(impact);
  out.push("");
  out.push("**Suggested fix**");
  out.push(fix);
  if (i.owaspLabel || i.attackLabel) {
    out.push("");
    const refs = [i.owaspLabel && `OWASP ${i.owaspLabel}`, i.attackLabel && `ATT&CK ${i.attackLabel}`]
      .filter(Boolean)
      .join(", ");
    out.push(`For reference, this lines up with ${refs}.`);
  }
  return out.join("\n");
}

function reproSteps(i: ReportInput, seed: number): string[] {
  const a = asset(i);
  const lead = pick(seed, 5, [
    `1. Head to ${a}.`,
    `1. Start at ${a}.`,
    `1. Open ${a} in a normal browser/session.`,
  ]);
  const mid = pick(seed, 6, [
    `2. Trigger the condition described above (I've included exactly what I sent below where it helps).`,
    `2. Reproduce the behaviour from the description — the request/payload is shown below if relevant.`,
    `2. Carry out the action that causes the issue, as laid out above.`,
  ]);
  const end = pick(seed, 7, [
    `3. You'll see the same result I did — the issue fires without any special setup.`,
    `3. The outcome matches what's described in Impact; no unusual prerequisites needed.`,
    `3. Observe the response — it confirms the problem straight away.`,
  ]);
  return [lead, mid, end];
}

// --- the structured "engine" writeup (for our records) ------------------------
export function buildStructuredReport(i: ReportInput): string {
  const lines = [
    `# ${i.title}`,
    ``,
    `**Severity:** ${(i.severity || "medium").toUpperCase()}`,
    i.target ? `**Affected asset:** ${i.target}` : "",
    i.program ? `**Program:** ${i.program}` : "",
    i.engagement ? `**Engagement:** ${i.engagement}` : "",
    i.owaspLabel ? `**OWASP:** ${i.owaspLabel}` : "",
    i.attackLabel ? `**MITRE ATT&CK:** ${i.attackLabel}` : "",
    i.confirmed ? `**Status:** Reproduced / confirmed exploitable` : "",
    ``,
    `## Summary`,
    (i.description || "").trim() || "—",
    ``,
    `## Steps to Reproduce`,
    `1. Access the affected asset.`,
    `2. Reproduce the condition described in the summary.`,
    `3. Observe the impact below.`,
    ``,
    ...(i.evidence?.trim()
      ? [`## Supporting Material`, "```", i.evidence.trim().slice(0, 1500), "```", ``]
      : []),
    `## Impact`,
    `A ${(i.severity || "medium").toLowerCase()}-severity issue affecting the asset above.`,
    ``,
    `## Remediation`,
    (i.recommendation || "").trim() || "Patch/upgrade the affected component and re-test.",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

// --- "is this submittable yet?" heuristic -------------------------------------
export type ValidityNote = { kind: "good" | "warn"; text: string };
export type Validity = {
  level: "ready" | "review" | "weak";
  notes: ValidityNote[];
};

export function assessValidity(i: ReportInput): Validity {
  const notes: ValidityNote[] = [];
  const sev = (i.severity || "").toLowerCase();
  const desc = (i.description || "").trim();

  if (i.confirmed) notes.push({ kind: "good", text: "Confirmed/reproduced — strongest signal of a valid bug." });
  else notes.push({ kind: "warn", text: "Not marked confirmed — validate the repro before submitting." });

  if (sev === "info" || sev === "") notes.push({ kind: "warn", text: "Informational severity is often out of scope / not awarded." });
  else notes.push({ kind: "good", text: `Severity (${sev}) is a triable level.` });

  if (desc.length < 60) notes.push({ kind: "warn", text: "Description is thin — add detail so triagers can follow it." });
  else notes.push({ kind: "good", text: "Has a substantive description." });

  if (i.evidence?.trim()) notes.push({ kind: "good", text: "Includes supporting evidence / output." });
  else notes.push({ kind: "warn", text: "No evidence attached — a request/response or screenshot helps a lot." });

  // Scope match: if we have scope text and a target, check the host appears.
  if (i.scope && i.target) {
    const host = i.target.replace(/^[a-z]+:\/\//i, "").split("/")[0].toLowerCase();
    const root = host.split(":")[0].replace(/^www\./, "");
    const inScope = root.length > 0 && i.scope.toLowerCase().includes(root.split(".").slice(-2).join("."));
    notes.push(
      inScope
        ? { kind: "good", text: "Target appears to match the program scope." }
        : { kind: "warn", text: "Couldn't match the target to the scope — double-check it's in scope." },
    );
  }

  const warns = notes.filter((n) => n.kind === "warn").length;
  const level: Validity["level"] = warns === 0 ? "ready" : warns <= 2 ? "review" : "weak";
  return { level, notes };
}
