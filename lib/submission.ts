// Report-submission helpers. Pure (no prisma/AI), so it's usable from the server
// or the client and is unit-testable.
//
// Reality check: the major platforms do NOT offer researchers an API to create
// NEW reports (their APIs are for reading/managing existing ones). So "automate
// submission" means: take you straight to the right submit page with the report
// already on your clipboard, plus platform-specific reminders — not a silent POST.

export type Platform = "hackerone" | "bugcrowd" | "intigriti" | "yeswehack" | "other";

const SUBMIT_PAGES: Record<string, string> = {
  hackerone: "https://hackerone.com/bugs/new",
  bugcrowd: "https://bugcrowd.com/programs",
  intigriti: "https://app.intigriti.com",
  yeswehack: "https://yeswehack.com",
};

/**
 * Best available submit destination for a finding. Prefer the program's own
 * brief/submit URL when we have one (that's where the in-scope "Submit report"
 * button lives); otherwise fall back to the platform's new-report page.
 */
export function submitUrl(platform: string, programUrl?: string | null): string {
  if (programUrl && /^https?:\/\//i.test(programUrl)) return programUrl;
  return SUBMIT_PAGES[(platform || "").toLowerCase()] ?? programUrl ?? "";
}

/** Short, platform-aware reminders shown next to the Submit action. */
export function submissionHints(platform: string): string[] {
  const base = [
    "Paste the human draft into the report body and read it once in your own voice.",
    "Set the severity/CVSS to match what you actually demonstrated.",
    "Attach the evidence (request/response, screenshots, video) — triagers want proof.",
    "Confirm the asset is in scope and not a known/duplicate issue.",
  ];
  const p = (platform || "").toLowerCase();
  if (p === "hackerone")
    return ["Open the program, then “Submit report”.", ...base];
  if (p === "bugcrowd")
    return ["Open the program brief, then “Submit a submission”.", ...base];
  return base;
}

/** Whether a real one-click submit is possible (none of the platforms allow it). */
export function canAutoSubmit(_platform: string): boolean {
  return false;
}
