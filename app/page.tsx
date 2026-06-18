import Link from "next/link";
import { auth } from "@/auth";

const FEATURES = [
  {
    title: "AI Security Assistant",
    body: "Ask about any tool or technique. Get a structured walkthrough: how it works, how it's tested and exploited, and how to protect, find, and fix it.",
  },
  {
    title: "Tool Catalog",
    body: "A searchable library of modern open-source and paid security tools — recon, web testing, exploitation, scanning, and defense.",
  },
  {
    title: "Locked Down",
    body: "Sign in with OAuth, gated by an authorized-email allowlist. Only the people you approve get through the door.",
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
        <p className="tag">AI-powered · Defensive & authorized testing</p>
        <h1 className="mt-4 text-4xl font-bold leading-tight sm:text-5xl">
          Your AI cybersecurity{" "}
          <span className="text-brand">play dashboard</span>.
        </h1>
        <p className="mt-5 text-lg text-gray-300">
          Bring every modern tool into one place and learn, hands-on, how to
          test, exploit, protect, find bugs, and fix them — guided by AI, behind
          a secure login.
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
