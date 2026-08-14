// Tests the iterative-recon extraction core. Run with `npm test` (tsx).

import assert from "node:assert";
import { extractUrls, extractPaths, extractEndpoints, parameterizedUrls, extractParams, jsUrls } from "./recon-extract";

let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log("  ok -", name);
}

t("extractUrls: keeps request URLs, drops assets + fragments", () => {
  const text = `visit https://t.example/api/orders/1?id=2 and https://t.example/logo.png also https://t.example/app#top`;
  const urls = extractUrls(text);
  assert.ok(urls.includes("https://t.example/api/orders/1?id=2"));
  assert.ok(urls.includes("https://t.example/app"), "fragment stripped");
  assert.ok(!urls.some((u) => u.includes("logo.png")), "asset dropped");
});

t("extractPaths: mines root-relative endpoints from JS, drops assets/protocol-relative", () => {
  const js = `fetch("/api/v1/users/42"); const x="/static/app.css"; go("//cdn.example/x"); r("/admin/panel")`;
  const paths = extractPaths(js);
  assert.ok(paths.includes("/api/v1/users/42"));
  assert.ok(paths.includes("/admin/panel"));
  assert.ok(!paths.includes("/static/app.css"), "css dropped");
  assert.ok(!paths.some((p) => p.startsWith("//")), "protocol-relative dropped");
});

t("extractEndpoints: resolves relative paths against discovered host", () => {
  const text = `base https://t.example/home  js: fetch("/api/orders/7")`;
  const eps = extractEndpoints(text);
  assert.ok(eps.includes("https://t.example/api/orders/7"), "relative path resolved to full URL");
  assert.ok(eps.includes("https://t.example/home"));
});

t("extractEndpoints: uses baseUrl when no absolute URL present", () => {
  const eps = extractEndpoints(`fetch("/api/me")`, "https://only.example");
  assert.ok(eps.includes("https://only.example/api/me"));
});

t("parameterizedUrls: only URLs with a query param", () => {
  const p = parameterizedUrls([
    "https://t.example/api/orders/1?id=2",
    "https://t.example/api/orders/1",
    "https://t.example/search?q=x&page=2",
  ]);
  assert.strictEqual(p.length, 2);
  assert.ok(p.every((u) => u.includes("?")));
});

t("extractParams: distinct param names", () => {
  const names = extractParams([
    "https://t.example/s?q=x&page=2",
    "https://t.example/u?id=9&q=y",
  ]);
  assert.deepStrictEqual(names.sort(), ["id", "page", "q"]);
});

t("extractEndpoints dedupes", () => {
  const eps = extractEndpoints(`https://t.example/a https://t.example/a fetch("/a")`);
  assert.strictEqual(eps.filter((e) => e === "https://t.example/a").length, 1);
});

t("jsUrls: picks .js/.mjs bundles, ignores others", () => {
  const js = jsUrls([
    "https://t.example/static/app.js",
    "https://t.example/main.mjs?v=3",
    "https://t.example/api/orders/1",
    "https://t.example/style.css",
  ]);
  assert.strictEqual(js.length, 2);
  assert.ok(js.every((u) => /\.m?js/i.test(u)));
});

console.log(`\nrecon-extract: ${passed} checks passed`);
