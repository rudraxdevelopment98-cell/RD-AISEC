"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { findingTarget } from "@/data/exploit-playbook";
import { validatableClass, validationJobFor, VALIDATE_PREFIX } from "@/lib/engine/validators";
import { pickRunnerId } from "@/lib/pipeline-engine";
import { JOB_PRIORITY } from "@/lib/runner-constants";
import { hostInScope, scopeHosts } from "@/lib/engine/ai-browse";
import { logAudit } from "@/lib/audit";

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");
  return session.user.email;
}

/**
 * Launch an automated exploit validation ("prove it") for a finding. Owner-gated
 * and authorized-only. Queues the per-class proof job (headless XSS / OAST SSRF /
 * sqlmap differential); the result route parses the proof and, only if PROVEN,
 * sets finding.confirmed + finding.proof. Unproven findings stay unreportable.
 */
export async function launchValidation(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const back = `/dashboard/findings/${id}/exploit`;
  if (!id) redirect("/dashboard/findings");

  const finding = await prisma.finding.findUnique({
    where: { id },
    include: { engagement: { select: { id: true, ownerEmail: true, authorized: true, scope: true } } },
  });
  if (!finding) redirect(`${back}?error=${encodeURIComponent("Finding not found.")}`);
  const eng = finding!.engagement;
  if (eng.ownerEmail && eng.ownerEmail !== email) {
    redirect(`${back}?error=${encodeURIComponent("Only the engagement owner can run validation.")}`);
  }
  if (!eng.authorized) {
    redirect(`${back}?error=${encodeURIComponent("Record written authorization on the engagement before validating against the target.")}`);
  }

  const cls = validatableClass(finding!);
  if (!cls) {
    redirect(`${back}?error=${encodeURIComponent("No automated validator exists for this finding's class yet — verify it manually.")}`);
  }
  const { host, url } = findingTarget(finding!);
  // secretvalidate re-fetches the SOURCE URL to re-extract the key, so a leaked-
  // secret finding needs the URL where the key was found (a bare host no-ops).
  const target = cls === "secret" ? url : url || host;
  if (!target) {
    redirect(`${back}?error=${encodeURIComponent(
      cls === "secret"
        ? "This secret finding has no source URL to re-fetch — validate it manually (the finding must reference the URL/bundle where the key was found)."
        : "Couldn't derive a target URL/host to validate from this finding.",
    )}`);
  }
  // SAFETY: the target is grepped from the finding text and could be an out-of-
  // scope host (e.g. an attacker URL in an SSRF payload). Never probe off-scope.
  if (!hostInScope(host, scopeHosts(eng.scope))) {
    redirect(`${back}?error=${encodeURIComponent("The target derived from this finding is not in the engagement scope — refusing to probe an out-of-scope host.")}`);
  }
  const job = validationJobFor(cls!, target);
  if (!job) {
    redirect(`${back}?error=${encodeURIComponent("No validator job for this class.")}`);
  }

  const runnerId = await pickRunnerId();
  if (!runnerId) {
    redirect(`${back}?error=${encodeURIComponent("No runner online — connect a machine first.")}`);
  }

  await prisma.job.create({
    data: {
      engagementId: eng.id,
      runnerId: runnerId!,
      tool: job!.tool,
      target: target!,
      args: job!.args,
      autoImport: false, // proof job — parsed by the validation branch, not imported as a new finding
      queuedBy: `${VALIDATE_PREFIX}${id}`,
      priority: JOB_PRIORITY.manual,
    },
  });
  await logAudit({
    type: "finding.validate",
    actor: email,
    summary: `Launched ${cls} proof (${job!.method}) via ${job!.tool} on ${target}`,
    target: id,
  });
  redirect(`${back}?ok=${encodeURIComponent(`Validation queued — proving ${cls} with ${job!.tool} (${job!.method}). Result updates this finding when done.`)}`);
}

/**
 * Capture runtime auth material at the finding's page (headless Chromium via the
 * runner's `browsercapture` tool) — the tokens that live in localStorage /
 * sessionStorage / cookies / XHR headers and never appear in the static JS, so
 * static secret scanning misses them. Owner-gated + authorized-only (it drives a
 * real browser at the live target). The runner reports redacted metadata only —
 * the token value never leaves the machine.
 */
export async function captureRuntimeSecrets(formData: FormData) {
  const email = await requireUser();
  const id = String(formData.get("id") ?? "");
  const back = `/dashboard/findings/${id}/exploit`;
  if (!id) redirect("/dashboard/findings");

  const finding = await prisma.finding.findUnique({
    where: { id },
    include: { engagement: { select: { id: true, ownerEmail: true, authorized: true, scope: true } } },
  });
  if (!finding) redirect(`${back}?error=${encodeURIComponent("Finding not found.")}`);
  const eng = finding!.engagement;
  if (eng.ownerEmail && eng.ownerEmail !== email) {
    redirect(`${back}?error=${encodeURIComponent("Only the engagement owner can run a runtime capture.")}`);
  }
  if (!eng.authorized) {
    redirect(`${back}?error=${encodeURIComponent("Record written authorization on the engagement before driving a browser at the target.")}`);
  }

  const { host, url } = findingTarget(finding!);
  // Capture at the app ORIGIN (runtime tokens live in the running app, not the JS
  // bundle URL a static finding often points at).
  let page = "";
  try {
    if (url) page = new URL(url).origin;
  } catch {
    /* fall through to host */
  }
  if (!page && host) page = `https://${host}`;
  if (!page) {
    redirect(`${back}?error=${encodeURIComponent("Couldn't derive a page URL to capture from this finding.")}`);
  }
  // SAFETY: a runtime capture drives a real browser at the page — never at a host
  // outside the engagement scope (the URL is grepped from the finding text).
  const pageHost = host || (() => { try { return new URL(page!).hostname; } catch { return ""; } })();
  if (!hostInScope(pageHost, scopeHosts(eng.scope))) {
    redirect(`${back}?error=${encodeURIComponent("The page derived from this finding is not in the engagement scope — refusing to drive a browser at an out-of-scope host.")}`);
  }

  const runnerId = await pickRunnerId();
  if (!runnerId) {
    redirect(`${back}?error=${encodeURIComponent("No runner online — connect a machine first.")}`);
  }

  await prisma.job.create({
    data: {
      engagementId: eng.id,
      runnerId: runnerId!,
      tool: "browsercapture",
      target: page!,
      args: "",
      autoImport: false, // human reads the redacted capture; not parsed into findings
      queuedBy: email,
      priority: JOB_PRIORITY.manual,
    },
  });
  await logAudit({
    type: "finding.browsercapture",
    actor: email,
    summary: `Runtime secret capture queued on ${page}`,
    target: id,
  });
  redirect(`${back}?ok=${encodeURIComponent(`Runtime capture queued on ${page}. The runner reports any localStorage/XHR tokens (redacted) in its job output.`)}`);
}
