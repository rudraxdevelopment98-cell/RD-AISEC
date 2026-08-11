# RD-AISEC Runner — desktop control panel

A small cross-platform desktop app (Electron) that connects a machine (Kali / any
Linux, macOS, Windows) to your RD-AISEC portal and lets you **connect, monitor,
start / stop / restart, and set up** the runner from a window — no terminal
needed.

It is a **thin supervisor + window** around the existing single-file Python
runner (`../runner/rdaisec_runner.py`). It reimplements none of the runner's
logic; it just:

- writes the runner's config (`~/.config/rdaisec/runner.env`),
- ships and runs the runner script from a writable home (`~/.rdaisec/`) so the
  runner's own **self-update** keeps working,
- spawns the runner **detached** (closing the window does **not** disconnect the
  machine), tracked by a pidfile,
- reads **live status** from the runner's own local status server
  (`http://127.0.0.1:8787/api/status`) — so the UI can never drift from the
  runner's real state,
- tails the runner log, and offers **Reconnect / Restart** and an **Install
  essentials** helper.

## What you see

- **Connect** — portal URL + an *enroll code* from `Dashboard → Runners`. The
  runner earns its own token via enrollment; you never paste a token by hand.
- **Runner control** — live Online/Offline, jobs running, uptime, worker count,
  Wi-Fi interfaces; Start / Stop / Restart / Reconnect.
- **Running now** — the tools currently executing on this machine.
- **Machine setup** — one-click install of the essentials (Python 3, nmap, curl)
  via `pkexec`/`sudo apt` (Linux) or Homebrew (macOS).
- **Activity log** — a live tail of what the runner is doing.

## Prerequisites

- **Node.js 18+** and npm (to build the app).
- **Python 3** on the target machine (the runner is Python; the app will tell you
  if it's missing). On Linux/Kali it's already there.

## Run from source (dev)

```bash
cd runner-gui
npm install
npm start
```

In dev mode the app finds the runner at `../runner/rdaisec_runner.py`
automatically.

## Build installers

`electron-builder` produces a native installer for whatever OS you build **on**
(cross-compiling desktop apps is unreliable; build each target on that OS, or in
CI):

```bash
cd runner-gui
npm install

npm run dist          # installer for the current OS
npm run dist:linux    # AppImage + .deb   (build on Linux)
npm run dist:mac      # .dmg + .zip        (build on macOS)
npm run dist:win      # NSIS installer + portable .exe (build on Windows)
```

Output lands in `runner-gui/dist/`. The current `rdaisec_runner.py` is bundled
into the app (`extraResources`), so the installer is self-contained; the runner
then self-updates from your portal after first connect.

> Note: installers can only be produced on a machine with a desktop toolchain —
> they cannot be built in a headless CI-less sandbox. The source here is
> complete and validated (`node --check`); run the commands above on your own
> machine (or a GitHub Actions matrix) to get the packaged apps.

## Where things live

| What | Path |
|---|---|
| Config (portal, enroll code, token) | `~/.config/rdaisec/runner.env` |
| Runner script (self-updating copy) | `~/.rdaisec/rdaisec_runner.py` |
| Runner log (tailed in the app) | `~/.rdaisec/runner.log` |
| Runner pid | `~/.rdaisec/runner.pid` |

## Security notes

- The renderer is fully sandboxed (`contextIsolation: true`, `nodeIntegration:
  false`) and locked to a strict CSP; it talks to the OS only through the small,
  named IPC bridge in `preload.js`.
- The **token is never sent to the UI** — the renderer only learns *whether* a
  token exists.
- The runner stays running when you close the window, by design: the machine
  should remain connected to the portal. Use **Stop** to actually disconnect it.
