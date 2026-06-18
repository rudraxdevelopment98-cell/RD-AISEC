/**
 * AI adapter for the security assistant.
 *
 * Right now this returns a structured MOCK response so the whole product works
 * end-to-end without any API key. The shape of `AssistantAnswer` is what the UI
 * renders, so swapping in a real model is a one-function change in
 * `generateAnswer` — see `generateWithClaude` below for the ready-to-enable
 * Claude integration.
 */

export type AnswerSection = {
  heading: string;
  body: string;
  /** Optional command / code snippets relevant to this section. */
  snippets?: string[];
};

export type AssistantAnswer = {
  topic: string;
  summary: string;
  sections: AnswerSection[];
  /** Suggested tools from our catalog (matched by name) related to this topic. */
  relatedTools: string[];
  disclaimer: string;
};

const DISCLAIMER =
  "For authorized security testing and education only. Only test systems you own or have explicit written permission to assess.";

/**
 * The fixed structure every answer follows: learn it, attack it (to understand
 * the risk), defend it, find the bug, fix the bug.
 */
function buildSections(topic: string): AnswerSection[] {
  return [
    {
      heading: "How it works",
      body: `A clear mental model of "${topic}": what the component is, where it sits in a system, and the trust boundaries around it. Understanding the normal, intended behavior first is what lets you reason about how it breaks.`,
    },
    {
      heading: "How to do it (recon & testing)",
      body: `The practical, hands-on workflow for assessing "${topic}" in an authorized engagement: enumerate the surface, map inputs and outputs, and probe behavior methodically. Take notes and keep scope tight.`,
      snippets: [
        "# Map the surface (example)",
        "nmap -sV -p- target.example.com",
        "# Inspect HTTP behavior",
        "curl -i https://target.example.com/",
      ],
    },
    {
      heading: "How it gets exploited",
      body: `The common failure modes behind "${topic}" and why they happen — missing validation, weak defaults, trust placed in attacker-controlled data. Knowing the exploit path is what makes a fix meaningful rather than cosmetic.`,
    },
    {
      heading: "How to protect & defend",
      body: `Concrete, layered mitigations for "${topic}": validate at boundaries, apply least privilege, use safe defaults, and add detection so abuse is visible. Defense in depth means one missed control is not game over.`,
    },
    {
      heading: "How to find the bug",
      body: `Where to look in code and configuration for "${topic}" issues: dangerous sinks, unsanitized inputs, and risky configuration. Pair manual review with automated scanners to get both depth and coverage.`,
    },
    {
      heading: "How to fix it",
      body: `Remediation guidance for "${topic}": the minimal correct change, how to verify the fix actually closes the hole, and how to prevent regressions with tests and CI checks.`,
    },
  ];
}

export async function generateAnswer(topic: string): Promise<AssistantAnswer> {
  const clean = topic.trim() || "the requested security topic";

  // If a real key is configured, you can flip this to use Claude.
  // if (process.env.ANTHROPIC_API_KEY) return generateWithClaude(clean);

  return {
    topic: clean,
    summary: `Here is a structured walkthrough of "${clean}" — how it works, how it's tested and exploited, and most importantly how to protect, find, and fix it. (This is a generated demo response; connect an AI model to get tailored, in-depth answers.)`,
    sections: buildSections(clean),
    relatedTools: [],
    disclaimer: DISCLAIMER,
  };
}

/**
 * Real Claude integration — enable by:
 *   1) npm install @anthropic-ai/sdk
 *   2) set ANTHROPIC_API_KEY in .env.local
 *   3) uncomment the early return in generateAnswer above.
 *
 * Kept as a reference so the mock can be replaced without re-deriving the call.
 *
 * import Anthropic from "@anthropic-ai/sdk";
 *
 * async function generateWithClaude(topic: string): Promise<AssistantAnswer> {
 *   const client = new Anthropic(); // reads ANTHROPIC_API_KEY
 *   const schema = {
 *     type: "object",
 *     additionalProperties: false,
 *     properties: {
 *       topic: { type: "string" },
 *       summary: { type: "string" },
 *       sections: {
 *         type: "array",
 *         items: {
 *           type: "object",
 *           additionalProperties: false,
 *           properties: {
 *             heading: { type: "string" },
 *             body: { type: "string" },
 *             snippets: { type: "array", items: { type: "string" } },
 *           },
 *           required: ["heading", "body"],
 *         },
 *       },
 *       relatedTools: { type: "array", items: { type: "string" } },
 *     },
 *     required: ["topic", "summary", "sections", "relatedTools"],
 *   };
 *
 *   const res = await client.messages.create({
 *     model: "claude-opus-4-8",
 *     max_tokens: 16000,
 *     thinking: { type: "adaptive" },
 *     system:
 *       "You are a defensive-security tutor for AUTHORIZED testing and education. " +
 *       "For any topic, explain how it works, how it is tested/exploited, and " +
 *       "above all how to protect, find, and fix it. Refuse to help with " +
 *       "clearly malicious, unauthorized, or destructive requests.",
 *     output_config: { format: { type: "json_schema", schema } },
 *     messages: [{ role: "user", content: `Topic: ${topic}` }],
 *   });
 *   const text = res.content.find((b) => b.type === "text");
 *   const parsed = JSON.parse(text ? (text as { text: string }).text : "{}");
 *   return { ...parsed, disclaimer: DISCLAIMER };
 * }
 */
