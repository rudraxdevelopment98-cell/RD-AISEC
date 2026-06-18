import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateAnswer } from "@/lib/ai";
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

  const answer = await generateAnswer(topic);

  // Surface related tools from the catalog by simple keyword overlap.
  const lower = topic.toLowerCase();
  answer.relatedTools = TOOLS.filter(
    (t) =>
      lower.includes(t.name.toLowerCase()) ||
      lower.includes(t.category.toLowerCase()) ||
      t.category.toLowerCase().split(/[^a-z]+/).some((w) => w && lower.includes(w)),
  )
    .slice(0, 5)
    .map((t) => t.name);

  return NextResponse.json(answer);
}
