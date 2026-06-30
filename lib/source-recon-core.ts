// White-box source-aware recon — pure, no DB/IO. The pre-reconnaissance brain of
// a Shannon-style white-box pentester: given a target's source files, map its
// frameworks, endpoints/attack surface, and risky sinks, then emit ranked
// vulnerability HYPOTHESES. Hypotheses are exactly that — "reported" confidence
// until the exploit engine validates them (proof-by-exploitation). Unit-testable.

export type SourceSeverity = "low" | "medium" | "high" | "critical";
const SEV_RANK: Record<SourceSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export type VulnClass =
  | "injection"
  | "rce"
  | "ssrf"
  | "deserialization"
  | "path-traversal"
  | "xss"
  | "crypto"
  | "secrets"
  | "auth";

export type SourceFile = { path: string; content: string };
export type Framework = { name: string; lang: string; evidence: string };
export type Endpoint = { method: string; route: string; file: string; line: number };
export type Hypothesis = {
  vulnClass: VulnClass;
  severity: SourceSeverity;
  file: string;
  line: number;
  evidence: string;
  why: string;
  validateWith: string; // how the exploit engine should try to PROVE it
};
export type SourceReconResult = {
  frameworks: Framework[];
  endpoints: Endpoint[];
  hypotheses: Hypothesis[];
  stats: { files: number; loc: number };
};

