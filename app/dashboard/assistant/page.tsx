import { Assistant } from "./assistant";

export default function AssistantPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">AI Security Assistant</h1>
      <p className="mt-2 text-gray-400">
        Enter a tool, technique, or vulnerability. You&apos;ll get a structured
        walkthrough: how it works, how it&apos;s tested and exploited, and how to
        protect, find, and fix it.
      </p>
      <Assistant />
    </div>
  );
}
