#!/usr/bin/env bash
#
# RD-AISEC runner — one-command setup.
#
# Fixes the "keeps going offline / duplicate processes / git-pull conflict" mess
# in one shot. It:
#   • stops every existing runner (kills duplicates)
#   • removes old auto-start entries that spawned extras (cron @reboot)
#   • installs the runner as a single systemd service that starts on boot,
#     restarts on crash, and SELF-UPDATES from the portal — so nothing ever
#     runs `git pull` on the runner again (that was the conflict you hit)
#   • auto-discovers your PORTAL_URL + RUNNER_TOKEN from the existing setup
#     (only prompts if it truly can't find them)
#
# Run it WITHOUT sudo (it uses sudo itself only where needed):
#     bash runner/install-runner.sh
#
# Safe to re-run any time.
set -euo pipefail

say() { printf '\033[1;32m→\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Run this WITHOUT sudo (as your normal user): bash runner/install-runner.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$HOME/.rdaisec"
DEST="$STATE/rdaisec_runner.py"
CFG="$STATE/runner.env"
USER_NAME="$(id -un)"
PYTHON="$(command -v python3 || true)"
[ -n "$PYTHON" ] || die "python3 not found. Install it: sudo apt-get install -y python3"

echo "== RD-AISEC runner setup =="

# ── 1. Discover PORTAL_URL + RUNNER_TOKEN (env → saved → old setup → prompt) ──
# Pull KEY=value out of a blob, tolerating `export KEY=`, single/double quotes and
# trailing junk. Returns the last (most recent) match.
extract() {
  local key="$1"
  grep -hoE "${key}=[\"']?[^\"'[:space:]]+" 2>/dev/null | tail -1 | sed -E "s/^${key}=[\"']?//"
}
discover() {
  local key="$1" v="${!1:-}"
  [ -n "$v" ] && { printf '%s' "$v"; return; }
  for f in "$CFG" "$HOME/.bashrc" "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.zshrc"; do
    [ -f "$f" ] || continue
    v=$(extract "$key" < "$f")
    [ -n "$v" ] && { printf '%s' "$v"; return; }
  done
  v=$(crontab -l 2>/dev/null | extract "$key" || true)
  [ -n "$v" ] && { printf '%s' "$v"; return; }
  v=$(sudo cat /etc/systemd/system/rdaisec-runner.service 2>/dev/null | extract "$key" || true)
  printf '%s' "$v"
}

PORTAL_URL="$(discover PORTAL_URL)"
RUNNER_TOKEN="$(discover RUNNER_TOKEN)"

[ -n "$PORTAL_URL" ] && say "found portal: $PORTAL_URL" || { read -rp "Portal URL (https://…): " PORTAL_URL; }
[ -n "$RUNNER_TOKEN" ] && say "found runner token (…${RUNNER_TOKEN: -4})" || { read -rp "Runner token (rdr_…): " RUNNER_TOKEN; }
[ -n "$PORTAL_URL" ] && [ -n "$RUNNER_TOKEN" ] || die "Need PORTAL_URL and RUNNER_TOKEN (token is on the portal → Machines)."

# ── 2. Stop every existing runner (systemd + stray processes) ──
say "stopping any running / duplicate runners…"
sudo systemctl stop rdaisec-runner 2>/dev/null || true
pkill -f rdaisec_runner 2>/dev/null || true
sleep 1

# Remove old cron @reboot auto-starts that spawned extra copies.
if crontab -l 2>/dev/null | grep -qiE 'rdaisec_runner|\.rdaisec/run\.sh'; then
  say "removing old cron auto-start (it caused duplicates)…"
  crontab -l 2>/dev/null | grep -viE 'rdaisec_runner|\.rdaisec/run\.sh' | crontab - || true
fi

# ── 3. Stable copy of the runner, outside git (self-update can't clash) ──
mkdir -p "$STATE"
if [ -f "$HERE/rdaisec_runner.py" ]; then
  cp "$HERE/rdaisec_runner.py" "$DEST"
  say "installed runner from $HERE/rdaisec_runner.py"
elif [ ! -f "$DEST" ]; then
  say "fetching runner from the portal…"
  curl -fsSL -H "Authorization: Bearer $RUNNER_TOKEN" "$PORTAL_URL/api/runner/script" -o "$DEST" \
    || die "couldn't download the runner from $PORTAL_URL/api/runner/script — check the URL/token."
fi

printf 'PORTAL_URL=%s\nRUNNER_TOKEN=%s\n' "$PORTAL_URL" "$RUNNER_TOKEN" > "$CFG"
chmod 600 "$CFG"

# ── 4. Install as a systemd service (single instance, boot start, auto-restart) ──
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  say "installing the systemd service…"
  sudo tee /etc/systemd/system/rdaisec-runner.service >/dev/null <<EOF
[Unit]
Description=RD-AISEC Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
Environment=HOME=$HOME
Environment=GOPATH=$HOME/go
# A FULL PATH — a systemd service otherwise gets a minimal one that omits
# /usr/local/bin and ~/go/bin, so Go-based tools (subfinder/httpx/nuclei/katana/
# dalfox/naabu…) can't be found → they show "uninstalled" and their jobs fail.
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/go/bin:$HOME/.local/bin:/snap/bin
Environment=PORTAL_URL=$PORTAL_URL
Environment=RUNNER_TOKEN=$RUNNER_TOKEN
ExecStart=$PYTHON $DEST
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now rdaisec-runner
  sleep 2
  echo
  say "Done. One runner, auto-starts on boot, restarts on crash, self-updates."
  echo "  Watch live:  journalctl -u rdaisec-runner -f"
  echo "  Stop:        sudo systemctl stop rdaisec-runner"
  echo "  Start:       sudo systemctl start rdaisec-runner"
  echo
  sudo systemctl --no-pager status rdaisec-runner | head -n 10 || true
else
  # ── Fallback (no systemd): a restart loop + @reboot cron ──
  say "systemd not present — using a background restart loop instead…"
  cat > "$STATE/run.sh" <<EOF
#!/usr/bin/env bash
set -a; source "$CFG"; set +a
# Full PATH so Go-based tools (~/go/bin) + /usr/local/bin are found under cron.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/go/bin:$HOME/.local/bin:/snap/bin:\$PATH"
export GOPATH="$HOME/go"
while true; do "$PYTHON" "$DEST"; sleep 5; done
EOF
  chmod +x "$STATE/run.sh"
  ( crontab -l 2>/dev/null; echo "@reboot $STATE/run.sh >> $STATE/runner.log 2>&1" ) | crontab -
  nohup "$STATE/run.sh" >> "$STATE/runner.log" 2>&1 &
  say "Done. Running now + starts on boot. Logs: tail -f $STATE/runner.log"
fi

echo
say "The machine should show ONLINE on the portal within ~15 seconds."
