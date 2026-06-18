import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateAnswer } from "@/lib/ai";
import { findTopic } from "@/lib/knowledge";
import { TOOLS } from "@/data/tools";

export async function POST(req: Request) {
  // Protect the endpoint — only signed-in users may query.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let topic = "";
  try {
    const body = await req.json();
    topic = String(body?.topic ?? "").slice(0, 500);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!topic.trim()) {
    return NextResponse.json({ error: "A topic is required" }, { status: 400 });
  }

  // Hybrid: serve the local knowledge base first; fall back to a generated
  // answer when no write-up matches.
  const answer = findTopic(topic) ?? (await generateAnswer(topic));

  // If the entry didn't declare related tools, infer them from the catalog.
  if (answer.relatedTools.length === 0) {
    const lower = topic.toLowerCase();
    answer.relatedTools = TOOLS.filter(
      (t) =>
        lower.includes(t.name.toLowerCase()) ||
        lower.includes(t.category.toLowerCase()),
    )
      .slice(0, 5)
      .map((t) => t.name);
  }

  return NextResponse.json(answer);
}
