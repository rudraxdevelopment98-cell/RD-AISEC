import Link from "next/link";
import { auth } from "@/auth";

const FEATURES = [
  {
    title: "Digital Forensics",
    body: "Acquire evidence soundly, analyze disk and memory, build timelines, and report — chain of custody intact, start to finish.",
  },
  {
    title: "Penetration Testing",
    body: "The full kill chain: recon, scanning, vulnerability analysis, exploitation, and reporting. Whatever you need to test, guided step by step.",
  },
  {
    title: "Security Consulting",
    body: "Engagements, scoping & authorization, risk against standards, findings, and client-ready reports — the business wrapper around testing.",
  },
];

export default async function Home() {
  const session = await auth();

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <div className="flex items-center justify-between">
        <span className="font-mono text-lg font-bold text-brand">RD-AISEC</span>
        <Link
          href={session?.user ? "/dashboard" : "/login"}
          className="btn-ghost"
        >
          {session?.user ? "Open Dashboard" : "Sign in"}
        </Link>
      </div>

      <section className="mt-20 max-w-3xl">
        <p className="tag">Forensics · Pentesting · Consulting — AI-powered</p>
        <h1 className="mt-4 text-4xl font-bold leading-tight sm:text-5xl">
          Your all-in-one{" "}
          <span className="text-brand">security operations portal</span>.
        </h1>
        <p className="mt-5 text-lg text-gray-300">
          Digital forensics, penetration testing, and security consulting in one
          place — every workflow guided step by step, with AI and your own
          knowledge base alongside, behind a secure login.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href={session?.user ? "/dashboard" : "/login"} className="btn-primary">
            {session?.user ? "Go to dashboard" : "Get started"}
          </Link>
          <Link href="/dashboard/tools" className="btn-ghost">
            Browse tools
          </Link>
        </div>
      </section>

      <section className="mt-20 grid gap-5 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <h3 className="font-semibold text-brand-glow">{f.title}</h3>
            <p className="mt-2 text-sm text-gray-300">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-24 border-t border-surface-border pt-6 text-xs text-gray-500">
        For authorized security testing and education only. Only assess systems
        you own or have explicit written permission to test.
      </footer>
    </main>
  );
}
