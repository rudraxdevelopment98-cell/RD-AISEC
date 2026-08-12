// Multi-owner data isolation helpers. Each owner's engagements/findings/programs/
// submissions/resources/evidence are private to them; owner-role users
// (AUTHORIZED_EMAILS) see the whole system. These build the Prisma `where`
// fragments so list queries and mutations can be scoped consistently in one place
// instead of ad-hoc per call site.
//
// Pure w.r.t. the DB — they only shape `where` clauses. Pass the caller's email
// (from auth()); owner-role short-circuits to an empty filter (matches everything).

import { isOwnerEmail } from "@/lib/members";

/** `where` fragment for a model that has its own `ownerEmail` column. */
export function ownerScope(email: string): Record<string, unknown> {
  return isOwnerEmail(email) ? {} : { ownerEmail: email };
}

/**
 * `where` fragment for a model owned THROUGH its engagement (e.g. Finding,
 * Resource, ScanRun): scope by the parent engagement's ownerEmail.
 */
export function viaEngagementScope(email: string): Record<string, unknown> {
  return isOwnerEmail(email) ? {} : { engagement: { ownerEmail: email } };
}
