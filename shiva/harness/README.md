# Shiva Harness 🎯📊

A **detection benchmark**: score the [scanner](../scanner) and [gateway](../gateway)
against the [Attack Range](../attack-range) and report **detection rate** and
**false-positive rate**.

This is the gateway architecture's rule made executable — *measure the
false-positive rate on the Attack Range before arming any auto-block* — and the
"prove it works" artifact behind Shiva's claims (the same way an autonomous
pentest tool quotes "N verified findings", Shiva quotes its detection rate on a
public, reproducible MCP-attack benchmark).

## Run

No install needed (it finds the sibling packages automatically):

```bash
cd shiva/harness
python -m shiva_harness            # text scorecard
python -m shiva_harness --json     # machine-readable (for CI / the portal)
python -m shiva_harness --range /path/to/attack-range
```

Exit code `0` when every case passes (full detection, zero false positives),
else `1` — so it's also a **regression gate** in CI: a change that breaks
detection or starts flagging the benign baseline fails the build.

## Current scorecard

```
  case                         label      maxsev    gateway   result
  ----------------------------------------------------------------------
  benign baseline              benign     medium    —         ✓ pass
  tool poisoning               malicious  critical  BLOCK     ✓ pass
  description drift / rug-pull malicious  high      —         ✓ pass
  cross-tool escalation        malicious  critical  —         ✓ pass

  Detection rate : 3/3 (100%)   False positives: 0/1 (0%)
```

## How it scores

Each row in [`cases.py`](shiva_harness/cases.py) labels an Attack Range server:
`malicious` (which scanner check should fire, and whether the gateway should
block a specific tool in enforce mode) or `benign` (must not be flagged HIGH+).
[`runner.py`](shiva_harness/runner.py) runs the real scanner + gateway over each
and tallies:

- **Detection rate** — malicious servers whose expected check fired.
- **False-positive rate** — benign servers wrongly flagged HIGH or above.
- **Gateway enforcement** — for single-tool attacks (poisoning), that
  `--mode enforce` actually blocks the call.

Add a server to the Attack Range + a row in `cases.py` and it's scored
automatically.

## Test

```bash
python -m unittest discover -s tests
```