// Tokens that indicate a value came from user input (untrusted) on the same line.
const TAINT = /\b(req|request|params|query|body|input|args|form|payload|userInput|getParameter|@RequestParam|@PathVariable|env\[|process\.argv)\b/i;

// --- risky sinks: (regex, class, severity, why, how-to-validate) -------------
const SINKS: { re: RegExp; needTaint: boolean; vulnClass: VulnClass; severity: SourceSeverity; why: string; validateWith: string }[] = [
  { re: /(os\.system|subprocess\.(?:call|run|Popen|check_output)|child_process\.(?:exec|execSync|spawn)|Runtime\.getRuntime\(\)\.exec|\beval\(|\bexec\()/, needTaint: true, vulnClass: "rce", severity: "critical", why: "user input flows into command/code execution", validateWith: "commix / manual payload, or msf check; confirm with `id` output" },
  { re: /(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,80}(\"\s*\+|\'\s*\+|\$\{|%s|f\"|f\'|\+\s*req|format\()/i, needTaint: false, vulnClass: "injection", severity: "high", why: "SQL string is concatenated/interpolated with a variable (not parameterized)", validateWith: "sqlmap on the parameter; confirm an injectable point" },
  { re: /(pickle\.loads|yaml\.load\((?![^)]*Loader)|cPickle\.loads|Marshal\.load|ObjectInputStream|unserialize\()/, needTaint: false, vulnClass: "deserialization", severity: "high", why: "untrusted data is deserialized (gadget-chain / RCE risk)", validateWith: "craft a serialized payload PoC against the endpoint" },
  { re: /(requests\.(?:get|post|put)|urllib\.request\.urlopen|axios\.(?:get|post)|fetch\(|http\.get|HttpClient)/, needTaint: true, vulnClass: "ssrf", severity: "high", why: "a server-side request uses a user-controlled URL/host", validateWith: "point it at a collaborator/internal host; confirm the server reaches it" },
  { re: /(open\(|readFile|fs\.read|File\(|sendFile|render_template\(|include\()/, needTaint: true, vulnClass: "path-traversal", severity: "medium", why: "a file path is built from user input without normalization", validateWith: "../ traversal to read a known file (e.g. /etc/passwd)" },
  { re: /(innerHTML|dangerouslySetInnerHTML|document\.write|render_template_string|\|\s*safe\b|v-html|Markup\()/, needTaint: false, vulnClass: "xss", severity: "medium", why: "data is written to the DOM/template without escaping", validateWith: "dalfox / a reflected payload that executes" },
  { re: /\b(MD5|SHA1|DES|RC4)\b|Cipher\.getInstance\(\"?(DES|AES\/ECB)|ECB\b|Math\.random\(\)/, needTaint: false, vulnClass: "crypto", severity: "medium", why: "weak/broken cryptographic primitive or non-CSPRNG", validateWith: "confirm the algorithm in use; demonstrate predictability" },
  { re: /(verify\s*=\s*False|rejectUnauthorized:\s*false|@csrf_exempt|csrf.{0,12}(disable|false)|ALLOW_ALL|AntPathRequestMatcher\(\"\/\*\*\")/, needTaint: false, vulnClass: "auth", severity: "medium", why: "an auth/transport/CSRF protection is disabled", validateWith: "test the unprotected route / MITM the unverified TLS" },
  { re: /(api[_-]?key|secret|password|passwd|token|aws_access_key_id|private_key)\s*[:=]\s*["'][A-Za-z0-9_\-\/+]{12,}["']/i, needTaint: false, vulnClass: "secrets", severity: "high", why: "a credential/secret appears hard-coded in source", validateWith: "verify the secret is live, then rotate it" },
];

// --- endpoint/route patterns (capture group 1 = method-ish, 2 = route) -------
const ROUTE_PATTERNS: { re: RegExp; methodFrom: "g1" | "fixed"; fixed?: string }[] = [
  { re: /\b(?:app|router|api|server)\.(get|post|put|delete|patch|all)\(\s*[`'"]([^`'"]+)/gi, methodFrom: "g1" },
  { re: /@(?:app|router|blueprint|bp)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)/gi, methodFrom: "g1" },
  { re: /@(?:app|router|blueprint|bp)\.route\(\s*['"]([^'"]+)/gi, methodFrom: "fixed", fixed: "ANY" },
  { re: /@(Get|Post|Put|Delete|Patch|Request)Mapping\(\s*(?:value\s*=\s*)?[`'"]([^`'"]+)/g, methodFrom: "g1" },
  { re: /Route::(get|post|put|delete|patch)\(\s*['"]([^'"]+)/gi, methodFrom: "g1" },
  { re: /\bpath\(\s*['"]([^'"]*)['"]/g, methodFrom: "fixed", fixed: "DJANGO" },
];

function detectFrameworks(files: SourceFile[]): Framework[] {
  const out: Framework[] = [];
  const seen = new Set<string>();
  const add = (name: string, lang: string, evidence: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ name, lang, evidence });
  };
  for (const f of files) {
    const p = f.path.toLowerCase();
    const c = f.content;
    if (p.endsWith("package.json")) {
      if (/"express"/.test(c)) add("Express", "node", "package.json");
      if (/"next"/.test(c)) add("Next.js", "node", "package.json");
      if (/"fastify"/.test(c)) add("Fastify", "node", "package.json");
      if (/"@nestjs\/core"/.test(c)) add("NestJS", "node", "package.json");
      if (/"koa"/.test(c)) add("Koa", "node", "package.json");
    }
    if (p.endsWith("requirements.txt") || p.endsWith(".py")) {
      if (/\b(flask)\b/i.test(c)) add("Flask", "python", p);
      if (/\bdjango\b/i.test(c)) add("Django", "python", p);
      if (/\bfastapi\b/i.test(c)) add("FastAPI", "python", p);
    }
    if (p.endsWith("gemfile") || /rails/i.test(c)) {
      if (/rails/i.test(c)) add("Rails", "ruby", p);
    }
    if (p.endsWith("pom.xml") || p.endsWith("build.gradle")) {
      if (/spring/i.test(c)) add("Spring", "java", p);
    }
    if (p.endsWith("composer.json")) {
      if (/laravel/i.test(c)) add("Laravel", "php", "composer.json");
      if (/symfony/i.test(c)) add("Symfony", "php", "composer.json");
    }
  }
  return out;
}

function extractEndpoints(file: SourceFile): Endpoint[] {
  const out: Endpoint[] = [];
  // Next.js file-based routes: app/**/route.ts, pages/api/**.
  const m = file.path.match(/(?:^|\/)(?:app|pages)\/(.+?)(?:\/route)?\.(?:t|j)sx?$/);
  if (m && /\/(api|route)/.test(file.path)) {
    const route = "/" + m[1].replace(/\/route$/, "").replace(/index$/, "").replace(/\[(\w+)\]/g, ":$1");
    out.push({ method: "ANY", route: route.replace(/\/$/, "") || "/", file: file.path, line: 1 });
  }
  for (const pat of ROUTE_PATTERNS) {
    const re = new RegExp(pat.re.source, pat.re.flags);
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(file.content)) !== null) {
      const method = pat.methodFrom === "fixed" ? pat.fixed! : (mm[1] || "ANY").toUpperCase();
      const route = pat.methodFrom === "fixed" && pat.fixed === "DJANGO" ? mm[1] : mm[2] ?? mm[1];
      if (!route) continue;
      const line = file.content.slice(0, mm.index).split("\n").length;
      out.push({ method, route, file: file.path, line });
    }
  }
  return out;
}

function scanSinks(file: SourceFile): Hypothesis[] {
  const out: Hypothesis[] = [];
  const lines = file.content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 600) continue; // skip minified/huge lines
    const tainted = TAINT.test(line);
    for (const s of SINKS) {
      if (!s.re.test(line)) continue;
      if (s.needTaint && !tainted) continue;
      out.push({
        vulnClass: s.vulnClass,
        severity: s.severity,
        file: file.path,
        line: i + 1,
        evidence: line.trim().slice(0, 160),
        why: s.why,
        validateWith: s.validateWith,
      });
    }
  }
  return out;
}

const CODE_EXT = /\.(js|jsx|ts|tsx|py|rb|php|java|go|cs|kt|scala)$/i;

/** Analyze a set of source files into frameworks, endpoints, and ranked,
 * de-duplicated vulnerability hypotheses (most severe first). */
export function analyzeSource(files: SourceFile[]): SourceReconResult {
  const frameworks = detectFrameworks(files);
  const endpoints: Endpoint[] = [];
  let hypotheses: Hypothesis[] = [];
  let loc = 0;

  for (const f of files) {
    loc += f.content.split("\n").length;
    const isCode = CODE_EXT.test(f.path);
    if (isCode || /\/(app|pages)\//.test(f.path)) endpoints.push(...extractEndpoints(f));
    if (isCode) hypotheses.push(...scanSinks(f));
  }

  // De-dup identical (class+file+line) hits, then rank by severity.
  const seen = new Set<string>();
  hypotheses = hypotheses
    .filter((h) => {
      const k = `${h.vulnClass}|${h.file}|${h.line}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || a.file.localeCompare(b.file));

  // De-dup endpoints by method+route.
  const eseen = new Set<string>();
  const dedupEndpoints = endpoints.filter((e) => {
    const k = `${e.method}|${e.route}`;
    if (eseen.has(k)) return false;
    eseen.add(k);
    return true;
  });

  return { frameworks, endpoints: dedupEndpoints, hypotheses, stats: { files: files.length, loc } };
}

export function hypothesisCounts(hyps: Hypothesis[]): Record<SourceSeverity, number> {
  const c: Record<SourceSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const h of hyps) c[h.severity] += 1;
  return c;
}
