import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";
import type { AnswerSection, AssistantAnswer } from "@/lib/ai";
import { DISCLAIMER } from "@/lib/ai";

/**
 * The local knowledge base: one Markdown file per topic in content/topics.
 *
 * Frontmatter fields (all optional except title):
 *   title:        Display name of the topic
 *   category:     Grouping label (e.g. "Web App Testing")
 *   tags:         List of keywords used for search matching
 *   summary:      One-line summary shown at the top of the answer
 *   relatedTools: List of tool names from data/tools.ts
 *
 * The body is plain Markdown. Each `## Heading` becomes a section; the text
 * under it is rendered to HTML and shown in the assistant UI.
 */

const TOPICS_DIR = path.join(process.cwd(), "content", "topics");

export type TopicMeta = {
  slug: string;
  title: string;
  category: string;
  tags: string[];
  summary: string;
};

marked.setOptions({ gfm: true, breaks: false });

function readTopicFiles(): string[] {
  try {
    return fs.readdirSync(TOPICS_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return []; // directory missing — knowledge base is simply empty
  }
}

type ParsedTopic = {
  meta: TopicMeta;
  answer: AssistantAnswer;
};

function parseTopic(file: string): ParsedTopic | null {
  const slug = file.replace(/\.md$/, "");
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(TOPICS_DIR, file), "utf8");
  } catch {
    return null;
  }

  const { data, content } = matter(raw);
  const title = String(data.title ?? slug);
  const category = String(data.category ?? "Uncategorized");
  const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  const summary = String(data.summary ?? "");
  const relatedTools = Array.isArray(data.relatedTools)
    ? data.relatedTools.map(String)
    : [];

  // Split the markdown body into sections on `## ` headings.
  const sections: AnswerSection[] = [];
  const parts = content.split(/^##\s+/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const newline = trimmed.indexOf("\n");
    const heading = (newline === -1 ? trimmed : trimmed.slice(0, newline)).trim();
    const bodyMd = newline === -1 ? "" : trimmed.slice(newline + 1).trim();
    // Skip a leading H1 / intro that isn't a real `##` section.
    if (heading.startsWith("#")) continue;
    sections.push({ heading, html: marked.parse(bodyMd) as string });
  }

  return {
    meta: { slug, title, category, tags, summary },
    answer: {
      topic: title,
      summary:
        summary || `Knowledge-base entry for ${title}.`,
      sections,
      relatedTools,
      source: "knowledge",
      disclaimer: DISCLAIMER,
    },
  };
}

let cache: ParsedTopic[] | null = null;

function allTopics(): ParsedTopic[] {
  if (cache) return cache;
  cache = readTopicFiles()
    .map(parseTopic)
    .filter((t): t is ParsedTopic => t !== null);
  return cache;
}

/** Lightweight list of available topics (for chips / browsing). */
export function listTopics(): TopicMeta[] {
  return allTopics()
    .map((t) => t.meta)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Find the best-matching knowledge entry for a free-text query.
 * Scores by title / slug / tag / category overlap. Returns null if nothing
 * meaningfully matches, so the caller can fall back to the generated answer.
 */
export function findTopic(query: string): AssistantAnswer | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);

  let best: { score: number; topic: ParsedTopic } | null = null;

  for (const topic of allTopics()) {
    const { meta } = topic;
    const title = meta.title.toLowerCase();
    const haystackWords = new Set(
      [meta.slug, title, meta.category.toLowerCase(), ...meta.tags.map((t) => t.toLowerCase())]
        .join(" ")
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    );

    let score = 0;
    if (title === q || meta.slug === q) score += 100;
    if (title.includes(q) || q.includes(title)) score += 20;
    for (const w of words) {
      if (haystackWords.has(w)) score += 5;
      if (meta.tags.some((t) => t.toLowerCase() === w)) score += 3;
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { score, topic };
    }
  }

  return best ? best.topic.answer : null;
}
