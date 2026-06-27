// Assessment-pipeline stage definitions. Pure constants/helpers — safe to import
// from both client components and server modules (no Prisma, no "use server").

export type StageDef = {
  key: string;
  title: string;
  desc: string;
  icon: string;
  // Does this stage queue runner jobs (true) or run computationally (false)?
  jobs: boolean;
};

export const PIPELINE_STAGES: StageDef[] = [
  { key: "recon", title: "Recon & discovery", desc: "Live hosts, tech & subdomains", icon: "radar", jobs: true },
  { key: "scan", title: "Vulnerability scan", desc: "nuclei / nmap / content discovery", icon: "search", jobs: true },
  { key: "exploit", title: "Exploit & validate", desc: "Confirm exploitability (non-destructive)", icon: "skull", jobs: true },
  { key: "triage", title: "Triage & remediate", desc: "Classify findings + fill fix guidance", icon: "wrench", jobs: false },
  { key: "report", title: "Report", desc: "Compile the final write-up", icon: "book", jobs: false },
];

export const STAGE_ORDER = PIPELINE_STAGES.map((s) => s.key);

export function stageDef(key: string): StageDef | undefined {
  return PIPELINE_STAGES.find((s) => s.key === key);
}

export function nextStageKey(key: string): string | null {
  const i = STAGE_ORDER.indexOf(key);
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : null;
}
