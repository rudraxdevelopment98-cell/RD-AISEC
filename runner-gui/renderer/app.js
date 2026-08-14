// Renderer logic. No Node here — everything goes through window.rd (preload).
// The app polls the runner's own /api/status (via the main process) so what you
// see is exactly the runner's real state.

const $ = (id) => document.getElementById(id);

function fmtDur(s) {
  if (s == null) return "–";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return d + "d " + h + "h";
  if (h) return h + "h " + m + "m";
  if (m) return m + "m";
  return s + "s";
}

function msg(el, text, kind) {
  el.textContent = text || "";
  el.className = "msg" + (kind ? " " + kind : "");
}

// ── Connect ──────────────────────────────────────────────────────────────────
async function loadConfig() {
  const cfg = await window.rd.getConfig();
  if (cfg.PORTAL_URL) $("portalUrl").value = cfg.PORTAL_URL;
  if (cfg.MAX_WORKERS) $("maxWorkers").value = cfg.MAX_WORKERS;
  const chip = $("tokenChip");
  if (cfg.hasToken) {
    chip.textContent = "✓ token stored";
    chip.className = "tokenchip ok";
  } else if (cfg.RUNNER_ENROLL_CODE) {
    chip.textContent = "enroll code set";
    chip.className = "tokenchip";
  } else {
    chip.textContent = "";
  }
  const paths = await window.rd.paths();
  $("pathsBox").innerHTML =
    '<div class="mono">config: ' +
    paths.config +
    "</div>" +
    '<div class="mono">runner: ' +
    paths.runner +
    "</div>" +
    '<div class="mono">log: ' +
    paths.log +
    "</div>";
}

async function connect() {
  const btn = $("connectBtn");
  btn.disabled = true;
  msg($("connectMsg"), "Saving config and starting the runner…");
  const opts = {
    connectCode: $("connectCode").value.trim(),
    portalUrl: $("portalUrl").value.trim(),
    enrollCode: $("enrollCode").value.trim(),
    token: $("token").value.trim(),
    maxWorkers: $("maxWorkers").value.trim(),
  };
  const r = await window.rd.connect(opts);
  btn.disabled = false;
  if (r && r.ok) {
    msg(
      $("connectMsg"),
      r.external
        ? r.message
        : r.already
          ? "Runner already running (pid " + r.pid + ")."
          : "Runner started (pid " + r.pid + "). Waiting for it to come online…",
      "ok",
    );
    $("token").value = "";
    $("connectCode").value = "";
    loadConfig();
  } else {
    msg($("connectMsg"), (r && r.error) || "Failed to connect.", "err");
  }
}

// ── Lifecycle buttons ──────────────────────────────────────────────────────────
function wireControls() {
  $("connectBtn").addEventListener("click", connect);
  $("startBtn").addEventListener("click", async () => {
    const r = await window.rd.start();
    msg(
      $("controlMsg"),
      r.ok
        ? r.external
          ? r.message
          : r.already
            ? "Already running."
            : "Started (pid " + r.pid + ")."
        : r.error,
      r.ok ? "ok" : "err",
    );
  });
  $("stopBtn").addEventListener("click", async () => {
    const r = await window.rd.stop();
    msg($("controlMsg"), r.ok ? "Stopped." : r.error, r.ok ? "ok" : "err");
  });
  $("restartBtn").addEventListener("click", async () => {
    msg($("controlMsg"), "Restarting…");
    const r = await window.rd.restart();
    msg($("controlMsg"), r.ok ? "Restarted (pid " + r.pid + ")." : r.error, r.ok ? "ok" : "err");
  });
  $("reconnectBtn").addEventListener("click", async () => {
    const r = await window.rd.reconnect();
    msg($("controlMsg"), r.ok ? "Reconnect requested." : "Runner not reachable.", r.ok ? "ok" : "err");
  });
  $("statusPageBtn").addEventListener("click", () => window.rd.openStatusPage());
  wireUpdates();
  $("installBtn").addEventListener("click", async () => {
    const btn = $("installBtn");
    btn.disabled = true;
    msg($("toolsMsg"), "Installing essentials (you may be asked for your password)…");
    const r = await window.rd.installEssentials();
    btn.disabled = false;
    msg($("toolsMsg"), r.ok ? "Essentials installed." : r.error, r.ok ? "ok" : "err");
  });
}

