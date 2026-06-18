import { Assistant } from "./assistant";
import { listTopics } from "@/lib/knowledge";

export default function AssistantPage() {
  const topics = listTopics();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">AI Security Assistant</h1>
      <p className="mt-2 text-gray-400">
        Enter a tool, technique, or vulnerability. Answers come from your own
        knowledge base when available, with a structured starting point
        otherwise.
      </p>
      {topics.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">
          {topics.length} topic{topics.length === 1 ? "" : "s"} in your knowledge
          base.
        </p>
      )}
      <Assistant topics={topics.map((t) => t.title)} />
    </div>
  );
}
