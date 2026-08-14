// RD-AISEC Runner — Electron main process.
//
// This desktop app is a thin *supervisor + window* around the existing single-file
// Python runner (runner/rdaisec_runner.py). It does NOT reimplement any runner
// logic. It:
//   • writes the runner's config file (~/.config/rdaisec/runner.env),
//   • copies the bundled runner script to a writable home (~/.rdaisec) so the
//     runner's own self-update keeps working,
//   • spawns the runner detached (so closing the window doesn't kill the machine's
//     connection) and tracks it by pidfile,
//   • reads live status from the runner's local status server (127.0.0.1:8787),
//   • streams the runner log file into the window,
//   • start / stop / restart / reconnect,
//   • installs OS essentials (python3, nmap, …) via the platform's privileged path.
//
// Everything the UI shows comes from the runner's own /api/status — the exact
// same data the runner's built-in local page shows — so the GUI can never drift
// from the runner's real state.

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { spawn, spawnSync } = require("child_process");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

// ── Paths ────────────────────────────────────────────────────────────────────
const HOME = os.homedir();
const RUN_DIR = path.join(HOME, ".rdaisec"); // writable runner home (self-update lands here)
const CFG_DIR = path.join(HOME, ".config", "rdaisec"); // runner reads runner.env from here
const CFG_FILE = path.join(CFG_DIR, "runner.env"); // KEY=VALUE config (also TOKEN_STORE)
const RUNNER_DEST = path.join(RUN_DIR, "rdaisec_runner.py"); // where we run the script from
const PID_FILE = path.join(RUN_DIR, "runner.pid");
const LOG_FILE = path.join(RUN_DIR, "runner.log");

const STATUS_PORT = 8787;
const STATUS_URL = `http://127.0.0.1:${STATUS_PORT}`;

let win = null;

// ── Small fs helpers ──────────────────────────────────────────────────────────
function ensureDir(d) {
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch {
    /* ignore */
  }
}

/** The runner script we ship with the app (packaged → resources; dev → ../runner). */
function bundledRunnerPath() {
  const packaged = path.join(process.resourcesPath || "", "rdaisec_runner.py");
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, "..", "runner", "rdaisec_runner.py");
  return fs.existsSync(dev) ? dev : null;
}

/**
 * Copy the bundled runner into ~/.rdaisec if the destination is missing OR older
 * than what we ship. We never overwrite a NEWER script, because the runner
 * self-updates from the portal and that copy may be ahead of the app's bundle.
 */
function syncRunnerScript() {
  ensureDir(RUN_DIR);
  const src = bundledRunnerPath();
  if (!src) return { ok: false, error: "Bundled runner script not found." };
  try {
    let copy = true;
    if (fs.existsSync(RUNNER_DEST)) {
      const s = fs.statSync(src);
      const d = fs.statSync(RUNNER_DEST);
      copy = s.mtimeMs > d.mtimeMs; // only refresh if the bundle is newer
    }
    if (copy) fs.copyFileSync(src, RUNNER_DEST);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ── Config (runner.env) ────────────────────────────────────────────────────────
/** Parse KEY=VALUE lines (same format the runner's _load_env_files reads/writes). */
function readConfig() {
  const cfg = {};
  try {
    const raw = fs.readFileSync(CFG_FILE, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith("#") || !s.includes("=")) continue;
      const i = s.indexOf("=");
      const k = s.slice(0, i).trim();
      let v = s.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (k) cfg[k] = v;
    }
  } catch {
    /* no file yet */
  }
  return cfg;
}

/**
 * Merge updates into runner.env, preserving keys the runner itself writes (e.g. a
 * RUNNER_TOKEN it earned via enrollment). We never blow away an existing token
 * unless the caller explicitly provides one.
 */
function writeConfig(updates) {
  ensureDir(CFG_DIR);
  const cfg = readConfig();
  for (const [k, v] of Object.entries(updates || {})) {
    if (v === null || v === undefined || v === "") delete cfg[k];
    else cfg[k] = String(v);
  }
  const header =
    "# RD-AISEC runner config — managed by the RD-AISEC Runner desktop app.\n" +
    "# You can also edit this by hand; real environment variables still win.\n";
  const body = Object.entries(cfg)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  fs.writeFileSync(CFG_FILE, header + body + "\n", { mode: 0o600 });
  return cfg;
}

// ── Connection code ─────────────────────────────────────────────────────────────
// One connection code = portal origin + enroll code, bundled by the portal so the
// user makes a SINGLE paste. Format: RDC1.<base64url(JSON{p,c})>. Mirror of
// lib/connect-code.ts on the portal side.
function decodeConnectCode(input) {
  const s = String(input || "").trim();
  if (!s.startsWith("RDC1.")) return null;
  try {
    const b64 = s.slice(5).replace(/-/g, "+").replace(/_/g, "/");
    const obj = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
    if (obj && typeof obj.p === "string" && typeof obj.c === "string" && obj.p && obj.c)
      return { portal: obj.p.replace(/\/+$/, ""), code: obj.c };
  } catch {
    /* malformed */
  }
  return null;
}

// ── Python discovery ────────────────────────────────────────────────────────────
let PYTHON_CACHE = null;
function findPython() {
  if (PYTHON_CACHE) return PYTHON_CACHE;
  const candidates = IS_WIN
    ? ["python", "python3", "py"]
    : ["python3", "python"];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ["--version"], { timeout: 4000 });
      if (r.status === 0 || (r.stdout || r.stderr)) {
        PYTHON_CACHE = c;
        return c;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

// ── Runner process lifecycle ────────────────────────────────────────────────────
function readPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Is a pid alive? (signal 0 never kills, just probes.) */
function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM"; // exists but not ours to signal
  }
}

