import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

// The Voice Command Center asks this endpoint a status question and speaks the
// returned `speak` string aloud. Everything is computed into a ready-to-say
// sentence here so the client stays dumb (and the same phrasing is testable).
//
//   GET /api/voice/brief?topic=summary|runners|jobs|findings|critical

type Topic = "summary" | "runners" | "jobs" | "findings" | "critical";
const TOPICS: Topic[] = ["summary", "runners", "jobs", "findings", "critical"];

/** "1 machine" / "3 machines" — small helper so replies read naturally. */
function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Join a short list conversationally: "a, b and c". */
function andList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

async function runnersReply(now: number): Promise<string> {
  const runners = await prisma.runner.findMany({
    orderBy: { lastSeenAt: "desc" },
    select: { name: true, lastSeenAt: true },
  });
  const online = runners.filter(
    (r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS,
  );
  if (runners.length === 0)
    return "You don't have any machines connected yet. Add one from the Machines page.";
  if (online.length === 0)
    return `None of your ${plural(runners.length, "machine")} are online right now.`;
  const names = andList(online.slice(0, 4).map((r) => r.name));
  const extra = online.length > 4 ? `, and ${online.length - 4} more` : "";
  return `${plural(online.length, "machine")} online — ${names}${extra}.`;
}

async function jobsReply(): Promise<string> {
  const [running, queued] = await Promise.all([
    prisma.job.count({ where: { status: "running" } }),
    prisma.job.count({ where: { status: "queued" } }),
  ]);
  if (running === 0 && queued === 0) return "Nothing is running right now — the queue is clear.";
  const parts: string[] = [];
  if (running > 0) parts.push(`${plural(running, "scan")} running`);
  if (queued > 0) parts.push(`${plural(queued, "job")} queued`);
  return andList(parts).replace(/^./, (c) => c.toUpperCase()) + ".";
}

async function findingsReply(): Promise<string> {
  const open = await prisma.finding.groupBy({
    by: ["severity"],
    where: { status: "open" },
    _count: { _all: true },
  });
  const bySev: Record<string, number> = {};
  let total = 0;
  for (const g of open) {
    bySev[g.severity] = g._count._all;
    total += g._count._all;
  }
  if (total === 0) return "You have no open findings. Nice and clean.";
  const crit = bySev.critical ?? 0;
  const high = bySev.high ?? 0;
  const rest = total - crit - high;
  const parts: string[] = [];
  if (crit) parts.push(plural(crit, "critical"));
  if (high) parts.push(plural(high, "high"));
  if (rest) parts.push(`${rest} medium or lower`);
  return `You have ${plural(total, "open finding")}: ${andList(parts)}.`;
}

async function criticalReply(): Promise<string> {
  const [count, latest] = await Promise.all([
    prisma.finding.count({ where: { status: "open", severity: "critical" } }),
    prisma.finding.findFirst({
      where: { status: "open", severity: "critical" },
      orderBy: { createdAt: "desc" },
      select: { title: true },
    }),
  ]);
  if (count === 0) return "No open critical findings — good news.";
  const tail = latest?.title ? ` The most recent is: ${latest.title}.` : "";
  return `You have ${plural(count, "open critical finding")}.${tail}`;
}

async function summaryReply(now: number): Promise<string> {
  const [runners, running, queued, crit, open] = await Promise.all([
    prisma.runner.findMany({ select: { lastSeenAt: true } }),
    prisma.job.count({ where: { status: "running" } }),
    prisma.job.count({ where: { status: "queued" } }),
    prisma.finding.count({ where: { status: "open", severity: "critical" } }),
    prisma.finding.count({ where: { status: "open" } }),
  ]);
  const online = runners.filter(
    (r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS,
  ).length;

  const machines =
    online > 0 ? `${plural(online, "machine")} online` : "no machines online";
  const work =
    running > 0 || queued > 0
      ? `${plural(running, "scan")} running${queued ? ` and ${plural(queued, "job")} queued` : ""}`
      : "nothing running";
  const findings =
    open > 0
      ? `${plural(open, "open finding")}${crit ? `, including ${plural(crit, "critical")}` : ""}`
      : "no open findings";
  return `Here's your status: ${machines}, ${work}. You have ${findings}.`;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const raw = (url.searchParams.get("topic") || "summary").toLowerCase();
  const topic: Topic = (TOPICS as string[]).includes(raw) ? (raw as Topic) : "summary";
  const now = Date.now();

  let speak: string;
  try {
    switch (topic) {
      case "runners":
        speak = await runnersReply(now);
        break;
      case "jobs":
        speak = await jobsReply();
        break;
      case "findings":
        speak = await findingsReply();
        break;
      case "critical":
        speak = await criticalReply();
        break;
      default:
        speak = await summaryReply(now);
    }
  } catch {
    speak = "Sorry, I couldn't reach that just now. Please try again in a moment.";
  }

  return NextResponse.json({ topic, speak });
}
