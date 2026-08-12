// Data retention — prune the unbounded, append-only tables so the DB stays lean
// for a bigger build. Runs from the daily cron. All deletes are bounded by age and
// status, so nothing live is ever touched.
//
//   • ControlMessage — the live PTY byte stream; worthless once a session ends.
//   • ControlSession — closed sessions (cascades away any straggler messages).
//   • AuditEvent     — the SIEM trail; keep a long window, drop the rest.
//   • Job            — archived jobs' raw output is the heavy field; drop old ones.

import { prisma } from "@/lib/db";

const DAY = 86_400_000;

// How long to keep each class of row (days). Generous, but bounded.
const CONTROL_MSG_DAYS = 1; // once a session's been closed a day, its bytes are dead weight
const CONTROL_SESSION_DAYS = 7;
const AUDIT_DAYS = 180;
const ARCHIVED_JOB_DAYS = 90;

export type RetentionResult = {
  controlMessages: number;
  controlSessions: number;
  auditEvents: number;
  jobs: number;
};

/** Delete aged rows from the append-only tables. Safe to run repeatedly. */
export async function pruneRetention(): Promise<RetentionResult> {
  const now = Date.now();

  const controlMessages = await prisma.controlMessage.deleteMany({
    where: { session: { status: "closed", closedAt: { lt: new Date(now - CONTROL_MSG_DAYS * DAY) } } },
  });
  const controlSessions = await prisma.controlSession.deleteMany({
    where: { status: "closed", closedAt: { lt: new Date(now - CONTROL_SESSION_DAYS * DAY) } },
  });
  const auditEvents = await prisma.auditEvent.deleteMany({
    where: { createdAt: { lt: new Date(now - AUDIT_DAYS * DAY) } },
  });
  const jobs = await prisma.job.deleteMany({
    where: { archived: true, finishedAt: { lt: new Date(now - ARCHIVED_JOB_DAYS * DAY) } },
  });

  return {
    controlMessages: controlMessages.count,
    controlSessions: controlSessions.count,
    auditEvents: auditEvents.count,
    jobs: jobs.count,
  };
}