function isRunning() {
  const pid = readPid();
  return pidAlive(pid) ? pid : null;
}

async function startRunner() {
  const already = isRunning();
  if (already) return { ok: true, pid: already, already: true };

  // A runner may already own this machine that this app didn't spawn — e.g. a
  // `curl | sudo bash` systemd install, or a previous app run whose pidfile was
  // lost. Its local status server answers on 127.0.0.1:8787. Spawning a second
  // instance is pointless: the runner's single-instance guard would just kill it,
  // and two instances war over the token (the classic "token rejected" loop).
  // Attach to the existing one instead of starting a duplicate.
  const probe = await httpJson("GET", "/api/status", 1500);
  if (probe.ok && probe.json) {
    return {
      ok: true,
      external: true,
      message:
        "A runner is already running on this machine — the app is showing its status. " +
        "To have the app manage its own instead, stop that one first " +
        "(e.g. sudo systemctl stop rdaisec-runner).",
    };
  }

  const py = findPython();
  if (!py)
    return {
      ok: false,
      error:
        "Python 3 not found. Install Python 3 and make sure it's on your PATH.",
    };

  const sync = syncRunnerScript();
  if (!sync.ok) return sync;
  if (!fs.existsSync(RUNNER_DEST))
    return { ok: false, error: "Runner script missing after sync." };

  ensureDir(RUN_DIR);
  // Append-mode log so restarts keep history; the renderer tails this file.
  let out;
  try {
    out = fs.openSync(LOG_FILE, "a");
  } catch (e) {
    return { ok: false, error: "Cannot open log file: " + e.message };
  }

  // Detached: the runner keeps running (machine stays connected) even if the
  // window/app is closed. It reads its config from ~/.config/rdaisec/runner.env.
  const child = spawn(py, [RUNNER_DEST], {
    cwd: RUN_DIR,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, RDAISEC_STATUS: "1" },
  });
  child.on("error", () => {
    /* surfaced via status/log */
  });
  if (!child.pid) return { ok: false, error: "Failed to start runner process." };
  try {
    fs.writeFileSync(PID_FILE, String(child.pid));
  } catch {
    /* non-fatal */
  }
  child.unref(); // let the parent (this app) exit independently
  return { ok: true, pid: child.pid };
}

function stopRunner() {
  const pid = readPid();
  if (!pidAlive(pid)) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
    return { ok: true, already: true };
  }
  try {
    if (IS_WIN) {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
    } else {
      // Detached child is a process-group leader; kill the whole group so its
      // scan subprocesses die too. Fall back to the single pid.
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        process.kill(pid, "SIGTERM");
      }
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
  return { ok: true };
}

// ── Status + control (talk to the runner's local status server) ──────────────────
function httpJson(method, urlPath, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request(
      STATUS_URL + urlPath,
      { method, timeout: timeoutMs || 4000 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve({ ok: true, status: res.statusCode, json: JSON.parse(body || "{}") });
          } catch {
            resolve({ ok: true, status: res.statusCode, json: null, body });
          }
        });
      },
    );
    req.on("error", (e) => resolve({ ok: false, error: e.code || e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.end();
  });
}

