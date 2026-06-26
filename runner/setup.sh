#!/usr/bin/env bash
# RD-AISEC runner setup — save PORTAL_URL + RUNNER_TOKEN permanently, and
# (optionally) install a systemd service so the runner starts on boot and
# restarts itself. Run once:  bash setup.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$HOME/.config/rdaisec"
ENV_FILE="$ENV_DIR/runner.env"

echo "── RD-AISEC runner setup ─────────────────────────────"

# 1) Collect config (keep existing values as defaults if the file exists).
EXIST_URL=""
EXIST_TOKEN=""
if [ -f "$ENV_FILE" ]; then
  EXIST_URL="$(grep -E '^PORTAL_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  EXIST_TOKEN="$(grep -E '^RUNNER_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
fi

read -r -p "Portal URL [${EXIST_URL:-https://rd-aisec.vercel.app}]: " PORTAL_URL
PORTAL_URL="${PORTAL_URL:-${EXIST_URL:-https://rd-aisec.vercel.app}}"

read -r -p "Runner token [${EXIST_TOKEN:+(keep existing)}]: " RUNNER_TOKEN
RUNNER_TOKEN="${RUNNER_TOKEN:-$EXIST_TOKEN}"

if [ -z "$RUNNER_TOKEN" ]; then
  echo "✗ A runner token is required (create one on the portal → Machines)."
  exit 1
fi

read -r -p "Max concurrent jobs [3]: " MAX_WORKERS
MAX_WORKERS="${MAX_WORKERS:-3}"

# 2) Write the config file (chmod 600 — it holds your token).
mkdir -p "$ENV_DIR"
cat > "$ENV_FILE" <<EOF
PORTAL_URL=$PORTAL_URL
RUNNER_TOKEN=$RUNNER_TOKEN
MAX_WORKERS=$MAX_WORKERS
EOF
chmod 600 "$ENV_FILE"
echo "✓ Saved config to $ENV_FILE"
echo "  The runner loads this automatically — no more export needed."

# 3) Optional: install a systemd service for boot + auto-restart.
if ! command -v systemctl >/dev/null 2>&1; then
  echo
  echo "systemd not found. Start the runner manually with:"
  echo "  python3 \"$SCRIPT_DIR/rdaisec_runner.py\""
  exit 0
fi

read -r -p "Install a systemd service so it starts on boot? [y/N]: " INSTALL_SVC
case "$INSTALL_SVC" in
  y|Y|yes|YES)
    PY="$(command -v python3)"
    UNIT=/etc/systemd/system/rdaisec-runner.service
    echo "Writing $UNIT (needs sudo)…"
    sudo tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=RD-AISEC runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$SCRIPT_DIR
ExecStart=$PY $SCRIPT_DIR/rdaisec_runner.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable --now rdaisec-runner
    echo "✓ Service installed and started."
    echo "  Status:  sudo systemctl status rdaisec-runner"
    echo "  Logs:    journalctl -u rdaisec-runner -f"
    echo "  Stop:    sudo systemctl disable --now rdaisec-runner"
    ;;
  *)
    echo
    echo "Skipped. Start the runner manually anytime with:"
    echo "  python3 \"$SCRIPT_DIR/rdaisec_runner.py\""
    ;;
esac
