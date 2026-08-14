import { Icon } from "@/components/icons";
import { Hint } from "@/components/hint";
import {
  fetchRunnerGuiReleases,
  bestPerPlatform,
  type AssetPlatform,
  type ReleaseAsset,
  type RunnerGuiRelease,
} from "@/lib/runner-gui-releases";

// Fallback release page (used only if the GitHub API is unreachable / rate-limited).
const RELEASES_URL =
  process.env.NEXT_PUBLIC_RUNNER_GUI_RELEASES ||
  "https://github.com/rudraxdevelopment98-cell/RD-AISEC/releases/latest";

const PLATFORM_META: Record<AssetPlatform, { label: string; icon: string }> = {
  windows: { label: "Windows", icon: "globe" },
  macos: { label: "macOS", icon: "bot" },
  linux: { label: "Linux", icon: "server" },
};

function fmtSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}
function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function shortVer(tag: string): string {
  return tag.replace(/^runner-gui-/, "");
}

// The recommended (highest-weight) download per platform, as a compact button.
function RecommendedButton({ platform, asset }: { platform: AssetPlatform; asset: ReleaseAsset }) {
  const m = PLATFORM_META[platform];
  return (
    <a
      href={asset.url}
      className="flex items-center gap-3 rounded-lg border border-surface-border bg-surface px-4 py-3 transition hover:border-brand"
    >
      <Icon name={m.icon} className="h-5 w-5 shrink-0 text-brand" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{m.label}</span>
        <span className="block truncate text-xs text-gray-500">{asset.label.replace(/^.*·\s*/, "")}{asset.size ? ` · ${fmtSize(asset.size)}` : ""}</span>
      </span>
    </a>
  );
}

// Static fallback tiles → the GitHub releases page (only when the API failed).
function FallbackTiles() {
  const tiles: { os: string; icon: string }[] = [
    { os: "Windows", icon: "globe" },
    { os: "macOS", icon: "bot" },
    { os: "Linux", icon: "server" },
  ];
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      {tiles.map((p) => (
        <a key={p.os} href={RELEASES_URL} target="_blank" rel="noreferrer"
          className="flex items-center gap-3 rounded-lg border border-surface-border bg-surface px-4 py-3 transition hover:border-brand">
          <Icon name={p.icon} className="h-5 w-5 text-brand" />
          <span className="text-sm font-semibold">{p.os}</span>
        </a>
      ))}
    </div>
  );
}

/**
 * "Download the desktop app" card. Compact by default: one recommended installer
 * per platform from the latest release. Everything secondary — other architectures,
 * older versions, and the setup steps — lives behind a single disclosure so the
 * card stays clean. Async server component; release data is cached upstream.
 */
export async function RunnerDownloadCard() {
  const releases = await fetchRunnerGuiReleases(12);
  const latest = releases[0] ?? null;
  const older = releases.slice(1);
  const byPlatform = latest ? bestPerPlatform(latest) : null;
  const platforms = byPlatform
    ? (Object.keys(PLATFORM_META) as AssetPlatform[]).filter((p) => byPlatform[p].length > 0)
    : [];
  // Assets beyond the recommended one per platform → shown only in the disclosure.
  const extras: { platform: AssetPlatform; assets: ReleaseAsset[] }[] = byPlatform
    ? platforms.map((p) => ({ platform: p, assets: byPlatform[p].slice(1) })).filter((x) => x.assets.length > 0)
    : [];
  const hasMore = extras.length > 0 || older.length > 0;

  return (
    <div className="card mt-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-brand">
          <Icon name="server" className="mr-1 inline h-4 w-4" />
          Download the desktop app{" "}
          <Hint>
            Install, paste a <span className="font-semibold text-brand">connection code</span> from{" "}
            <span className="font-mono">Add a machine</span>, and the machine connects — no terminal.
          </Hint>
        </h2>
        {latest && (
          <span className="tag text-xs text-gray-300">
            {shortVer(latest.version)}{latest.publishedAt ? ` · ${fmtDate(latest.publishedAt)}` : ""}
          </span>
        )}
      </div>

      {latest && byPlatform ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {platforms.map((p) => (
            <RecommendedButton key={p} platform={p} asset={byPlatform[p][0]} />
          ))}
        </div>
      ) : (
        <FallbackTiles />
      )}

      {hasMore && (
        <details className="mt-3 group">
          <summary className="cursor-pointer list-none text-xs text-gray-500 transition hover:text-gray-300">
            <span className="inline-flex items-center gap-1">
              <span className="transition-transform group-open:rotate-90">▸</span>
              More builds &amp; older versions
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            {extras.length > 0 && (
              <div className="space-y-2">
                {extras.map(({ platform, assets }) => (
                  <div key={platform} className="text-xs">
                    <span className="mr-2 font-semibold text-gray-400">{PLATFORM_META[platform].label}</span>
                    {assets.map((a) => (
                      <a key={a.name} href={a.url} className="tag mr-1.5 text-xs text-gray-300 transition hover:border-brand hover:text-brand">
                        {a.label}
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {older.map((r: RunnerGuiRelease) => (
              <div key={r.version} className="border-t border-surface-border pt-2 text-xs">
                <span className="mr-2 font-semibold text-gray-300">{shortVer(r.version)}</span>
                {r.publishedAt && <span className="mr-2 text-gray-500">{fmtDate(r.publishedAt)}</span>}
                {r.assets.map((a) => (
                  <a key={a.name} href={a.url} className="tag mr-1.5 text-xs text-gray-400 transition hover:border-brand hover:text-brand">
                    {a.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
