"use client";

import { useState } from "react";
import type { AssistantAnswer } from "@/lib/ai";

export function Assistant({ topics }: { topics: string[] }) {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);

  const chips = topics.length
    ? topics
    : ["SQL injection", "Cross-site scripting (XSS)", "Hardcoded secrets"];

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
        {chips.map((ex) => (
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
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-bold text-brand">{answer.topic}</h2>
              <span
                className={`tag shrink-0 ${
                  answer.source === "knowledge"
                    ? "border-emerald-500/40 text-emerald-300"
                    : "border-sky-500/40 text-sky-300"
                }`}
              >
                {answer.source === "knowledge"
                  ? "From knowledge base"
                  : "Generated starting point"}
              </span>
            </div>
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
              {/* Content is our own trusted Markdown, rendered to HTML. */}
              <div
                className="prose-invert mt-2 text-sm leading-relaxed text-gray-300 [&_a]:text-brand [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1 [&_li]:ml-4 [&_li]:list-disc [&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-surface-border [&_pre]:bg-black/50 [&_pre]:p-3 [&_pre]:text-xs [&_strong]:text-white"
                dangerouslySetInnerHTML={{ __html: s.html }}
              />
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
