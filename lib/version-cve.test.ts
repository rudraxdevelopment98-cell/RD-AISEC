// Run: npx tsx lib/version-cve.test.ts
import { extractVersion, parseConstraints, versionAffected, cmpVersions } from "./version-cve";

let pass = 0, fail = 0;
function ok(c: boolean, msg: string) { if (c) pass++; else { fail++; console.error(`✗ ${msg}`); } }

// Banner versions (no URL) are still picked.
ok(extractVersion("Server: Apache/2.4.41 (Ubuntu)") === "2.4.41", "banner version extracted");
ok(extractVersion("Detected nginx 1.18.0") === "1.18.0", "spaced version extracted");

// Regression: a version inside a URL must NOT be taken as the detected version.
ok(
  extractVersion("Outdated jQuery. See https://cdn.example.com/libs/9.9.9/jquery.js") === null,
  "URL-embedded version ignored (no false detected version)",
);
// The real banner wins even when a URL with a version is also present.
ok(
  extractVersion("Apache/2.4.41 — advisory https://site/docs/2.4.55/notes") === "2.4.41",
  "real banner preferred over URL version",
);

// The false-negative this prevents: a URL version outside the affected range
// would have flipped the finding to "patched" and dropped it.
{
  const text = "CVE in libfoo, fixed in 1.2.3. Ref: https://x/assets/9.9.9/foo.js";
  const detected = extractVersion(text);
  const constraints = parseConstraints(text);
  // detected is null (URL ignored) → we don't wrongly conclude "patched".
  ok(detected === null, "no bogus detected version from the URL");
  ok(constraints.length > 0, "still parses the 'fixed in 1.2.3' constraint");
}

// Comparator sanity.
ok(cmpVersions("2.4.41", "2.4.55") === -1, "cmp less");
ok(versionAffected("2.4.41", parseConstraints("fixed in 2.4.55")) === true, "older version is affected");
ok(versionAffected("2.4.55", parseConstraints("fixed in 2.4.55")) === false, "fixed version not affected");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