// ── Updates ─────────────────────────────────────────────────────────────────────
let pendingUpdateUrl = "";
async function wireUpdates() {
  // Show the current app version in the chip.
  try {
    const v = await window.rd.appVersion();
    if (v && v.version) $("verChip").textContent = "v" + v.version;
  } catch {
    /* ignore */
  }

  const dl = $("downloadUpdateBtn");
  // Live auto-update events: download progress, completion (→ restart), errors.
  window.rd.onUpdateEvent((ev) => {
    if (ev.type === "progress") {
      msg($("updateMsg"), "Downloading update… " + ev.pct + "%", "ok");
    } else if (ev.type === "downloaded") {
      dl.textContent = "Restart & install";
      dl.dataset.mode = "install";
      dl.style.display = "";
      msg($("updateMsg"), "Update downloaded — restart to install.", "ok");
    } else if (ev.type === "error") {
      // Auto-update failed → fall back to a manual browser download if we have a URL.
      if (pendingUpdateUrl) {
        dl.textContent = "Download update";
        dl.dataset.mode = "browser";
        dl.style.display = "";
        msg($("updateMsg"), "Auto-update unavailable — download the installer instead.", "err");
      } else {
        msg($("updateMsg"), "Update error: " + ev.msg, "err");
      }
    }
  });

  $("checkUpdateBtn").addEventListener("click", async () => {
    const btn = $("checkUpdateBtn");
    btn.disabled = true;
    dl.style.display = "none";
    pendingUpdateUrl = "";
    msg($("updateMsg"), "Checking for updates…");
    const r = await window.rd.checkUpdate();
    btn.disabled = false;
    if (!r || !r.ok) {
      msg($("updateMsg"), (r && r.error) || "Update check failed.", "err");
      return;
    }
    if (!r.updateAvailable) {
      msg($("updateMsg"), "You're up to date (v" + r.current + ").", "ok");
      return;
    }
    // A newer version exists. Prefer a real in-app auto-update; the browser
    // download is the fallback (macOS, .deb, or when auto-update isn't available).
    pendingUpdateUrl = r.downloadUrl;
    msg($("updateMsg"), "Update available: v" + r.current + " → v" + r.latest + ".", "ok");
    const au = await window.rd.startAutoUpdate();
    if (au && au.ok && au.supported && au.downloading) {
      msg($("updateMsg"), "Downloading update v" + r.latest + "…", "ok");
      // progress + "Restart & install" arrive via onUpdateEvent
    } else {
      dl.textContent = "Download " + r.latest + " (" + r.downloadLabel + ")";
      dl.dataset.mode = "browser";
      dl.style.display = "";
    }
  });

  dl.addEventListener("click", () => {
    if (dl.dataset.mode === "install") {
      msg($("updateMsg"), "Restarting to install…");
      window.rd.quitAndInstall();
    } else if (pendingUpdateUrl) {
      window.rd.openExternal(pendingUpdateUrl);
    }
  });
}

// ── Status poll ────────────────────────────────────────────────────────────────
function renderStatus(res) {
  const dot = $("stateDot");
  const text = $("stateText");
  const online = res.reachable && res.status && res.status.connected;

  if (online) {
    dot.className = "dot on";
    text.textContent = "Online";
  } else if (res.running) {
    dot.className = "dot warn";
    text.textContent = res.reachable ? "Connecting…" : "Starting…";
  } else {
    dot.className = "dot off";
    text.textContent = "Stopped";
  }

  const s = res.status || {};
  $("portalLabel").textContent = s.portal || "not connected";
  $("verLabel").textContent = s.version ? "v" + s.version : "";
  $("cState").textContent = online ? "Online" : res.running ? "Starting" : "Stopped";
  $("cLastOk").textContent =
    s.lastOkAgo != null ? "last check " + fmtDur(s.lastOkAgo) + " ago" : "";
  $("cJobs").textContent = s.jobs ? s.jobs.length : "0";
  $("cWorkers").textContent =
    s.activeWorkers != null ? s.activeWorkers + " / " + s.maxWorkers + " workers" : "";
  $("cUptime").textContent = s.uptimeSec != null ? fmtDur(s.uptimeSec) : "–";
  $("cVer").textContent = s.version ? "v" + s.version : "";
  $("cWifi").textContent = s.wifi ? s.wifi.length : "0";

  // Running jobs
  const jl = $("jobsList");
  if (s.jobs && s.jobs.length) {
    jl.innerHTML = s.jobs
      .map(
        (j) =>
          '<div class="job"><span class="jtool">' +
          escapeHtml(j.tool || "?") +
          '</span><span class="jtarget">' +
          escapeHtml(j.target || "") +
          "</span></div>",
      )
      .join("");
  } else {
    jl.innerHTML = '<span class="muted">nothing running</span>';
  }

  if (s.lastError) msg($("controlMsg"), s.lastError, "err");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

async function pollStatus() {
  try {
    const res = await window.rd.status();
    renderStatus(res);
  } catch {
    /* ignore a single failed poll */
  }
}

async function pollLog() {
  try {
    const text = await window.rd.log(400);
    const pre = $("log");
    const atBottom =
      pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
    pre.textContent = text || "(no activity yet)";
    if ($("autoscroll").checked && atBottom) pre.scrollTop = pre.scrollHeight;
  } catch {
    /* ignore */
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  wireControls();
  await loadConfig();
  await pollStatus();
  await pollLog();
  setInterval(pollStatus, 2000);
  setInterval(pollLog, 2500);
});
