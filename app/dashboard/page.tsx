import Link from "next/link";
import { auth } from "@/auth";
import { Icon } from "@/components/icons";
import { PILLARS } from "@/data/portal";
import { TOOLS } from "@/data/tools";
import { listTopics } from "@/lib/knowledge";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const OFFENSE_TILES = [
  { icon: "search", label: "Recon" },
  { icon: "target", label: "Scanning" },
  { icon: "skull", label: "Exploitation" },
  { icon: "book", label: "Reporting" },
];
const DEFENSE_TILES = [
  { icon: "fingerprint", label: "Acquisition" },
  { icon: "eye", label: "Analysis" },
  { icon: "clock", label: "Timeline" },
  { icon: "alert", label: "Detection" },
];
const WHY = [
  { icon: "search", label: "Better Investigations" },
  { icon: "alert", label: "Earlier Detection" },
  { icon: "bolt", label: "Faster Response" },
  { icon: "shield", label: "Stronger Defense" },
];
const PILLAR_RING: Record<string, string> = {
  emerald: "ring-emerald accent-emerald",
  sky: "ring-sky accent-sky",
  amber: "ring-amber accent-amber",
};

export default async function DashboardOverview() {
  const session = await auth();
  const firstName = session?.user?.name?.split(" ")[0] ?? "operator";
  const topics = listTopics();
  const engagementCount = await prisma.engagement.count();

  const stats = [
    { label: "Engagements", value: engagementCount },
    { label: "Workflow stages", value: PILLARS.reduce((n, p) => n + p.stages.length, 0) },
    { label: "Tools", value: TOOLS.length },
    { label: "Knowledge topics", value: topics.length },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      {/* ── Cinematic hero ──────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-2xl border border-surface-border bg-surface-card/40 px-6 py-12">
        <div className="pointer-events-none absolute -left-20 top-0 h-72 w-72 rounded-full bg-sky-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-red-500/15 blur-3xl" />

        <div className="relative flex flex-col items-center text-center">
          <p className="tag">Welcome back, {firstName}</p>
          <h1 className="mt-4 text-4xl font-bold sm:text-5xl">
            <span className="text-glow-red">Offense</span>{" "}
            <span className="text-gray-500">meets</span>{" "}
            <span className="text-glow-blue">Defense</span>
          </h1>
          <p className="mt-3 max-w-xl text-gray-400">
            One portal for the whole security lifecycle — penetration testing,
            digital forensics, and consulting, with AI and your own intelligence
            alongside.
          </p>

          <div className="relative my-8 grid place-items-center">
            <div className="orb" />
            <span className="absolute grid h-14 w-14 place-items-center rounded-full border border-surface-border bg-surface text-sm font-black tracking-widest text-white">
              VS
            </span>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/dashboard/pentest" className="btn-primary">
              Start a pentest <Icon name="arrow" className="h-4 w-4" />
            </Link>
            <Link href="/dashboard/engagements" className="btn-ghost">
              <Icon name="briefcase" className="h-4 w-4" /> Open engagements
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stat strip ──────────────────────────────────────────── */}
      <section className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card text-center">
            <p className="stat-num">{s.value}</p>
            <p className="mt-1 text-sm text-gray-400">{s.label}</p>
          </div>
        ))}
      </section>

      {/* ── Offense vs Defense comparison ───────────────────────── */}
      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border p-5 panel-red">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Icon name="skull" className="h-5 w-5 text-red-400" /> Offense
          </h3>
          <p className="mt-1 flex items-center gap-2 text-sm text-red-300">
            <Icon name="check" className="h-4 w-4" /> Find the weaknesses first
          </p>
          <p className="mt-2 text-sm text-gray-400">
            Test like an attacker would — within authorized scope.
          </p>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {OFFENSE_TILES.map((t) => (
              <div key={t.label} className="tile">
                <span className="tile-icon border-red-500/40 text-red-300">
                  <Icon name={t.icon} className="h-4 w-4" />
                </span>
                {t.label}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border p-5 panel-blue">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Icon name="shield" className="h-5 w-5 text-sky-400" /> Defense
          </h3>
          <p className="mt-1 flex items-center gap-2 text-sm text-sky-300">
            <Icon name="check" className="h-4 w-4" /> Investigate, detect, respond
          </p>
          <p className="mt-2 text-sm text-gray-400">
            Preserve evidence, analyze, and harden against the next attack.
          </p>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {DEFENSE_TILES.map((t) => (
              <div key={t.label} className="tile">
                <span className="tile-icon border-sky-500/40 text-sky-300">
                  <Icon name={t.icon} className="h-4 w-4" />
                </span>
                {t.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why a unified portal ────────────────────────────────── */}
      <h2 className="mt-10 text-center text-lg font-semibold">
        Why run it all in one place
      </h2>
      <section className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {WHY.map((w) => (
          <div key={w.label} className="card flex flex-col items-center gap-2 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-surface-border text-brand">
              <Icon name={w.icon} className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium text-gray-200">{w.label}</p>
          </div>
        ))}
      </section>

      {/* ── Pillars ─────────────────────────────────────────────── */}
      <h2 className="mt-10 text-lg font-semibold">The three pillars</h2>
      <section className="mt-4 grid gap-5 lg:grid-cols-3">
        {PILLARS.map((p) => (
          <Link key={p.slug} href={`/dashboard/${p.slug}`} className="card-hover group">
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg border ${PILLAR_RING[p.accent]}`}>
              <Icon name={p.icon} className="h-5 w-5" />
            </div>
            <h3 className="mt-4 font-semibold text-white">{p.title}</h3>
            <p className={`mt-1 text-xs accent-${p.accent}`}>{p.tagline}</p>
            <p className="mt-2 text-sm text-gray-400">{p.description}</p>
            <p className="mt-4 flex items-center gap-1 text-sm font-medium text-brand">
              Open workflow
              <Icon name="arrow" className="h-4 w-4 transition group-hover:translate-x-1" />
            </p>
          </Link>
        ))}
      </section>

      {/* ── Closing quote ───────────────────────────────────────── */}
      <blockquote className="mt-12 rounded-xl border border-surface-border bg-surface-card/40 px-6 py-8 text-center">
        <p className="text-lg font-semibold text-gray-200 sm:text-xl">
          &ldquo;Pentesting shows you what an attacker{" "}
          <span className="text-glow-red">could reach</span>. Forensics shows you
          what they <span className="text-glow-blue">already touched</span>.&rdquo;
        </p>
      </blockquote>

      <p className="mt-8 flex items-center justify-center gap-2 text-xs text-gray-500">
        <Icon name="lock" className="h-4 w-4" />
        Only assess systems you own or are explicitly authorized to test.
      </p>
    </div>
  );
}
