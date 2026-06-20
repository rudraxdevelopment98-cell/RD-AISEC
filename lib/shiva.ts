import "server-only";
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";

/**
 * Loads the Shiva project's Markdown "control room" docs and prepares them for
 * rendering inside the portal — splitting out Mermaid diagrams (rendered live
 * client-side) and rewriting inter-doc .md links to portal routes.
 */

const DOC_DIRS = [
  path.join(process.cwd(), "shiva", "docs"),
  path.join(process.cwd(), "shiva", "docs", "attacks"),
];

// Curated order + friendly titles for the known docs (others still appear).
const ORDER: { slug: string; title: string; group: string }[] = [
  { slug: "index", title: "Start here", group: "Control room" },
  { slug: "overview", title: "Overview / Mindmap", group: "Control room" },
  { slug: "roadmap", title: "Roadmap", group: "Control room" },
  { slug: "progress", title: "Progress board", group: "Control room" },
  { slug: "learning", title: "Learning tracker", group: "Control room" },
  { slug: "architecture", title: "Architecture", group: "Building" },
  { slug: "threat-model", title: "Threat model", group: "Building" },
  { slug: "platform", title: "Platform", group: "Building" },
  { slug: "01-tool-poisoning", title: "Attack: Tool poisoning", group: "Attacks" },
  { slug: "02-description-drift", title: "Attack: Description drift", group: "Attacks" },
  { slug: "03-cross-tool-escalation", title: "Attack: Cross-tool escalation", group: "Attacks" },
  { slug: "improvements", title: "Improvements", group: "Notes" },
  { slug: "evidence", title: "Evidence / claims", group: "Notes" },
  { slug: "getting-started", title: "Getting started", group: "Guides" },
  { slug: "how-to-view", title: "How to view the charts", group: "Guides" },
  { slug: "setup-mac", title: "Mac + SSD setup", group: "Guides" },
  { slug: "supabase-setup", title: "Supabase setup", group: "Guides" },
];

marked.setOptions({ gfm: true, breaks: false });

export type DocSegment =
  | { type: "html"; html: string }
  | { type: "mermaid"; code: string };

export type ShivaDocMeta = { slug: string; title: string; group: string };

function fileForSlug(slug: string): string | null {
  for (const dir of DOC_DIRS) {
    const p = path.join(dir, `${slug}.md`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function discoverSlugs(): Set<string> {
  const slugs = new Set<string>();
  for (const dir of DOC_DIRS) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith(".md")) slugs.add(f.replace(/\.md$/, ""));
      }
    } catch {
      /* dir missing */
    }
  }
  return slugs;
}

export function listShivaDocs(): ShivaDocMeta[] {
  const available = discoverSlugs();
  const ordered = ORDER.filter((d) => available.has(d.slug));
  // Append any docs not in the curated list.
  const known = new Set(ORDER.map((d) => d.slug));
  for (const slug of available) {
    if (!known.has(slug)) ordered.push({ slug, title: slug, group: "Other" });
  }
  return ordered;
}

/** Rewrite links like (overview.md) or (attacks/01-x.md#a) to portal routes. */
function rewriteLinks(md: string, validSlugs: Set<string>): string {
  return md.replace(
    /\]\(([^)]+?\.md)(#[^)]*)?\)/g,
    (full, file: string, anchor = "") => {
      const base = path.basename(file).replace(/\.md$/, "");
      if (!validSlugs.has(base)) return full;
      return `](/dashboard/shiva/${base}${anchor})`;
    },
  );
}

export function getShivaDoc(
  slug: string,
): { title: string; segments: DocSegment[] } | null {
  const file = fileForSlug(slug);
  if (!file) return null;

  let raw = fs.readFileSync(file, "utf8");
  raw = rewriteLinks(raw, discoverSlugs());

  // Title = first H1, else the curated title, else the slug.
  const h1 = raw.match(/^#\s+(.+)$/m);
  const curated = ORDER.find((d) => d.slug === slug);
  const title = h1?.[1]?.trim() || curated?.title || slug;

  // Split into prose + mermaid segments.
  const segments: DocSegment[] = [];
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const before = raw.slice(last, m.index);
    if (before.trim()) segments.push({ type: "html", html: marked.parse(before) as string });
    segments.push({ type: "mermaid", code: m[1].trim() });
    last = re.lastIndex;
  }
  const tail = raw.slice(last);
  if (tail.trim()) segments.push({ type: "html", html: marked.parse(tail) as string });

  return { title, segments };
}
