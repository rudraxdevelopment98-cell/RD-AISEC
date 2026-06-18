/**
 * Portal model: the three pillars and their guided workflows.
 *
 * Each pillar is a stage-by-stage playbook. Today the stages are "guided"
 * (checklist + tools + copyable commands). The shape intentionally leaves room
 * for live execution later — a stage can gain a `runner` without changing the UI.
 */

export type Stage = {
  name: string;
  summary: string;
  /** Things to accomplish in this stage. */
  checklist: string[];
  /** Tool names (match data/tools.ts where possible). */
  tools: string[];
  /** Copyable example commands for an authorized engagement. */
  commands: string[];
};

export type Pillar = {
  slug: string;
  title: string;
  icon: string; // key in components/icons.tsx
  tagline: string;
  description: string;
  accent: string; // tailwind color hue for theming
  stages: Stage[];
};

export const PILLARS: Pillar[] = [
  {
    slug: "pentest",
    title: "Penetration Testing",
    icon: "target",
    tagline: "Recon → exploit → report, the whole kill chain.",
    description:
      "A structured offensive workflow for authorized engagements: map the target, find weaknesses, prove impact safely, and write it up.",
    accent: "emerald",
    stages: [
      {
        name: "Reconnaissance",
        summary: "Discover the target's footprint without touching it aggressively.",
        checklist: [
          "Confirm scope & authorization in writing",
          "Enumerate domains, subdomains, and IP ranges",
          "Collect OSINT (emails, tech stack, leaks)",
        ],
        tools: ["Nmap", "Nuclei"],
        commands: [
          "subfinder -d target.example.com -silent",
          "nmap -sn 10.0.0.0/24   # host discovery",
        ],
      },
      {
        name: "Scanning & Enumeration",
        summary: "Map live services, versions, and exposed surface.",
        checklist: [
          "Port + service/version scan",
          "Enumerate web apps, shares, and endpoints",
          "Identify technologies and entry points",
        ],
        tools: ["Nmap", "Nikto", "OWASP ZAP"],
        commands: [
          "nmap -sV -sC -p- target.example.com",
          "nikto -h https://target.example.com",
        ],
      },
      {
        name: "Vulnerability Analysis",
        summary: "Turn findings into prioritized, validated weaknesses.",
        checklist: [
          "Run template/CVE scanners",
          "Manually verify to remove false positives",
          "Rank by exploitability and impact",
        ],
        tools: ["Nuclei", "Nessus", "Semgrep"],
        commands: [
          "nuclei -u https://target.example.com -severity high,critical",
        ],
      },
      {
        name: "Exploitation",
        summary: "Safely prove impact within scope — no destruction.",
        checklist: [
          "Use the least-invasive proof of concept",
          "Capture evidence (requests, screenshots)",
          "Avoid data loss / denial of service",
        ],
        tools: ["Metasploit", "sqlmap", "Burp Suite"],
        commands: [
          "sqlmap -u 'https://target.example.com/item?id=1' --batch --risk=1 --level=1",
        ],
      },
      {
        name: "Post-Exploitation",
        summary: "Assess what an attacker could reach next.",
        checklist: [
          "Document access gained and privilege level",
          "Map lateral-movement potential",
          "Clean up artifacts you created",
        ],
        tools: ["Metasploit"],
        commands: [],
      },
      {
        name: "Reporting",
        summary: "Communicate risk and how to fix it.",
        checklist: [
          "Executive summary + risk ratings",
          "Reproducible steps per finding",
          "Clear, prioritized remediation",
        ],
        tools: [],
        commands: [],
      },
    ],
  },
  {
    slug: "forensics",
    title: "Digital Forensics",
    icon: "fingerprint",
    tagline: "Acquire, analyze, and tell the story of the evidence.",
    description:
      "An investigative workflow that preserves integrity end to end: acquire evidence soundly, analyze disk and memory, build a timeline, and report with chain of custody intact.",
    accent: "sky",
    stages: [
      {
        name: "Evidence Acquisition",
        summary: "Capture data without altering the original.",
        checklist: [
          "Record chain of custody from first contact",
          "Create a verified forensic image (write-blocked)",
          "Hash the image and the source (match required)",
        ],
        tools: [],
        commands: [
          "dd if=/dev/sdb of=evidence.img bs=4M conv=noerror,sync status=progress",
          "sha256sum evidence.img  # record alongside source hash",
        ],
      },
      {
        name: "Disk Analysis",
        summary: "Recover files, deleted data, and filesystem artifacts.",
        checklist: [
          "Mount the image read-only",
          "Carve deleted files",
          "Examine filesystem metadata and logs",
        ],
        tools: [],
        commands: [
          "mmls evidence.img            # partition layout",
          "fls -r -o 2048 evidence.img  # file listing (Sleuth Kit)",
        ],
      },
      {
        name: "Memory Analysis",
        summary: "Inspect volatile state for processes, network, and malware.",
        checklist: [
          "Identify the OS profile",
          "List processes, connections, and injected code",
          "Extract suspicious artifacts",
        ],
        tools: [],
        commands: [
          "volatility3 -f memory.raw windows.pslist",
          "volatility3 -f memory.raw windows.netscan",
        ],
      },
      {
        name: "Timeline & Artifacts",
        summary: "Reconstruct what happened, in order.",
        checklist: [
          "Build a super-timeline of events",
          "Correlate browser, registry, and log artifacts",
          "Flag indicators of compromise",
        ],
        tools: [],
        commands: ["log2timeline.py timeline.plaso evidence.img"],
      },
      {
        name: "Reporting & Chain of Custody",
        summary: "Produce a defensible, reproducible record.",
        checklist: [
          "Document every handling step + hashes",
          "Present findings with supporting evidence",
          "Keep the report court-ready and objective",
        ],
        tools: [],
        commands: [],
      },
    ],
  },
  {
    slug: "consulting",
    title: "Security Consulting",
    icon: "briefcase",
    tagline: "Engagements, risk, and client-ready outcomes.",
    description:
      "The business wrapper around testing: define and authorize scope, assess risk against standards, track findings, and deliver remediation the client can act on.",
    accent: "amber",
    stages: [
      {
        name: "Scoping & Authorization",
        summary: "Define what's in scope — and get written permission.",
        checklist: [
          "Agree targets, windows, and rules of engagement",
          "Obtain signed authorization (mandatory)",
          "Set emergency contacts and stop conditions",
        ],
        tools: [],
        commands: [],
      },
      {
        name: "Risk Assessment",
        summary: "Measure exposure against a recognized framework.",
        checklist: [
          "Map assets and data sensitivity",
          "Assess against OWASP / NIST / CIS as relevant",
          "Identify and prioritize risk areas",
        ],
        tools: [],
        commands: [],
      },
      {
        name: "Testing & Findings",
        summary: "Execute the assessment and log findings consistently.",
        checklist: [
          "Run the relevant pentest/forensics workflow",
          "Record each finding with severity + evidence",
          "Track status (open / fixed / accepted)",
        ],
        tools: ["Burp Suite", "Nuclei"],
        commands: [],
      },
      {
        name: "Remediation Guidance",
        summary: "Give the client a clear path to fix and verify.",
        checklist: [
          "Concrete fix per finding",
          "Prioritize by risk and effort",
          "Define retest criteria",
        ],
        tools: [],
        commands: [],
      },
      {
        name: "Client Report",
        summary: "Deliver an outcome leadership and engineers both use.",
        checklist: [
          "Executive summary for leadership",
          "Technical detail for engineers",
          "Roadmap and retest plan",
        ],
        tools: [],
        commands: [],
      },
    ],
  },
];

export function getPillar(slug: string): Pillar | undefined {
  return PILLARS.find((p) => p.slug === slug);
}
