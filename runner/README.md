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
   sudo apt install -y nmap whois dnsutils       # nmap, whois, dig
   # ProjectDiscovery tools (optional): httpx, nuclei
   # e.g. via their installers / go install; ensure they're on PATH
   ```
3. Copy `rdaisec_runner.py` into the VM (clone the repo, or scp the single file).
   It uses only the Python 3 standard library — nothing to `pip install`.

## 3. Run the agent

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

| Tool     | Purpose                          | Target passed as |
|----------|----------------------------------|------------------|
| `nmap`   | Port & service scan              | last argument    |
| `httpx`  | HTTP probe (title/status/tech)   | `-u <target>`    |
| `nuclei` | Templated vuln/exposure checks   | `-u <target>`    |
| `whois`  | Registration lookup (passive)    | last argument    |
| `dig`    | DNS records (passive)            | last argument    |

To add a tool: add it to `RUNNER_TOOLS` in `lib/runner-constants.ts` (portal) and
to `TOOLS` in `rdaisec_runner.py` (runner). Add a parser in `lib/job-parser.ts`
if you want its output auto-converted to findings.

## Safety model

- **Authorization gate:** a job can only be queued for an engagement marked
  *authorized*, and the target host must be within the engagement's scope.
- **Allowlist + validation:** unknown tools are refused; targets/args with shell
  metacharacters are rejected on both the portal and the runner.
- **Revocable token:** delete the runner in the portal to revoke its access.
- **Audit:** every job records who queued it, when, the exact command, and the
  full output.
