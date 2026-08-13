import { Icon } from "@/components/icons";
import {
  fetchRunnerGuiReleases,
  bestPerPlatform,
  type AssetPlatform,
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

// A direct download link for one installer asset.
function AssetLink({ href, label, size }: { href: string; label: string; size: number }) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 rounded-md border border-surface-border bg-surface px-3 py-2 text-sm transition hover:border-brand"
    >
      <Icon name="arrow" className="h-4 w-4 shrink-0 text-brand" />
      <span className="flex-1">{label}</span>
      {size > 0 && <span className="text-xs text-gray-500">{fmtSize(size)}</span>}
    </a>
  );
}

// Static fallback tiles → the GitHub releases page (only when the API failed).
function FallbackTiles() {
  const tiles = [
    { os: "Windows", icon: "globe", file: ".exe installer" },
    { os: "macOS", icon: "bot", file: ".dmg" },
    { os: "Linux", icon: "server", file: ".AppImage / .deb" },
  ];
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {tiles.map((p) => (
        <a
          key={p.os}
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-lg border border-surface-border bg-surface px-4 py-3 transition hover:border-brand"
        >
          <Icon name={p.icon} className="h-5 w-5 text-brand" />
          <span>
            <span className="block text-sm font-semibold">{p.os}</span>
            <span className="block text-xs text-gray-500">{p.file}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

function LatestDownloads({ release }: { release: RunnerGuiRelease }) {
  const byPlatform = bestPerPlatform(release);
  const platforms = (Object.keys(PLATFORM_META) as AssetPlatform[]).filter((p) => byPlatform[p].length > 0);
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-3">
      {platforms.map((p) => (
        <div key={p} className="rounded-lg border border-surface-border bg-surface/50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Icon name={PLATFORM_META[p].icon} className="h-5 w-5 text-brand" />
            <span className="text-sm font-semibold">{PLATFORM_META[p].label}</span>
          </div>
          <div className="space-y-1.5">
            {byPlatform[p].map((a) => (
              <AssetLink key={a.name} href={a.url} label={a.label} size={a.size} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * "Download the desktop app" card. Resolves DIRECT installer links from the latest
 * GitHub Release (no more bounce to the release page), with per-platform/arch
 * options and a version picker for older builds. Falls back to the release page if
 * the GitHub API is unreachable. Async server component — cached upstream.
 */
export async function RunnerDownloadCard() {
  const releases = await fetchRunnerGuiReleases(12);
  const latest = releases[0] ?? null;
  const older = releases.slice(1);

  return (
    <div className="card mt-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-brand">
          <Icon name="server" className="mr-1 inline h-4 w-4" />
          Download the desktop app
        </h2>
        {latest && (
          <span className="tag text-xs text-gray-300">
            Latest {shortVer(latest.version)}
            {latest.publishedAt ? ` · ${fmtDate(latest.publishedAt)}` : ""}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-400">
        The easiest way to connect a machine with no terminal. Install the app,
        paste a <span className="font-semibold text-brand">connection code</span>{" "}
        (generate one in <span className="font-mono">Add a machine</span>, below),
        and it connects — then you can start, stop, monitor, and set up the runner
        from a window.
      </p>

      {latest ? <LatestDownloads release={latest} /> : <FallbackTiles />}

      {older.length > 0 && (
        <details className="mt-3 rounded-lg border border-surface-border bg-surface/40 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-gray-300">
            Other versions ({older.length})
          </summary>
          <div className="mt-3 space-y-3">
            {older.map((r) => (
              <div key={r.version} className="border-t border-surface-border pt-3 first:border-t-0 first:pt-0">
                <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-400">
                  <span className="font-semibold text-gray-200">{shortVer(r.version)}</span>
                  {r.publishedAt && <span>· {fmtDate(r.publishedAt)}</span>}
                  {r.prerelease && <span className="tag text-[10px] text-amber-400">pre-release</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.assets.map((a) => (
                    <a
                      key={a.name}
                      href={a.url}
                      className="tag text-xs text-gray-300 transition hover:border-brand hover:text-brand"
                    >
                      {a.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <ol className="mt-4 list-inside list-decimal space-y-1 text-xs text-gray-400">
        <li>Install and open the app on the machine you want to connect.</li>
        <li>
          Generate a <span className="font-semibold text-brand">connection code</span>{" "}
          in <span className="font-mono">Add a machine</span> below and paste it in.
        </li>
        <li>The machine appears in the fleet below, online — that&apos;s it.</li>
      </ol>
      <p className="mt-3 text-xs text-gray-500">
        The app checks for updates itself (Settings → Check for updates), and the
        runner engine auto-updates in the background. Prefer no install? Use the
        one-command headless installer in <span className="font-mono">Add a machine</span>.
      </p>
    </div>
  );
}
