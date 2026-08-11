import { Icon } from "@/components/icons";

// Where the packaged desktop apps live. Built by the runner-gui GitHub Actions
// release workflow and attached to a GitHub Release; override per-deploy with
// NEXT_PUBLIC_RUNNER_GUI_RELEASES if you host them elsewhere.
const RELEASES_URL =
  process.env.NEXT_PUBLIC_RUNNER_GUI_RELEASES ||
  "https://github.com/rudraxdevelopment98-cell/RD-AISEC/releases/latest";

const PLATFORMS: { os: string; icon: string; file: string }[] = [
  { os: "Windows", icon: "globe", file: ".exe installer" },
  { os: "macOS", icon: "bot", file: ".dmg" },
  { os: "Linux", icon: "server", file: ".AppImage / .deb" },
];

/**
 * "Download the desktop app" card. The desktop app is a one-window control panel
 * for a machine: paste a connection code (from "Add a machine" below), and it
 * connects, then lets you start/stop/monitor the runner without a terminal.
 */
export function RunnerDownloadCard() {
  return (
    <div className="card mt-6">
      <h2 className="font-semibold text-brand">
        <Icon name="server" className="mr-1 inline h-4 w-4" />
        Download the desktop app
      </h2>
      <p className="mt-1 text-sm text-gray-400">
        The easiest way to connect a machine with no terminal. Install the app,
        paste a <span className="font-semibold text-brand">connection code</span>{" "}
        (generate one in <span className="font-mono">Add a machine</span>, below),
        and it connects — then you can start, stop, monitor, and set up the runner
        from a window.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {PLATFORMS.map((p) => (
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

      <ol className="mt-4 list-inside list-decimal space-y-1 text-xs text-gray-400">
        <li>Install and open the app on the machine you want to connect.</li>
        <li>
          Generate a <span className="font-semibold text-brand">connection code</span>{" "}
          in <span className="font-mono">Add a machine</span> below and paste it in.
        </li>
        <li>The machine appears in the fleet below, online — that&apos;s it.</li>
      </ol>
      <p className="mt-3 text-xs text-gray-500">
        Prefer no install? Use the one-command headless installer in{" "}
        <span className="font-mono">Add a machine</span> instead.
      </p>
    </div>
  );
}
