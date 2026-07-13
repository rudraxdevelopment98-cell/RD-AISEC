#!/usr/bin/env bash
#
# Completely remove the RD-AISEC runner from this machine — a true clean slate.
# Stops & deletes the service, kills every runner process, removes cron
# auto-starts and all runner files. Safe to run even if some pieces aren't there.
#
#     bash runner/uninstall-runner.sh
#
set -uo pipefail
say() { printf '\033[1;32m→\033[0m %s\n' "$*"; }

say "stopping and removing the systemd service…"
sudo systemctl stop rdaisec-runner 2>/dev/null || true
sudo systemctl disable rdaisec-runner 2>/dev/null || true
sudo rm -f /etc/systemd/system/rdaisec-runner.service
sudo systemctl daemon-reload 2>/dev/null || true
sudo systemctl reset-failed rdaisec-runner 2>/dev/null || true

say "killing any stray runner processes…"
pkill -9 -f rdaisec_runner 2>/dev/null || true
pkill -9 -f '.rdaisec/run.sh' 2>/dev/null || true

say "removing cron auto-starts…"
if crontab -l 2>/dev/null | grep -qiE 'rdaisec_runner|\.rdaisec/run\.sh'; then
  crontab -l 2>/dev/null | grep -viE 'rdaisec_runner|\.rdaisec/run\.sh' | crontab - 2>/dev/null || true
fi

say "removing runner files…"
rm -rf "$HOME/.rdaisec"

echo
say "Done — the runner is fully removed from this machine."
echo "   Reinstall fresh with:"
echo "     PORTAL_URL=\"https://YOUR-PORTAL\" RUNNER_TOKEN=\"rdr_YOUR_TOKEN\" bash runner/install-runner.sh"
