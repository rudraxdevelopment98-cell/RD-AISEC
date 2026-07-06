#!/usr/bin/env python3
"""
RD-AISEC CSI collector — feeds the "WiFi camera".

Reads Channel State Information (CSI) frames from your hardware, normalises them
to the portal's CSI contract, batches them, and POSTs to /api/runner/csi using
your RUNNER token. The portal runs the imaging analysis (motion, Doppler
velocity, angle-of-arrival, range, breathing/heart, multi-target, 2D occupancy)
and the Sensing → WiFi Camera view polls the result.

Stdlib only — no pip installs. On Linux the serial port is opened as a file after
`stty` sets the baud, so pyserial isn't needed.

Sources (CSI_SOURCE env or --source):
  esp32:/dev/ttyUSB0@921600   ESP32-CSI-Tool CSV over serial (1 antenna → radial)
  udp:0.0.0.0:5566            any device sending JSON frames (see contract) to UDP
  selftest                    synthetic frames, to prove the pipe end-to-end

CSI contract (one JSON object per frame for the UDP source):
  {"t":<sec>,"rssi":<dBm>,"nsub":<N>,"nrx":<M>,
   "amp":[[...nsub...] x nrx], "phase":[[...nsub...] x nrx]}

Config is read from the same runner.env as the main runner (PORTAL_URL,
RUNNER_TOKEN). For authorized spaces only.
"""

import argparse
import json
import math
import os
import socket
import subprocess
import sys
import time
import urllib.request

RUNNER_VERSION = "csi-1"


def load_env():
    """Reuse the runner's env files so PORTAL_URL / RUNNER_TOKEN carry over."""
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (
        os.environ.get("RDAISEC_ENV", ""),
        os.path.join(here, "runner.env"),
        os.path.join(here, ".env"),
        os.path.expanduser("~/.config/rdaisec/runner.env"),
    ):
        if not path:
            continue
        try:
            with open(path, encoding="utf-8") as f:
                for raw in f:
                    line = raw.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
        except FileNotFoundError:
            continue
        except Exception:  # noqa: BLE001
            continue


