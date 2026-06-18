// Shared enums for engagements/findings. Kept separate from the server-action
// module because a "use server" file may only export async functions.

export const ENGAGEMENT_TYPES = ["pentest", "forensics", "consulting"] as const;
export const ENGAGEMENT_STATUSES = ["planning", "active", "completed"] as const;
export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export const FINDING_STATUSES = [
  "open",
  "fixed",
  "accepted",
  "false_positive",
] as const;
