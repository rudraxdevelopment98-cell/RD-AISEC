import { prisma } from "@/lib/db";

export type AuditInput = {
  type: string; // dotted, e.g. "auth.login", "job.queued"
  actor?: string | null; // email; "" / null = system
  summary?: string;
  target?: string;
  severity?: string; // info|low|medium|high|critical
  meta?: Record<string, unknown>;
};

/**
 * Record a SIEM/audit event. Best-effort: auditing must never break the action
 * that triggered it, so all errors are swallowed.
 */
export async function logAudit(e: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        type: e.type.slice(0, 64),
        actor: (e.actor ?? "").slice(0, 200),
        summary: (e.summary ?? "").slice(0, 300),
        target: (e.target ?? "").slice(0, 200),
        severity: e.severity ?? "info",
        meta: e.meta ? JSON.stringify(e.meta).slice(0, 2000) : "",
      },
    });
  } catch {
    /* swallow — never block the caller on an audit write */
  }
}
