// Resolve direct-download URLs for the packaged desktop app (runner-gui) from the
// GitHub Releases API, so the portal's download card links straight to the right
// installer instead of bouncing the user to the GitHub release page. Also powers
// the version picker (all published versions) and the in-GUI update check.
//
// Pure classification (classifyAsset) is unit-testable; fetchRunnerGuiReleases does
// the network call and is cached by the API route.

export type AssetPlatform = "windows" | "macos" | "linux";
export type AssetArch = "arm64" | "x64" | "universal";

export type ReleaseAsset = {
  name: string;
  url: string; // direct browser_download_url
  size: number;
  platform: AssetPlatform;
  arch: AssetArch;
  // Short human label for the button, e.g. "Windows installer", "macOS (Apple Silicon)".
  label: string;
  // Sort/pick weight — the recommended asset per platform ranks highest.
  weight: number;
};

export type RunnerGuiRelease = {
  version: string; // tag_name, e.g. "runner-gui-v1.0.3"
  name: string;
  publishedAt: string;
  url: string; // release html_url (fallback link)
  prerelease: boolean;
  assets: ReleaseAsset[];
};

/**
 * Classify a release asset by filename → platform/arch/kind, with a display label
 * and a pick weight (higher = the preferred download for that platform). Returns
 * null for non-installer assets (blockmaps, latest.yml, checksums, source zips).
 */
export function classifyAsset(name: string, url: string, size = 0): ReleaseAsset | null {
  const n = name.toLowerCase();
  // Skip electron-builder side-artifacts and non-installers.
  if (/\.(blockmap|yml|yaml|sha256|sha512|txt)$/.test(n)) return null;
  if (/^(source code)/.test(n)) return null;

  const arch: AssetArch = /arm64|aarch64|apple.?silicon/.test(n)
    ? "arm64"
    : /x64|amd64|x86_64|intel/.test(n)
      ? "x64"
      : "universal";

  // Windows
  if (n.endsWith(".exe")) {
    const isSetup = /setup/.test(n);
    return {
      name, url, size,
      platform: "windows",
      arch,
      label: isSetup ? "Windows installer (.exe)" : "Windows portable (.exe)",
      weight: isSetup ? 100 : 60,
    };
  }
  // macOS
  if (n.endsWith(".dmg")) {
    return {
      name, url, size,
      platform: "macos",
      arch,
      label: `macOS ${arch === "arm64" ? "(Apple Silicon)" : arch === "x64" ? "(Intel)" : ""}`.trim() + " · .dmg",
      weight: arch === "arm64" ? 100 : 90,
    };
  }
  if (n.endsWith("-mac.zip") || (n.endsWith(".zip") && /mac|darwin|osx/.test(n))) {
    return {
      name, url, size,
      platform: "macos",
      arch,
      label: `macOS ${arch === "arm64" ? "(Apple Silicon)" : arch === "x64" ? "(Intel)" : ""}`.trim() + " · .zip",
      weight: arch === "arm64" ? 55 : 50,
    };
  }
  // Linux
  if (n.endsWith(".deb")) {
    return {
      name, url, size,
      platform: "linux",
      arch,
      label: `Linux .deb (${arch === "arm64" ? "arm64" : "amd64"})`,
      weight: arch === "arm64" ? 100 : 95,
    };
  }
  if (n.endsWith(".appimage")) {
    return {
      name, url, size,
      platform: "linux",
      arch,
      label: `Linux AppImage (${arch === "arm64" ? "arm64" : "x64"})`,
      weight: arch === "arm64" ? 80 : 78,
    };
  }
  if (n.endsWith(".rpm")) {
    return {
      name, url, size, platform: "linux", arch,
      label: `Linux .rpm (${arch === "arm64" ? "arm64" : "x86_64"})`,
      weight: 70,
    };
  }
  return null;
}

type RawAsset = { name?: unknown; browser_download_url?: unknown; size?: unknown };
type RawRelease = {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
};

/** Normalize one GitHub API release object into a RunnerGuiRelease. */
export function normalizeRelease(r: RawRelease): RunnerGuiRelease | null {
  const version = String(r.tag_name ?? "");
  if (!version) return null;
  const rawAssets = Array.isArray(r.assets) ? (r.assets as RawAsset[]) : [];
  const assets = rawAssets
    .map((a) => classifyAsset(String(a.name ?? ""), String(a.browser_download_url ?? ""), Number(a.size ?? 0)))
    .filter((a): a is ReleaseAsset => !!a && !!a.url)
    .sort((a, b) => b.weight - a.weight);
  return {
    version,
    name: String(r.name ?? version),
    publishedAt: String(r.published_at ?? ""),
    url: String(r.html_url ?? ""),
    prerelease: !!r.prerelease,
    assets,
  };
}

const REPO = process.env.NEXT_PUBLIC_RUNNER_GUI_REPO || "rudraxdevelopment98-cell/RD-AISEC";
const TAG_PREFIX = "runner-gui-v";

/**
 * Fetch published runner-gui releases from the GitHub API, newest first. Filters to
 * the runner-gui tag prefix and drops drafts / releases with no installers. Returns
 * [] on any error (rate limit / offline) so the caller falls back to the release page.
 */
export async function fetchRunnerGuiReleases(limit = 10): Promise<RunnerGuiRelease[]> {
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers,
      // Cache at the fetch layer; the route also sets s-maxage.
      next: { revalidate: 900 },
    });
    if (!res.ok) return [];
    const raw = (await res.json()) as RawRelease[];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => !r.draft && String(r.tag_name ?? "").startsWith(TAG_PREFIX))
      .map(normalizeRelease)
      .filter((r): r is RunnerGuiRelease => !!r && r.assets.length > 0)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Best download per platform for a release (highest-weight asset each). */
export function bestPerPlatform(release: RunnerGuiRelease): Record<AssetPlatform, ReleaseAsset[]> {
  const out: Record<AssetPlatform, ReleaseAsset[]> = { windows: [], macos: [], linux: [] };
  for (const a of release.assets) out[a.platform].push(a);
  return out;
}

/** Compare two runner-gui version tags. Returns >0 if a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v.replace(TAG_PREFIX, "").replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
