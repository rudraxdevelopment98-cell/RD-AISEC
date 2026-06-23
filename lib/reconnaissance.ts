import "server-only";

import { execSync } from "child_process";
import { promises as dns } from "dns";
import { createConnection } from "net";

export type ReconResult = {
  scanType: "dns" | "port" | "web" | "posture" | "osint";
  status: "success" | "error";
  data: Record<string, unknown>;
  error?: string;
  durationMs: number;
};

/**
 * Extract domain from URL or return as-is if it's a domain.
 */
function extractDomain(target: string): string {
  try {
    const url = new URL(target);
    return url.hostname;
  } catch {
    // assume it's already a domain or IP
    return target.split("/")[0];
  }
}

/**
 * Subdomain enumeration via DNS lookups + common subdomains.
 * Real DNS queries, no external APIs.
 */
export async function dnsEnumeration(target: string): Promise<ReconResult> {
  const start = Date.now();
  const domain = extractDomain(target);
  const found: { subdomain: string; ip?: string }[] = [];

  // Common subdomains to check
  const commonSubs = [
    "www",
    "mail",
    "ftp",
    "localhost",
    "webmail",
    "smtp",
    "pop",
    "ns1",
    "ns2",
    "cpanel",
    "whm",
    "autodiscover",
    "autoconfig",
    "m",
    "mobile",
    "api",
    "api-staging",
    "staging",
    "dev",
    "development",
    "test",
    "admin",
    "app",
    "dashboard",
    "cdn",
    "static",
    "assets",
    "images",
    "blog",
    "shop",
    "store",
    "forum",
    "wiki",
    "docs",
    "support",
  ];

  for (const sub of commonSubs) {
    const fullDomain = `${sub}.${domain}`;
    try {
      const addresses = await dns.resolve4(fullDomain);
      if (addresses.length > 0) {
        found.push({
          subdomain: fullDomain,
          ip: addresses[0],
        });
      }
    } catch {
      // Domain not found, continue
    }
  }

  // Also get MX records (mail servers)
  let mxRecords: string[] = [];
  try {
    const mx = await dns.resolveMx(domain);
    mxRecords = mx.map((m) => m.exchange);
  } catch {
    // No MX records
  }

  return {
    scanType: "dns",
    status: "success",
    data: {
      domain,
      discoveredSubdomains: found,
      mailServers: mxRecords,
      count: found.length,
    },
    durationMs: Date.now() - start,
  };
}

/**
 * Port discovery: check common ports for open connections.
 * Real TCP connections using Node's net module.
 */
export async function portDiscovery(target: string): Promise<ReconResult> {
  const start = Date.now();
  const domain = extractDomain(target);
  const openPorts: number[] = [];

  // Common ports to scan
  const portsToCheck = [
    21, 22, 23, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3306, 3389, 5432,
    5984, 6379, 8080, 8443, 8888, 9000, 9200, 27017, 50070,
  ];

  // Check ports in parallel with a timeout
  const checkPort = (port: number, host: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const socket = createConnection(
        { host, port, timeout: 2000 },
        () => {
          socket.destroy();
          resolve(true);
        },
      );

      socket.on("error", () => resolve(false));
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });

      setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 2500);
    });
  };

  // Check ports with concurrency limit
  const batchSize = 5;
  for (let i = 0; i < portsToCheck.length; i += batchSize) {
    const batch = portsToCheck.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((p) => checkPort(p, domain)));
    batch.forEach((p, idx) => {
      if (results[idx]) openPorts.push(p);
    });
  }

  return {
    scanType: "port",
    status: "success",
    data: {
      target: domain,
      openPorts,
      scannedPorts: portsToCheck.length,
      count: openPorts.length,
    },
    durationMs: Date.now() - start,
  };
}

/**
 * Web technology detection via HTTP headers and meta tags.
 * Real HTTP requests to identify the tech stack.
 */
