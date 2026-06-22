import Link from "next/link";
import { auth } from "@/auth";
import { Icon } from "@/components/icons";

const PILLARS = [
  {
    icon: "target",
    title: "Penetration Testing",
    body: "The full kill chain — recon, scanning, exploitation, and reporting. Whatever you need to test, guided step by step.",
    accent: "emerald",
  },
  {
    icon: "fingerprint",
    title: "Digital Forensics",
    body: "Acquire evidence soundly, analyze disk and memory, build timelines, and report — chain of custody intact.",
    accent: "sky",
  },
  {
    icon: "briefcase",
    title: "Security Consulting",
    body: "Engagements, scoping & authorization, risk against standards, findings, and client-ready reports.",
    accent: "amber",
  },
];

const RING: Record<string, string> = {
  emerald: "ring-emerald accent-emerald",
  sky: "ring-sky accent-sky",
  amber: "ring-amber accent-amber",
};

export default async function Home() {
  const session = await auth();
  const target = session?.user ? "/dashboard" : "/login";

  return (
    <main>
      {/* Nav */}
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-black text-black">
            R
          </span>
          <span className="font-mono text-base font-bold">
            RD<span className="text-brand">-AISEC</span>
          </span>
        </span>
        <Link href={target} className="btn-ghost">
          {session?.user ? "Open dashboard" : "Sign in"}
        </Link>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-24 top-0 h-80 w-80 rounded-full bg-sky-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 top-10 h-80 w-80 rounded-full bg-red-500/15 blur-3xl" />

        <div className="relative mx-auto flex max-w-3xl flex-col items-center px-6 pb-10 pt-16 text-center">
          <p className="tag">Forensics · Pentesting · Consulting — AI-powered</p>
          <h1 className="mt-5 text-4xl font-bold leading-tight sm:text-6xl">
            Your all-in-one{" "}
            <span className="text-gradient">security operations portal</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-gray-400">
            Run digital forensics, penetration testing, and consulting from one
            place — every workflow guided step by step, with AI and your own
            knowledge base alongside.
          </p>

          <div className="relative my-10 grid place-items-center">
            <div className="orb" />
            <span className="absolute grid h-14 w-14 place-items-center rounded-full border border-surface-border bg-surface text-sm font-black tracking-widest text-white">
              VS
            </span>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            <Link href={target} className="btn-primary">
              {session?.user ? "Go to dashboard" : "Get started"}
              <Icon name="arrow" className="h-4 w-4" />
            </Link>
            <Link href={target} className="btn-ghost">
              <Icon name="lock" className="h-4 w-4" /> Secure sign-in
            </Link>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-5 lg:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.title} className="card-hover">
              <div className={`flex h-11 w-11 items-center justify-center rounded-lg border ${RING[p.accent]}`}>
                <Icon name={p.icon} className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold text-white">{p.title}</h3>
              <p className="mt-2 text-sm text-gray-400">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing quote */}
      <section className="mx-auto max-w-4xl px-6 pb-16">
        <blockquote className="rounded-2xl border border-surface-border bg-surface-card/40 px-6 py-10 text-center">
          <p className="text-xl font-semibold text-gray-200 sm:text-2xl">
            &ldquo;Pentesting shows you what an attacker{" "}
            <span className="text-glow-red">could reach</span>. Forensics shows
            you what they <span className="text-glow-blue">already touched</span>.&rdquo;
          </p>
          <Link href={target} className="btn-primary mt-6 inline-flex">
            Enter the portal <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </blockquote>

        <p className="mt-8 flex items-center justify-center gap-2 text-center text-xs text-gray-500">
          <Icon name="lock" className="h-4 w-4" />
          For authorized security testing and education only. Only assess systems
          you own or are explicitly authorized to test.
        </p>
      </section>
    </main>
  );
}