def post_batch(portal, token, frames, band, room_m):
    body = json.dumps({"frames": frames, "band": band, "roomM": room_m}).encode()
    req = urllib.request.Request(f"{portal}/api/runner/csi", data=body, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Runner-Version", RUNNER_VERSION)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


# ── ESP32-CSI-Tool serial parser ────────────────────────────────────────────
# Lines look like:  CSI_DATA,<role>,<mac>,<rssi>,<rate>,<sig_mode>,...,<len>,[<int>,<int>,...]
# The trailing bracketed array is interleaved imag,real per subcarrier (1 antenna).
def esp32_frames(dev, baud, batch, band, room_m):
    try:
        subprocess.run(["stty", "-F", dev, str(baud), "raw", "-echo"], check=False)
    except Exception:  # noqa: BLE001
        pass
    frames = []
    t0 = time.time()
    with open(dev, "rb", buffering=0) as fh:
        buf = b""
        while True:
            chunk = fh.read(256)
            if not chunk:
                time.sleep(0.005)
                continue
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                s = line.decode("utf-8", "replace").strip()
                if "CSI_DATA" not in s or "[" not in s:
                    continue
                try:
                    head = s.split("[", 1)[0].split(",")
                    rssi = float(head[3]) if len(head) > 3 else None
                    arr = s.split("[", 1)[1].split("]", 1)[0]
                    vals = [int(x) for x in arr.replace(" ", "").split(",") if x.lstrip("-").isdigit()]
                except Exception:  # noqa: BLE001
                    continue
                if len(vals) < 8:
                    continue
                amp, phase = [], []
                for k in range(0, len(vals) - 1, 2):
                    im, re = vals[k], vals[k + 1]
                    amp.append(math.hypot(re, im))
                    phase.append(math.atan2(im, re))
                frames.append({
                    "t": round(time.time() - t0, 4),
                    "rssi": rssi,
                    "nsub": len(amp),
                    "nrx": 1,
                    "amp": [amp],
                    "phase": [phase],
                })
                if len(frames) >= batch:
                    yield frames
                    frames = []


# ── generic UDP JSON source ─────────────────────────────────────────────────
def udp_frames(host, port, batch, band, room_m):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((host, port))
    print(f"listening for CSI JSON on udp://{host}:{port}")
    frames = []
    while True:
        data, _ = sock.recvfrom(65535)
        try:
            f = json.loads(data.decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            continue
        if isinstance(f, dict) and isinstance(f.get("amp"), list):
            frames.append(f)
            if len(frames) >= batch:
                yield frames
                frames = []


# ── self-test synthetic source ──────────────────────────────────────────────
def selftest_frames(batch):
    fs, nsub, nrx = 20, 30, 2
    lam, d = 0.125, 0.0625
    az = math.radians(15.0)
    dphi = (2 * math.pi * d * math.sin(az)) / lam
    i = 0
    while True:
        frames = []
        for _ in range(batch):
            t = i / fs
            amp = [[], []]
            phase = [[], []]
            for k in range(nsub):
                base = 10 + 2 * math.sin(k) + 3 * math.sin(2 * math.pi * 1.0 * t + k * 0.2) + 0.9 * math.sin(2 * math.pi * 0.3 * t)
                amp[0].append(base)
                amp[1].append(base * 0.98)
                ph = (k * 0.1) % (2 * math.pi)
                phase[0].append(ph)
                phase[1].append(ph + dphi)
            frames.append({"t": round(t, 4), "rssi": -50, "nsub": nsub, "nrx": nrx, "amp": amp, "phase": phase})
            i += 1
        yield frames
        time.sleep(batch / fs)


def main():
    load_env()
    ap = argparse.ArgumentParser(description="RD-AISEC CSI collector")
    ap.add_argument("--source", default=os.environ.get("CSI_SOURCE", "selftest"))
    ap.add_argument("--batch", type=int, default=int(os.environ.get("CSI_BATCH", "128")))
    ap.add_argument("--band", default=os.environ.get("CSI_BAND", "2.4"), choices=["2.4", "5"])
    ap.add_argument("--room", type=float, default=float(os.environ.get("CSI_ROOM_M", "8")))
    args = ap.parse_args()

    portal = os.environ.get("PORTAL_URL", "").rstrip("/")
    token = os.environ.get("RUNNER_TOKEN", "")
    if not portal or not token:
        print("Set PORTAL_URL and RUNNER_TOKEN (in runner.env or the environment).")
        sys.exit(1)

    src = args.source
    if src.startswith("esp32:"):
        spec = src[len("esp32:"):]
        dev, _, baud = spec.partition("@")
        gen = esp32_frames(dev, int(baud or 921600), args.batch, args.band, args.room)
    elif src.startswith("udp:"):
        spec = src[len("udp:"):]
        host, _, port = spec.partition(":")
        gen = udp_frames(host or "0.0.0.0", int(port or 5566), args.batch, args.band, args.room)
    elif src == "selftest":
        gen = selftest_frames(args.batch)
    else:
        print(f"Unknown source: {src}")
        sys.exit(1)

    print(f"CSI collector → {portal} (source={src}, batch={args.batch}, band={args.band} GHz)")
    for frames in gen:
        try:
            res = post_batch(portal, token, frames, args.band, args.room)
            print(
                f"  posted {len(frames)} frames · present={res.get('present')} "
                f"occ={res.get('occupancy')} v={res.get('velocityMps')}m/s "
                f"az={res.get('azimuthDeg')}° br={res.get('breathingBpm')} hr={res.get('heartBpm')}"
            )
        except Exception as e:  # noqa: BLE001
            print(f"  post failed: {e}")
            time.sleep(2)


if __name__ == "__main__":
    main()
