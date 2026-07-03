// Digital-forensics helpers — pure (no DB/IO), shared by the server actions and
// the Evidence UI. Chain-of-custody + integrity are the point: everything here is
// about making evidence handling auditable and tamper-evident.

export const EVIDENCE_KINDS = ["disk", "memory", "file", "log", "network", "mobile", "cloud", "other"] as const;
export const CUSTODY_ACTIONS = ["acquired", "transferred", "analyzed", "stored", "released", "note"] as const;
export const HASH_ALGOS = ["sha256", "sha1", "md5", "sha512"] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type CustodyAction = (typeof CUSTODY_ACTIONS)[number];
export type HashAlgo = (typeof HASH_ALGOS)[number];

const HASH_LEN: Record<string, number> = { md5: 32, sha1: 40, sha256: 64, sha512: 128 };

/** A hash is valid when it's hex of the right length for its algorithm. */
export function isValidHash(algo: string, value: string): boolean {
  const v = (value || "").trim().toLowerCase();
  if (!v) return true; // empty = not yet recorded (allowed)
  const len = HASH_LEN[algo];
  return !!len && new RegExp(`^[0-9a-f]{${len}}$`).test(v);
}

export function kindLabel(k: string): string {
  return ({
    disk: "Disk image", memory: "Memory dump", file: "File / artifact", log: "Log",
    network: "Network capture", mobile: "Mobile", cloud: "Cloud", other: "Other",
  } as Record<string, string>)[k] ?? k;
}

export function actionLabel(a: string): string {
  return ({
    acquired: "Acquired", transferred: "Transferred", analyzed: "Analyzed",
    stored: "Stored", released: "Released", note: "Note",
  } as Record<string, string>)[a] ?? a;
}

export function actionColor(a: string): string {
  return ({
    acquired: "emerald", transferred: "amber", analyzed: "sky",
    stored: "violet", released: "red", note: "gray",
  } as Record<string, string>)[a] ?? "gray";
}
