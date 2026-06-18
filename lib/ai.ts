/**
 * AI adapter for the security assistant.
 *
 * Answers come from TWO sources (hybrid model):
 *   1. The local knowledge base — your own Markdown write-ups in content/topics.
 *      This is the source of truth and is fully self-processed (no external AI).
 *   2. This generated fallback — a structured placeholder for topics you haven't
 *      written up yet. Swap in Claude here to expand/summarize your own data.
 *
 * The `AssistantAnswer` shape is what the UI renders, so both sources produce it.
 */

export type AnswerSection = {
  heading: string;
  /** Pre-rendered, trusted HTML for this section's body. */
  html: string;
};

export type AssistantAnswer = {
  topic: string;
  summary: string;
  sections: AnswerSection[];
  /** Tools from our catalog (by name) related to this topic. */
  relatedTools: string[];
  /** Where the answer came from, surfaced as a badge in the UI. */
  source: "knowledge" | "generated";
  disclaimer: string;
};

export const DISCLAIMER =
  "For authorized security testing and education only. Only test systems you own or have explicit written permission to assess.";

/** Minimal HTML escaping for untrusted-ish text in the generated fallback. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function p(text: string): string {
  return `<p>${esc(text)}</p>`;
}

function pre(lines: string[]): string {
  return `<pre><code>${esc(lines.join("\n"))}</code></pre>`;
}

/**
 * The fixed structure every generated answer follows: learn it, attack it (to
 * understand the risk), defend it, find the bug, fix the bug.
 */
function buildSections(topic: string): AnswerSection[] {
  return [
    {
      heading: "How it works",
      html: p(
        `A clear mental model of "${topic}": what the component is, where it sits in a system, and the trust boundaries around it. Understanding the normal, intended behavior first is what lets you reason about how it breaks.`,
      ),
    },
    {
      heading: "How to do it (recon & testing)",
      html:
        p(
          `The practical, hands-on workflow for assessing "${topic}" in an authorized engagement: enumerate the surface, map inputs and outputs, and probe behavior methodically.`,
        ) +
        pre([
          "# Map the surface (example)",
          "nmap -sV -p- target.example.com",
          "# Inspect HTTP behavior",
          "curl -i https://target.example.com/",
        ]),
    },
    {
      heading: "How it gets exploited",
      html: p(
        `The common failure modes behind "${topic}" and why they happen — missing validation, weak defaults, trust placed in attacker-controlled data. Knowing the exploit path is what makes a fix meaningful rather than cosmetic.`,
      ),
    },
    {
      heading: "How to protect & defend",
      html: p(
        `Concrete, layered mitigations for "${topic}": validate at boundaries, apply least privilege, use safe defaults, and add detection so abuse is visible.`,
      ),
    },
    {
      heading: "How to find the bug",
      html: p(
        `Where to look in code and configuration for "${topic}" issues: dangerous sinks, unsanitized inputs, and risky configuration. Pair manual review with automated scanners.`,
      ),
    },
    {
      heading: "How to fix it",
      html: p(
        `Remediation guidance for "${topic}": the minimal correct change, how to verify the fix actually closes the hole, and how to prevent regressions with tests and CI checks.`,
      ),
    },
  ];
}

export async function generateAnswer(topic: string): Promise<AssistantAnswer> {
  const clean = topic.trim() || "the requested security topic";

  // If a real key is configured, you can flip this to use Claude.
  // if (process.env.ANTHROPIC_API_KEY) return generateWithClaude(clean);

  return {
    topic: clean,
    summary: `No write-up exists yet for "${clean}". Here's a structured starting point — how it works, how it's tested and exploited, and how to protect, find, and fix it. Add a Markdown file in content/topics to make this a first-class entry.`,
    sections: buildSections(clean),
    relatedTools: [],
    source: "generated",
    disclaimer: DISCLAIMER,
  };
}

/**
 * Real Claude integration (hybrid mode) — enable by:
 *   1) npm install @anthropic-ai/sdk
 *   2) set ANTHROPIC_API_KEY in .env.local
 *   3) uncomment the early return in generateAnswer above.
 *
 * In hybrid mode, pass a matched knowledge entry as context so Claude EXPANDS
 * your own data rather than inventing its own:
 *
 * import Anthropic from "@anthropic-ai/sdk";
 *
 * async function generateWithClaude(topic: string, context?: string) {
 *   const client = new Anthropic(); // reads ANTHROPIC_API_KEY
 *   const res = await client.messages.create({
 *     model: "claude-opus-4-8",
 *     max_tokens: 16000,
 *     thinking: { type: "adaptive" },
 *     system:
 *       "You are a defensive-security tutor for AUTHORIZED testing and education. " +
 *       "Prefer the provided knowledge-base context as the source of truth; expand " +
 *       "and clarify it. Refuse clearly malicious, unauthorized, or destructive requests.",
 *     messages: [
 *       { role: "user", content: `Topic: ${topic}\n\nKnowledge base context:\n${context ?? "(none)"}` },
 *     ],
 *   });
 *   // ...map res.content into AnswerSection[] and return an AssistantAnswer
 * }
 */
