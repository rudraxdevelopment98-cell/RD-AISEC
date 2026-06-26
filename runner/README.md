# RD-AISEC Runner

The **runner** is the "hands" of RD-AISEC. The portal (cloud) only *queues* jobs;
this small agent runs on a machine **you control and are authorized to use** —
typically a **Kali VM in UTM** on your external SSD — polls the portal over
HTTPS, runs an allowlisted tool locally, and posts the output back. The portal
turns that output into findings.

> The cloud app never runs offensive tools. Execution stays on your authorized
> infrastructure. **For authorized security testing and education only.**

```
Portal (Vercel)  ──queues Job──►  [ waits in queue ]
Runner (Kali)    ──polls GET /api/runner/job──►  runs tool  ──POST result──►  Portal → Findings
```

## 1. Create a runner in the portal

1. Open **Dashboard → Runners**.
2. Under **Register a runner**, give it a name (e.g. `Kali-UTM-SSD`) and click
   **Create runner**.
3. **Copy the token immediately** — it is shown only once (only its hash is
   stored).

## 2. Set up the Kali VM (UTM)

1. Install UTM and a Kali Linux VM. Keeping the VM on your external SSD is fine —
   UTM runs it from wherever the disk image lives.
2. Make sure the tools you want are installed. On Kali:
   ```bash
   sudo apt update
   sudo apt install -y nmap whois dnsutils sqlmap nikto wpscan sslscan tor torsocks curl
   # ProjectDiscovery tools (optional): httpx, nuclei
   # e.g. via their installers / go install; ensure they're on PATH
   # (On Kali, most of these are preinstalled.)
   ```
3. Copy `rdaisec_runner.py` into the VM (clone the repo, or scp the single file).
   It uses only the Python 3 standard library — nothing to `pip install`.

## 3. Run the agent

### Easiest: one-time setup (config saved permanently + auto-start)

```bash
bash setup.sh
```

This asks for your **Portal URL** and **Runner token**, saves them to
`~/.config/rdaisec/runner.env` (so you never have to `export` them again — even
after closing the terminal or rebooting), and can install a **systemd service**
that starts the runner on boot and restarts it if it crashes.

- Status: `sudo systemctl status rdaisec-runner`
- Live logs: `journalctl -u rdaisec-runner -f`
- Stop/disable: `sudo systemctl disable --now rdaisec-runner`

To change settings later, re-run `bash setup.sh` or edit
`~/.config/rdaisec/runner.env`, then `sudo systemctl restart rdaisec-runner`.

### Or run it manually

The runner auto-loads `runner.env` (next to the script) or
`~/.config/rdaisec/runner.env`, so you can just create that file once:

```bash
cp runner.env.example runner.env   # edit PORTAL_URL + RUNNER_TOKEN
python3 rdaisec_runner.py
```

…or set the variables inline (overrides the file):

```bash
export PORTAL_URL="https://rd-aisec.vercel.app"   # your deployed portal
export RUNNER_TOKEN="rdr_...."                     # the token from step 1
python3 rdaisec_runner.py
```

You should see `Polling for jobs…`. Back in the portal the runner flips to
**online**. Queue a job (e.g. `nmap` → *Quick* against `scanme.nmap.org`) and
watch it run, then **Import to findings**.

### Run it as a background service (optional)

```bash
# quick + dirty: tmux
tmux new -s rdaisec 'PORTAL_URL=... RUNNER_TOKEN=... python3 rdaisec_runner.py'

# or a systemd user service — create ~/.config/systemd/user/rdaisec-runner.service
```

## Environment variables

| Variable       | Required | Default | Meaning                                  |
|----------------|----------|---------|------------------------------------------|
| `PORTAL_URL`   | yes      | —       | Base URL of your deployed portal         |
| `RUNNER_TOKEN` | yes      | —       | Token shown once when you created the runner |
| `POLL_SECONDS` | no       | `5`     | How often to poll when idle              |
| `JOB_TIMEOUT`  | no       | `900`   | Max seconds a single job may run         |

## Allowlisted tools

The runner only executes these, via `argv` (never a shell). Targets and args are
re-validated against a strict character set, so a malformed value can't become an
injection. This list mirrors `lib/runner-constants.ts` in the portal:

