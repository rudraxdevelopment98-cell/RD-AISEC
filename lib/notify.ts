// Outbound notifications via a Discord/Slack-compatible webhook (free). Node-only.

import { prisma } from "@/lib/db";

const RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export async function getNotifySetting() {
  return prisma.notifySetting.findFirst();
}

type NewFinding = { title: string; severity: string };

/**
 * Notify about new findings if any meet the configured severity threshold.
 * Best-effort: never throws (a webhook failure must not break job ingestion).
 */
export async function notifyFindings(findings: NewFinding[], context: string): Promise<void> {
  try {
    if (findings.length === 0) return;
    const cfg = await getNotifySetting();
    if (!cfg?.enabled || !cfg.discordWebhook) return;

    const min = RANK[cfg.minSeverity] ?? 3;
    const worthy = findings.filter((f) => (RANK[f.severity] ?? 0) >= min);
    if (worthy.length === 0) return;

    const top = worthy
      .slice()
      .sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0))
      .slice(0, 10);
    const lines = top.map((f) => `• [${f.severity.toUpperCase()}] ${f.title}`);
    const more = worthy.length > top.length ? `\n…and ${worthy.length - top.length} more` : "";
    const content =
      `🛡️ **RD-AISEC** — ${worthy.length} new finding(s) (${context})\n` +
      lines.join("\n") +
      more;

    // Discord uses { content }; Slack uses { text }. Send both keys so either works.
    await fetch(cfg.discordWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, text: content }),
    });
  } catch {
    /* swallow — notifications are best-effort */
  }
}

/**
 * Notify that a finding was confirmed exploitable (auto-validated or verified by
 * hand). Best-effort. Ignores the severity threshold — a confirmed exploit is
 * always worth a ping.
 */
export async function notifyConfirmed(
  finding: { title: string; severity: string },
  context: string,
  how: "auto" | "manual",
): Promise<void> {
  try {
    const cfg = await getNotifySetting();
    if (!cfg?.enabled || !cfg.discordWebhook) return;
    const content =
      `🔴 **RD-AISEC** — finding CONFIRMED exploitable (${how === "manual" ? "verified by hand" : "auto-validated"})\n` +
      `• [${finding.severity.toUpperCase()}] ${finding.title}\n` +
      `Engagement: ${context}`;
    await fetch(cfg.discordWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, text: content }),
    });
  } catch {
    /* swallow — notifications are best-effort */
  }
}

/** Send a one-off test message to verify the webhook. */
export async function sendTestNotification(webhook: string): Promise<boolean> {
  try {
    const msg = "✅ RD-AISEC test notification — your webhook is working.";
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: msg, text: msg }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
