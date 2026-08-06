# RD-AISEC Runner ↔ Portal — Architecture (current)

_The single source of truth for how machines connect to and are controlled by the
portal. If something here disagrees with the code, the code wins — fix this doc._

The runner is a single stdlib-only Python file (`runner/rdaisec_runner.py`,
`RUNNER_VERSION` in its header must match `lib/runner-constants.ts`). It runs on a
machine you control (e.g. Kali in a VM), self-updates from `/api/runner/script`,
and talks to the portal over outbound HTTPS only. **There is one runner.** (The old
`runner/agent/` "v2 Operations Agent" and the `TaskEvent` bus were removed — do not
reintroduce a second runner or a parallel transport.)

## One mechanism per concern

| Concern | THE mechanism | Deliberate fallback |
|---|---|---|
| **Identity** | runner bearer token (`rdr_…`, only its hash stored). `authenticateRunner` in `lib/runner-auth.ts` resolves it — **read-only, no writes**. | — |
| **Enrollment** | reusable enroll code (`rde_…`) → `POST /api/runner/enroll` mints/rotates a token; machine `fingerprint` reclaims the same row. Self-heals a lost token. | — |
| **Presence ("online")** | the open **SSE stream** (`/api/runner/stream`) stamps `lastSeenAt` each tick. | `touchPresence` on `/api/runner/ping` (heartbeat) + the job poll — so a busy or SSE-blocked machine still shows online. |
| **Getting work** | atomic claim on `/api/runner/job` (the ONLY claim path), triggered instantly by the SSE `wake` event. | `POLL_SECONDS` timer on the runner. |
| **Telemetry** (~20 stat cols) | `recordTelemetry` on the job poll, job result, and `ping?full=1`. Never on plain auth. | — |
| **Cancel / Restart** | SSE `cancel` / `restart` events. | ping `X-Runner-Command` + `/api/runner/job/canceled` poll (kept for when SSE is blocked — resilience, not mess; do not delete while the runner still calls them). |
| **Full control** (PTY / files / procs / services / install-any) | `ControlSession` + `ControlMessage` over the SAME stream (down) + `POST /api/runner/control/msg` (up). | none |
| **Results / progress** | `/api/runner/job/[id]/result` + `/progress`. | — |

**Why presence used to flap:** `authenticateRunner` did a ~20-column write on every
request, coupling auth to a heavy DB write. That coupling is gone — auth is a pure
read; presence/telemetry are separate, lightweight, explicit calls.

## Full control (RCE by design — gated)

- Portal → runner: `/api/runner/stream` delivers `dir="in"` `ControlMessage`s past a
  `?controlAfter=<seq>` cursor (so a 25s SSE reconnect never replays keystrokes).
  Adaptive cadence: ~130ms while a session is live, 2.5s idle.
- Runner → portal: `POST /api/runner/control/msg` appends `dir="out"` frames.
- Browser: `GET /api/control/[id]/stream` (SSE tail of `dir="out"`) + `POST
  /api/control/[id]/input` (writes `dir="in"`). Both owner-authenticated.
- Runner (`handle_control`): PTY via `pty.fork()` (rooted via machine-side
  `RUNNER_SUDO_PASS` — password never leaves the box), file up/download, `ls`, `ps`,
  `systemctl`, `apt-get install`. Idle PTYs reaped after `CONTROL_IDLE_SECONDS`.
- **Security:** every browser control path is owner-checked; privileged kinds
  require a **time-boxed owner unlock** (`Runner.fullControlUntil`, ~45 min,
  auto-expires); session open/close + unlock/lock + service/install are audited
  (`lib/audit.ts`). TLS enforced. Frame/size/session caps.

## UI
- **Machines page** (`app/dashboard/runners/page.tsx`): fleet matrix (status,
  CPU/RAM, tools, what's-running-now, lock state) + per-machine cards + enrollment.
- **Machine page** (`app/dashboard/runners/[id]`): stats, settings, the command
  console, and **Full control** — unlock → live xterm terminal + file/process panels.
- **Queue** (`components/runner-queue.tsx`): capability-aware picker (shows online +
  whether each machine has the selected tool).

## Install
- One command: `curl -fsSL "<portal>/api/runner/bootstrap?code=rde_…" | sudo bash`
  (`app/api/runner/bootstrap` serves a self-contained installer). No git/repo/env.
- `runner/install-runner.sh` sets up the systemd service; the runner self-updates.

## Rules to avoid re-tangling this
1. One runner (`rdaisec_runner.py`), one claim path (`/api/runner/job`), one control
   bus (`ControlSession`/`ControlMessage`). Don't add a parallel transport.
2. `authenticateRunner` stays read-only. Presence/telemetry are explicit calls.
3. New capabilities are new `control` frame kinds + a `handle_control` branch, not new endpoints.
4. Keep the poll/ping fallbacks — they're resilience for when SSE is blocked.