| Tool      | Purpose                          | Target passed as | Auto-findings |
|-----------|----------------------------------|------------------|---------------|
| `nmap`    | Port & service scan              | last argument    | ✅ open ports |
| `httpx`   | HTTP probe (title/status/tech)   | `-u <target>`    | ✅ live service |
| `nuclei`  | Templated vuln/exposure checks   | `-u <target>`    | ✅ per match |
| `sqlmap`  | SQL injection (give a URL with a param, e.g. `?id=1`) | `-u <url>` | ✅ injection points |
| `nikto`   | Web server scan (issues/misconfig) | `-h <url>`     | ✅ summary |
| `wpscan`  | WordPress enumeration            | `--url <url>`    | — (manual) |
| `sslscan` | TLS/SSL configuration            | last argument    | — (manual) |
| `whois`   | Registration lookup (passive)    | last argument    | — (manual) |
| `dig`     | DNS records (passive)            | last argument    | — (manual) |

> **sqlmap needs a parameter to test.** Point it at a URL with a query parameter
> (e.g. `https://site/product.php?id=1`), or use the *Crawl* / *Test forms*
> preset so it can discover parameters itself.

**Self-updating allowlist.** The runner fetches its tool list from the portal
(`GET /api/runner/tools`) at startup and every `TOOL_REFRESH` seconds (default
300), and re-checks immediately if it sees an unknown tool. So when a new tool is
added to the portal, it works here **without re-pulling this script** — you only
need the binary installed (`sudo apt install -y <tool>`). The list above is the
built-in fallback used when the portal can't be reached.

To add a tool: add it to `RUNNER_TOOLS` in `lib/runner-constants.ts` (portal) and
to `TOOLS` in `rdaisec_runner.py` (runner). Add a parser in `lib/job-parser.ts`
if you want its output auto-converted to findings.

## Anonymity (Tor)

Toggle **🧅 Turn on Tor** for a runner in the portal (Dashboard → Runners). On the
next poll the runner ensures a Tor SOCKS proxy is up (reuses a running one on
`127.0.0.1:9050`, or starts `tor` itself) and wraps every tool with `torsocks`
so its traffic exits through the Tor network. The portal shows the reported
**exit IP**. Requires `tor`, `torsocks`, and `curl` installed.

> ⚠️ **Tor only carries TCP-connect traffic.** Web tools (httpx, nuclei, sqlmap,
> nikto, wpscan) and `whois` work well. **nmap** must use a connect scan
> (`-sT`) with `-Pn` — SYN scans, ping sweeps (`-sn`), and UDP/`dig` won't route
> through Tor. Use anonymity for web/app testing, not raw port/network sweeps.
> Tor is also much slower; scans will take longer.

## Installing tools (and sudo)

Approve installs from the portal (Machines → a machine → Install tools, or the
"Installations needed" panel). The runner runs `apt-get install` for an
allowlisted package only. Installing needs root — pick one, **all keep the
password on this machine, never in the portal**:

1. **Run the runner as root** (simplest on Kali):
   ```bash
   sudo PORTAL_URL=... RUNNER_TOKEN=... python3 runner/rdaisec_runner.py
   ```
2. **Give a sudo password locally** via env var (the runner pipes it to `sudo -S`):
   ```bash
   export RUNNER_SUDO_PASS='your-kali-password'
   python3 runner/rdaisec_runner.py
   ```
3. **Passwordless sudo for apt** (no password anywhere):
   ```bash
   echo "$USER ALL=(root) NOPASSWD: /usr/bin/apt-get" | sudo tee /etc/sudoers.d/rdaisec-apt
   ```

> **Do not** enter a sudo password into the portal — it's your machine's root
> credential and the cloud should never hold it. `RUNNER_SUDO_PASS` lives only in
> this machine's environment.

> `httpx` is not an apt package on Kali (it ships as `httpx-toolkit` with a
> different binary) — install it manually. Everything else installs from the portal.

## Safety model

- **Authorization gate:** a job can only be queued for an engagement marked
  *authorized*, and the target host must be within the engagement's scope.
- **Allowlist + validation:** unknown tools are refused; targets/args with shell
  metacharacters are rejected on both the portal and the runner.
- **Revocable token:** delete the runner in the portal to revoke its access.
- **Audit:** every job records who queued it, when, the exact command, and the
  full output.
