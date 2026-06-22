import Link from "next/link";
import { notFound } from "next/navigation";
import { getTopicBySlug } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

const PROSE =
  "mt-2 text-sm leading-relaxed text-gray-300 [&_a]:text-brand [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1 [&_li]:ml-5 [&_li]:list-disc [&_li]:marker:text-gray-600 [&_ol_li]:list-decimal [&_p]:my-2 [&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-surface-border [&_pre]:bg-black/50 [&_pre]:p-3 [&_pre]:text-xs [&_strong]:text-white";

export default function KnowledgeTopicPage({
  params,
}: {
  params: { slug: string };
}) {
  const topic = getTopicBySlug(params.slug);
  if (!topic) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/dashboard/knowledge"
        className="text-sm text-gray-500 hover:text-brand"
      >
        ← Knowledge Library
      </Link>

      <header className="card mt-3">
        <h1 className="text-2xl font-bold text-gradient">{topic.topic}</h1>
        <p className="mt-2 text-sm text-gray-300">{topic.summary}</p>
        {topic.relatedTools.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {topic.relatedTools.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="mt-5 space-y-5">
        {topic.sections.map((s) => (
          <section key={s.heading} className="card">
            <h2 className="font-semibold text-brand-glow">{s.heading}</h2>
            <div className={PROSE} dangerouslySetInnerHTML={{ __html: s.html }} />
          </section>
        ))}
      </div>

      <p className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
        {topic.disclaimer}
      </p>
    </div>
  );
}
