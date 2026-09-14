// Tests the pure endpoint-prioritization scorer (P3). Run with `npm test` (tsx).

import assert from "node:assert";
import { scoreEndpoint, rankEndpoints } from "./endpoint-score";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

t("id-bearing API endpoint scores higher than a plain search", () => {
  const idor = scoreEndpoint("https://api.acme.com/api/orders?id=1001");
  const search = scoreEndpoint("https://acme.com/search?q=shoes");
  assert.ok(idor > search, `idor ${idor} vs search ${search}`);
});

t("SSRF/redirect param scores high", () => {
  const ssrf = scoreEndpoint("https://acme.com/proxy?url=http://x");
  assert.ok(ssrf >= 40, `ssrf ${ssrf}`);
});

t("static asset scores near zero", () => {
  assert.ok(scoreEndpoint("https://acme.com/assets/app.css") < 10);
  assert.ok(scoreEndpoint("https://acme.com/logo.png") < 10);
});

t("numeric path segment (/orders/1001) counts as an object reference", () => {
  const withId = scoreEndpoint("https://api.acme.com/orders/1001");
  const noId = scoreEndpoint("https://api.acme.com/orders");
  assert.ok(withId > noId, `withId ${withId} vs noId ${noId}`);
});

t("rankEndpoints puts the highest-value endpoint first", () => {
  const ranked = rankEndpoints([
    "https://acme.com/style.css",
    "https://acme.com/search?q=x",
    "https://api.acme.com/admin/users?id=5",
  ]);
  assert.ok(ranked[0].includes("/admin/users"));
  assert.ok(ranked[ranked.length - 1].endsWith(".css"));
});

console.log(`\n${passed} passed`);
