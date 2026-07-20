import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * One-command runner install. Returns a self-contained bash script (with the
 * enrollment code baked in) that writes the runner + installer to a temp dir and
 * runs the installer — no git, no repo, no env vars, no multi-line paste.
 *
 *   curl -fsSL "https://<portal>/api/runner/bootstrap?code=rde_…" | sudo bash
 *
 * Public by design: the enrollment code IS the credential (the same one the
 * runner later presents to /api/runner/enroll), and the runner source is open —
 * it contains no secrets. The `code` is format-validated so it can't inject shell.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim();
  const portal = url.origin;

  // Only allow a well-formed enrollment code — this value is embedded into the
  // returned shell script, so restrict it to safe characters (no shell metachars).
  if (!/^rde_[A-Za-z0-9]{8,80}$/.test(code)) {
    return new NextResponse(
      "# Missing or malformed ?code= — copy the exact command from the portal (Runners → Add a machine).\n",
      { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  let runner = "";
  let installer = "";
  try {
    const base = path.join(process.cwd(), "runner");
    [runner, installer] = await Promise.all([
      readFile(path.join(base, "rdaisec_runner.py"), "utf8"),
      readFile(path.join(base, "install-runner.sh"), "utf8"),
    ]);
  } catch {
    return new NextResponse("# Runner source is unavailable on the portal right now.\n", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Interpolated values (portal, code, runner, installer) are inserted verbatim;
  // any $ or backticks inside them are plain characters, not re-parsed. Everything
  // else uses $VAR / $(...) so it stays literal bash in the output.
  const script = `#!/usr/bin/env bash
# ── RD-AISEC one-command runner install ──────────────────────────────────────
# Connects THIS machine to your RD-AISEC portal. It self-enrolls for a token and
# re-heals it automatically, so you never touch a token or systemd by hand.
set -euo pipefail
PORTAL="${portal}"
CODE="${code}"

echo "→ RD-AISEC: connecting this machine…"
if ! command -v python3 >/dev/null 2>&1; then
  echo "✗ python3 is required. Install it first:  sudo apt-get install -y python3"
  exit 1
fi

DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT

cat > "$DIR/rdaisec_runner.py" <<'__RD_RUNNER_EOF__'
${runner}
__RD_RUNNER_EOF__

cat > "$DIR/install-runner.sh" <<'__RD_INSTALLER_EOF__'
${installer}
__RD_INSTALLER_EOF__

cd "$DIR"
RUNNER_ENROLL_CODE="$CODE" PORTAL_URL="$PORTAL" bash install-runner.sh
echo "✓ Done — this machine should now show ONLINE on the portal (Runners)."
`;

  return new NextResponse(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
