import Link from "next/link";
import { listTopics } from "@/lib/knowledge";
import { KnowledgeList } from "@/components/knowledge-list";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default function KnowledgePage() {
  const topics = listTopics();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Knowledge Library"
        subtitle="Structured how-to-and-how-to-defend write-ups. The same content the AI assistant draws from."
        actions={
          <Link href="/dashboard/assistant" className="btn-ghost">
            Ask the assistant
          </Link>
        }
      />
      <KnowledgeList topics={topics} />
    </div>
  );
}