// GET an absolute http(s) URL and parse JSON. Used for the portal update check —
// distinct from httpJson (which only talks to the local runner status server).
function httpsGetJson(absUrl, timeoutMs) {
  return new Promise((resolve) => {
    let mod;
    try {
      mod = absUrl.startsWith("https:") ? require("https") : require("http");
    } catch {
      return resolve({ ok: false, error: "no-http-module" });
    }
    const req = mod.request(
      absUrl,
      { method: "GET", timeout: timeoutMs || 6000, headers: { Accept: "application/json" } },
      (res) => {
        // Follow one redirect (release CDN / trailing-slash).
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve(httpsGetJson(res.headers.location, timeoutMs));
        }
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve({ ok: true, status: res.statusCode, json: JSON.parse(body || "{}") });
          } catch {
            resolve({ ok: false, error: "bad-json" });
          }
        });
      },
    );
    req.on("error", (e) => resolve({ ok: false, error: e.code || e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.end();
  });
}

// Compare two "1.0.3"-style versions. >0 if a is newer than b.
function cmpVersion(a, b) {
  const parse = (v) =>
    String(v || "")
      .replace(/^runner-gui-/, "")
      .replace(/^v/, "")
      .split(".")
      .map((x) => parseInt(x, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Pick the best installer asset for THIS machine's platform/arch from a release.
function pickAssetForThisMachine(release) {
  if (!release || !Array.isArray(release.assets)) return null;
  const plat = IS_WIN ? "windows" : IS_MAC ? "macos" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const mine = release.assets.filter((a) => a.platform === plat);
  if (mine.length === 0) return null;
  // Prefer an exact arch match, then the highest-weight asset.
  const archMatch = mine.filter((a) => a.arch === arch || a.arch === "universal");
  const pool = archMatch.length ? archMatch : mine;
  return pool.slice().sort((x, y) => (y.weight || 0) - (x.weight || 0))[0] || null;
}

/**
 * Check the portal for a newer desktop-app release. Compares this app's own version
 * (app.getVersion()) to the latest published runner-gui release. Returns a concrete,
 * direct download URL for THIS machine so the renderer can offer a one-click update.
 */
async function checkForUpdate() {
  const cfg = readConfig();
  const portal = (cfg.PORTAL_URL || "").replace(/\/+$/, "");
  if (!portal) return { ok: false, error: "Connect to a portal first (no PORTAL_URL set)." };
  const r = await httpsGetJson(portal + "/api/runner-gui/releases", 7000);
  if (!r.ok || !r.json) return { ok: false, error: "Could not reach the portal update feed (" + (r.error || "no data") + ")." };
  const latest = r.json.latest;
  if (!latest || !latest.version) return { ok: false, error: "No published releases found." };
  const current = app.getVersion();
  const newer = cmpVersion(latest.version, current) > 0;
  const asset = pickAssetForThisMachine(latest);
  return {
    ok: true,
    current,
    latest: String(latest.version).replace(/^runner-gui-/, ""),
    updateAvailable: newer,
    downloadUrl: (asset && asset.url) || latest.url || "",
    downloadLabel: (asset && asset.label) || "Open release page",
    releaseUrl: latest.url || "",
  };
}

// ── Auto-update (electron-updater) ───────────────────────────────────────────
// Full in-app update where the packaging supports it: Windows (NSIS) and Linux
// AppImage self-update from the GitHub release. macOS needs code-signing for
// Squirrel.Mac, and .deb/.rpm are owned by the OS package manager — those (and
// dev) fall back to the check-and-download flow (checkForUpdate above).
let _autoUpdater = null;
function getAutoUpdater() {
  if (_autoUpdater !== null) return _autoUpdater;
  try {
    _autoUpdater = require("electron-updater").autoUpdater;
    _autoUpdater.autoDownload = false; // we download on explicit user action
    _autoUpdater.autoInstallOnAppQuit = true;
    _autoUpdater.on("download-progress", (p) => {
      if (win) win.webContents.send("update:progress", Math.round(p.percent || 0));
    });
    _autoUpdater.on("update-downloaded", () => {
      if (win) win.webContents.send("update:downloaded");
    });
    _autoUpdater.on("error", (e) => {
      if (win) win.webContents.send("update:error", String((e && e.message) || e));
    });
  } catch {
    _autoUpdater = false; // module unavailable (e.g. not installed in dev)
  }
  return _autoUpdater;
}

// Can an in-app update actually be applied on THIS install?
function autoUpdateSupported() {
  if (!app.isPackaged) return false; // dev run
  if (IS_WIN) return true; // NSIS
  if (IS_MAC) return false; // requires code-signing
  return !!process.env.APPIMAGE; // Linux: only AppImage self-updates (not .deb/.rpm)
}

// Begin an in-app update: check the GitHub feed, and if a newer version exists,
// start downloading it (progress + completion arrive via the events above).
async function startAutoUpdate() {
  const au = getAutoUpdater();
  if (!au || !autoUpdateSupported()) return { ok: true, supported: false };
  try {
    const res = await au.checkForUpdates();
    const ver = res && res.updateInfo && res.updateInfo.version;
    if (!ver || cmpVersion(ver, app.getVersion()) <= 0) {
      return { ok: true, supported: true, updateAvailable: false };
    }
    au.downloadUpdate().catch((e) => {
      if (win) win.webContents.send("update:error", String((e && e.message) || e));
    });
    return { ok: true, supported: true, updateAvailable: true, downloading: true, version: ver };
  } catch (e) {
    return { ok: false, supported: true, error: String((e && e.message) || e) };
  }
}

async function getStatus() {
  const running = isRunning();
  const r = await httpJson("GET", "/api/status", 3500);
  if (r.ok && r.json) return { reachable: true, running: !!running, status: r.json };
  // Runner process may be alive but the status server not up yet (or disabled).
  return { reachable: false, running: !!running, error: r.error || null };
}

/** Tail the runner log file (last ~400 lines) for the in-app log pane. */
function tailLog(maxLines) {
  try {
    const raw = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = raw.split(/\r?\n/);
    return lines.slice(-(maxLines || 400)).join("\n");
  } catch {
    return "";
  }
}

// ── Install OS essentials (privileged) ──────────────────────────────────────────
// The heavy per-tool installs happen from the portal / runner; this button just
// gets a bare machine to the point where the runner can run at all.
function installEssentials() {
  if (IS_WIN) {
    return {
      ok: false,
      error:
        "On Windows, install Python 3 from python.org (or the Microsoft Store). " +
        "Security tooling is best run on Linux (Kali) or WSL.",
    };
  }
  const pkgs = ["python3", "nmap", "curl"];
  if (IS_MAC) {
    // Homebrew is the sane macOS path; we don't sudo on mac.
    const brew = spawnSync("which", ["brew"]);
    if (brew.status !== 0)
      return {
        ok: false,
        error:
          "Homebrew not found. Install it from https://brew.sh, then run: brew install " +
          pkgs.join(" "),
      };
    const r = spawnSync("brew", ["install", ...pkgs], { encoding: "utf-8" });
    return r.status === 0
      ? { ok: true, output: (r.stdout || "") + (r.stderr || "") }
      : { ok: false, error: (r.stderr || r.stdout || "brew install failed").slice(-2000) };
  }
  // Linux: prefer pkexec (GUI password prompt) then sudo. apt on Debian/Kali.
  const hasApt = spawnSync("which", ["apt-get"]).status === 0;
  if (!hasApt)
    return {
      ok: false,
      error:
        "This helper supports apt-based systems (Debian/Kali/Ubuntu). " +
        "Install " + pkgs.join(", ") + " with your package manager.",
    };
  const cmd = "apt-get update && apt-get install -y " + pkgs.join(" ");
  let r;
  if (spawnSync("which", ["pkexec"]).status === 0) {
    r = spawnSync("pkexec", ["bash", "-lc", cmd], { encoding: "utf-8" });
  } else {
    r = spawnSync("sudo", ["bash", "-lc", cmd], { encoding: "utf-8" });
  }
  return r.status === 0
    ? { ok: true, output: (r.stdout || "").slice(-2000) }
    : {
        ok: false,
        error: (r.stderr || r.stdout || "install failed (need admin rights)").slice(-2000),
      };
}

// ── IPC wiring ───────────────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle("config:get", () => {
    const cfg = readConfig();
    // Never ship the token itself to the renderer — just whether one exists.
    const { RUNNER_TOKEN, ...safe } = cfg;
    return { ...safe, hasToken: !!RUNNER_TOKEN };
  });
  ipcMain.handle("config:save", (_e, updates) => {
    try {
      writeConfig(updates || {});
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  });
  ipcMain.handle("runner:start", () => startRunner());
  ipcMain.handle("runner:stop", () => stopRunner());
  ipcMain.handle("runner:restart", () => {
    stopRunner();
    return startRunner();
  });
  ipcMain.handle("runner:status", () => getStatus());
  ipcMain.handle("runner:reconnect", () => httpJson("POST", "/reconnect", 4000));
  ipcMain.handle("runner:log", (_e, n) => tailLog(n));
  ipcMain.handle("runner:isRunning", () => ({ running: !!isRunning() }));
  ipcMain.handle("tools:installEssentials", () => installEssentials());
  ipcMain.handle("app:checkUpdate", () => checkForUpdate());
  ipcMain.handle("app:startAutoUpdate", () => startAutoUpdate());
  ipcMain.handle("app:quitAndInstall", () => {
    const au = getAutoUpdater();
    if (au) setImmediate(() => au.quitAndInstall());
    return { ok: !!au };
  });
  ipcMain.handle("app:openExternal", (_e, url) => {
    // Only allow http(s) links (release/download URLs) — never arbitrary schemes.
    if (typeof url === "string" && /^https?:\/\//i.test(url)) shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle("app:version", () => ({ version: app.getVersion() }));
  ipcMain.handle("app:openStatusPage", () => shell.openExternal(STATUS_URL));
  ipcMain.handle("app:paths", () => ({
    config: CFG_FILE,
    runner: RUNNER_DEST,
    log: LOG_FILE,
    home: RUN_DIR,
  }));

  // Connect = save config (portal + enroll code) then start the runner. A single
  // connection code is the happy path; the manual fields are the fallback.
  ipcMain.handle(
    "runner:connect",
    (_e, { connectCode, portalUrl, enrollCode, token, maxWorkers }) => {
    const updates = {};
    // A connection code carries both the portal and the enroll code — decode first,
    // then let any explicit manual field override it.
    if (connectCode) {
      const dec = decodeConnectCode(connectCode);
      if (!dec)
        return {
          ok: false,
          error: "That connection code isn't valid — copy it again from the portal.",
        };
      updates.PORTAL_URL = dec.portal;
      updates.RUNNER_ENROLL_CODE = dec.code;
    }
    if (portalUrl) updates.PORTAL_URL = String(portalUrl).replace(/\/+$/, "");
    if (enrollCode) updates.RUNNER_ENROLL_CODE = String(enrollCode).trim();
    if (token) updates.RUNNER_TOKEN = String(token).trim();
    if (maxWorkers) updates.MAX_WORKERS = String(parseInt(maxWorkers, 10) || 3);
    if (!updates.PORTAL_URL)
      return { ok: false, error: "Paste a connection code (or set the portal URL manually)." };
    if (!updates.RUNNER_ENROLL_CODE && !updates.RUNNER_TOKEN) {
      const cur = readConfig();
      if (!cur.RUNNER_TOKEN && !cur.RUNNER_ENROLL_CODE)
        return {
          ok: false,
          error: "Provide an enroll code (recommended) or a runner token.",
        };
    }
    try {
      writeConfig(updates);
    } catch (e) {
      return { ok: false, error: "Failed to save config: " + e.message };
    }
    return startRunner();
    },
  );
}

// ── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: "#0b0f16",
    title: "RD-AISEC Runner",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("closed", () => {
    win = null;
  });
}

app.whenReady().then(() => {
  ensureDir(RUN_DIR);
  ensureDir(CFG_DIR);
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Closing the window does NOT stop the runner (that's the point — the machine
// stays connected). Quit the app fully on non-mac when all windows close.
app.on("window-all-closed", () => {
  if (!IS_MAC) app.quit();
});

// Prevent a second instance from fighting over the same runner.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Surface uncaught errors instead of dying silently.
process.on("uncaughtException", (err) => {
  try {
    dialog.showErrorBox("RD-AISEC Runner", String(err && err.stack ? err.stack : err));
  } catch {
    /* ignore */
  }
});