export async function webTechDetection(target: string): Promise<ReconResult> {
  const start = Date.now();
  const url = normalizeUrl(target);
  const techs: string[] = [];
  const headers: Record<string, string> = {};

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "RD-AISEC-Recon/1.0 (+authorized security assessment)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });

    // Parse headers
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Detect tech stack from headers
    if (headers["server"]) {
      techs.push(headers["server"]);
    }
    if (headers["x-powered-by"]) {
      techs.push(headers["x-powered-by"]);
    }
    if (headers["x-aspnet-version"]) {
      techs.push("ASP.NET " + headers["x-aspnet-version"]);
    }
    if (headers["x-runtime"]) {
      techs.push(headers["x-runtime"]);
    }

    const body = await res.text();

    // Detect from HTML meta/script tags
    if (body.includes("Next.js")) techs.push("Next.js");
    if (body.includes("React")) techs.push("React");
    if (body.includes("Vue")) techs.push("Vue.js");
    if (body.includes("Angular")) techs.push("Angular");
    if (body.includes("django")) techs.push("Django");
    if (body.includes("Laravel")) techs.push("Laravel");
    if (body.includes("Rails")) techs.push("Ruby on Rails");
    if (body.includes("WordPress")) techs.push("WordPress");
    if (body.includes("Drupal")) techs.push("Drupal");

    return {
      scanType: "web",
      status: "success",
      data: {
        url,
        statusCode: res.status,
        detectedTechs: [...new Set(techs)],
        headers: Object.fromEntries(
          Object.entries(headers).filter(([k]) => !k.includes("cookie")),
        ),
      },
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      scanType: "web",
      status: "error",
      data: { url },
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs: Date.now() - start,
    };
  }
}

/**
 * OSINT gathering via public APIs (DNS, WHOIS, SSL cert data via curl).
 * Requires curl; gracefully degrades if unavailable.
 */
export async function osintGathering(target: string): Promise<ReconResult> {
  const start = Date.now();
  const domain = extractDomain(target);
  const osintData: Record<string, unknown> = {};

  // Try crt.sh (SSL certificate transparency) via curl
  try {
    const curlCmd = `curl -s "https://crt.sh/?q=${domain}&output=json" | jq length 2>/dev/null || echo "0"`;
    const result = execSync(curlCmd).toString().trim();
    osintData.certCount = parseInt(result) || 0;
  } catch {
    osintData.certCount = "unavailable";
  }

  // Try DNS enumeration for SPF/DKIM/DMARC
  try {
    const txtRecords = await dns.resolveTxt(domain);
    osintData.txtRecords = txtRecords.map((r) => r.join(""));
  } catch {
    osintData.txtRecords = [];
  }

  return {
    scanType: "osint",
    status: "success",
    data: {
      domain,
      ...osintData,
    },
    durationMs: Date.now() - start,
  };
}

/**
 * Normalize URL to absolute form.
 */
function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!/^https?:\/\//i.test(t)) return `https://${t}`;
  return t;
}

/**
 * Run all reconnaissance scans in sequence/parallel.
 * Returns array of all scan results.
 */
export async function runReconnaissancePipeline(
  target: string,
): Promise<ReconResult[]> {
  // Run scans sequentially for stability; can parallelize later.
  const results: ReconResult[] = [];

  try {
    results.push(await dnsEnumeration(target));
  } catch (e) {
    results.push({
      scanType: "dns",
      status: "error",
      data: { target },
      error: e instanceof Error ? e.message : "Unknown error",
      durationMs: 0,
    });
  }

  try {
    results.push(await portDiscovery(target));
  } catch (e) {
    results.push({
      scanType: "port",
      status: "error",
      data: { target },
      error: e instanceof Error ? e.message : "Unknown error",
      durationMs: 0,
    });
  }

  try {
    results.push(await webTechDetection(target));
  } catch (e) {
    results.push({
      scanType: "web",
      status: "error",
      data: { target },
      error: e instanceof Error ? e.message : "Unknown error",
      durationMs: 0,
    });
  }

  try {
    results.push(await osintGathering(target));
  } catch (e) {
    results.push({
      scanType: "osint",
      status: "error",
      data: { target },
      error: e instanceof Error ? e.message : "Unknown error",
      durationMs: 0,
    });
  }

  return results;
}
