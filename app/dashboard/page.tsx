import Link from "next/link";
import { auth } from "@/auth";
import { Icon } from "@/components/icons";
import { PILLARS } from "@/data/portal";
import { TOOLS } from "@/data/tools";
import { listTopics } from "@/lib/knowledge";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardOverview() {
  const session = await auth();
  const firstName = session?.user?.name?.split(" ")[0] ?? "operator";
  const topics = listTopics();
  const engagementCount = await prisma.engagement.count();

  const stats = [
    { label: "Engagements", value: engagementCount },
    { label: "Workflow stages", value: PILLARS.reduce((n, p) => n + p.stages.length, 0) },
    { label: "Tools cataloged", value: TOOLS.length },
    { label: "Knowledge topics", value: topics.length },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      {/* Hero */}
      <section className="card relative overflow-hidden">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/10 blur-3xl" />
        <p className="tag ring-emerald accent-emerald">All-in-one security portal</p>
        <h1 className="mt-3 text-3xl font-bold">
          Welcome back, {firstName}.
        </h1>
        <p className="mt-2 max-w-2xl text-gray-400">
          Run digital forensics, penetration testing, and security consulting
          from one place — guided step by step, with AI and your own knowledge
          base alongside. Whatever you need to test, start here.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/dashboard/pentest" className="btn-primary">
            Start a pentest <Icon name="arrow" className="h-4 w-4" />
          </Link>
          <Link href="/dashboard/assistant" className="btn-ghost">
            Ask the assistant
          </Link>
        </div>
      </section>

      {/* Stats */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <p className="stat-num">{s.value}</p>
            <p className="mt-1 text-sm text-gray-400">{s.label}</p>
          </div>
        ))}
      </section>

      {/* Pillars */}
      <h2 className="mt-10 text-lg font-semibold">The three pillars</h2>
      <section className="mt-4 grid gap-5 lg:grid-cols-3">
        {PILLARS.map((p) => (
          <Link key={p.slug} href={`/dashboard/${p.slug}`} className="card-hover group">
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg ring-${p.accent} border accent-${p.accent}`}>
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

      {/* Resources */}
      <h2 className="mt-10 text-lg font-semibold">Resources</h2>
      <section className="mt-4 grid gap-5 sm:grid-cols-2">
        <Link href="/dashboard/assistant" className="card-hover">
          <h3 className="flex items-center gap-2 font-semibold text-brand-glow">
            <Icon name="bot" className="h-5 w-5" /> AI Security Assistant
          </h3>
          <p className="mt-2 text-sm text-gray-400">
            Ask any topic and get a how-to-and-how-to-defend breakdown, served
            from your knowledge base.
          </p>
        </Link>
        <Link href="/dashboard/tools" className="card-hover">
          <h3 className="flex items-center gap-2 font-semibold text-brand-glow">
            <Icon name="wrench" className="h-5 w-5" /> Tool Catalog
          </h3>
          <p className="mt-2 text-sm text-gray-400">
            Browse modern open-source and paid security tools by category.
          </p>
        </Link>
        <Link href="/dashboard/shiva" className="card-hover sm:col-span-2">
          <h3 className="flex items-center gap-2 font-semibold text-brand-glow">
            <Icon name="book" className="h-5 w-5" /> Shiva — MCP Security
          </h3>
          <p className="mt-2 text-sm text-gray-400">
            The research control room for securing the Model Context Protocol —
            roadmap, threat model, and attack write-ups, rendered with live
            diagrams.
          </p>
        </Link>
      </section>

      <p className="mt-10 flex items-center gap-2 text-xs text-gray-500">
        <Icon name="lock" className="h-4 w-4" />
        Only assess systems you own or are explicitly authorized to test.
      </p>
    </div>
  );
}
