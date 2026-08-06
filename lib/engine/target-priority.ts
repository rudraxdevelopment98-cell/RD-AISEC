// Target prioritization — spend the scan budget on promising hosts first.
//
// The pipeline caps how many hosts it scans (e.g. slice(0,15)); today it takes
// them in scope order, so a boring apex can crowd out a juicy `admin.` or `api.`
// subdomain. This scores each host so the caps keep the *most promising* ones.
// Pure (no IO), unit-tested.

// Leftmost-label / substring keywords that mark a host as high-value (admin
// panels, APIs, non-prod, internal infra, auth/payment, dev tooling, data stores).
const HIGH_VALUE =
  /(^|[.\-_])(admin|adm|manage|console|dashboard|api|graphql|dev|devel|test|stage|staging|uat|qa|preprod|internal|intranet|corp|vpn|git|gitlab|jenkins|\bci\b|jira|confluence|grafana|kibana|phpmyadmin|pma|adminer|db|database|sql|mysql|postgres|mongo|redis|backup|bak|old|legacy|beta|portal|auth|sso|login|idp|oauth|payment|pay|billing|invoice|secure|vault|s3|storage|minio|mail|smtp|imap|owa|exchange|webmail)([.\-_]|$)/i;
// Medium-value: real apps/services worth a look, but not obviously sensitive.
const MED_VALUE =
  /(^|[.\-_])(app|web|shop|store|blog|account|user|my|dashboard2|support|help|docs|status|monitor|metrics|search|upload|files|share|cdn)([.\-_]|$)/i;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Optional live signals from recon (open ports, confirmed web) that sharpen the score. */
export type TargetSignal = { openPorts?: number; hasWeb?: boolean };

/**
 * Score a host 0..~100 for how worth-scanning it is. Name heuristics dominate
 * when we have no live signal; open ports / confirmed web add on top.
 */
export function scoreTargetHost(host: string, sig?: TargetSignal): number {
  const h = (host || "").toLowerCase().trim();
  if (!h) return 0;
  let s = 10; // base

  if (HIGH_VALUE.test(h)) s += 45;
  else if (MED_VALUE.test(h)) s += 18;

  // A specific subdomain is usually more interesting than a bare apex/IP.
  const depth = h.split(".").length;
  if (!IPV4.test(h) && depth >= 3) s += 6;

  if (sig?.openPorts) s += Math.min(24, sig.openPorts * 3);
  if (sig?.hasWeb) s += 8;

  return s;
}

/**
 * Order hosts most-promising first. `signalFor` optionally supplies live recon
 * signals per host. Stable within equal scores (keeps original order).
 */
export function prioritizeHosts(
  hosts: string[],
  signalFor?: (host: string) => TargetSignal | undefined,
): string[] {
  return hosts
    .map((h, i) => ({ h, i, score: scoreTargetHost(h, signalFor?.(h)) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.h);
}
