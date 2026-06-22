import Link from "next/link";
import { listTopics } from "@/lib/knowledge";
import { KnowledgeList } from "@/components/knowledge-list";

export const dynamic = "force-dynamic";

export default function KnowledgePage() {
  const topics = listTopics();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Knowledge Library</h1>
          <p className="mt-1 text-gray-400">
            Structured how-to-and-how-to-defend write-ups. The same content the
            AI assistant draws from.
          </p>
        </div>
        <Link href="/dashboard/assistant" className="btn-ghost">
          Ask the assistant
        </Link>
      </div>
      <KnowledgeList topics={topics} />
    </div>
  );
}
