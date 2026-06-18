"use client";

import { useState } from "react";
import type { AssistantAnswer } from "@/lib/ai";

const EXAMPLES = [
  "SQL injection",
  "Cross-site scripting (XSS)",
  "Nmap host discovery",
  "JWT misconfiguration",
  "Hardcoded secrets in a repo",
];

export function Assistant() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);

  async function ask(q: string) {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: query }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setAnswer((await res.json()) as AssistantAnswer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(topic);
        }}
        className="flex gap-2"
      >
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. SQL injection, Burp Suite, password hashing…"
          className="flex-1 rounded-lg border border-surface-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
        <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50">
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setTopic(ex);
              ask(ex);
            }}
            className="tag hover:border-brand hover:text-brand"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {answer && (
        <article className="mt-8 space-y-5">
          <header className="card">
            <h2 className="text-xl font-bold text-brand">{answer.topic}</h2>
            <p className="mt-2 text-sm text-gray-300">{answer.summary}</p>
            {answer.relatedTools.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {answer.relatedTools.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </header>

          {answer.sections.map((s) => (
            <section key={s.heading} className="card">
              <h3 className="font-semibold text-brand-glow">{s.heading}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-300">{s.body}</p>
              {s.snippets && s.snippets.length > 0 && (
                <pre className="mt-3 overflow-x-auto rounded-lg border border-surface-border bg-black/50 p-3 font-mono text-xs text-gray-300">
                  {s.snippets.join("\n")}
                </pre>
              )}
            </section>
          ))}

          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
            {answer.disclaimer}
          </p>
        </article>
      )}
    </div>
  );
}
