"""Detection knowledge for the checks — kept as data so it is easy to extend.

Everything here is heuristic and deliberately conservative: the scanner is a
static, pre-runtime check, so it favours flagging a suspicious *surface* and
explaining why, rather than claiming certainty. Tune these tables as the
Attack Range grows.
"""
from __future__ import annotations

import re

# --- C1: hidden / imperative instructions in a tool description -------------
# Each entry: (compiled regex, weight). Higher weight = stronger signal.
# A description's score is the sum of matched weights; severity scales with it.

INSTRUCTION_PATTERNS: list[tuple[re.Pattern[str], int, str]] = [
    # Markup that smuggles instructions into metadata the user never reads.
    (re.compile(r"<\s*important\s*>", re.I), 3, "<IMPORTANT> instruction block"),
    (re.compile(r"<\s*system\s*>", re.I), 3, "<system> instruction block"),
    (re.compile(r"<!--.*?-->", re.I | re.S), 2, "HTML comment hiding text"),
    (re.compile(r"\[\s*(system|instruction)s?\s*\]", re.I), 2, "[system]/[instructions] marker"),
    # Direct imperative steering of the model.
    (re.compile(r"\byou must\b", re.I), 2, "imperative 'you must'"),
    (re.compile(r"\b(before|prior to) (answering|responding|replying)\b", re.I), 3,
     "pre-answer directive"),
    (re.compile(r"\b(always|first|immediately) call\b", re.I), 2, "directive to call a tool"),
    (re.compile(r"\bignore (the |all |any )?(previous|above|prior)\b", re.I), 3,
     "instruction to ignore prior context"),
    (re.compile(r"\bas an ai\b", re.I), 1, "role-spoofing phrase"),
    # Secrecy / exfiltration framing.
    (re.compile(r"\bdo not (mention|tell|reveal|say|disclose)\b", re.I), 3,
     "secrecy instruction"),
    (re.compile(r"\b(don't|do not) (let|inform) the user\b", re.I), 3, "hide-from-user instruction"),
    (re.compile(r"\bwithout (telling|informing|notifying)\b", re.I), 3, "covert-action instruction"),
    (re.compile(r"\bsilently\b", re.I), 2, "covert-action phrase"),
    (re.compile(r"\b(append|include|add) (its |the )?(contents|output|result)\b", re.I), 2,
     "instruction to append other data to the reply"),
    # Other-tool references inside a description (cross-tool steering).
    (re.compile(r"\bcall (read_file|run_command|exec|the \w+ tool)\b", re.I), 2,
     "names another tool to invoke"),
]

# Encoded-blob heuristic (long base64-ish run) — often used to hide a payload.
BASE64_BLOB = re.compile(r"[A-Za-z0-9+/]{40,}={0,2}")

# Characters that have no business in a human-readable description: zero-width
# and other invisible/control formatting often used to hide injected text.
INVISIBLE_CHARS = re.compile(
    "[​‌‍⁠﻿‪-‮⁦-⁩]"
)


# --- C2 / C3: capability inference from tool name, params, description ------
# Capability -> keyword list. Matched against the tool name, param names, and
# (lightly) the description verbs. Drives both the "over-broad permission"
# check and the "dangerous combination" check.

CAPABILITY_KEYWORDS: dict[str, list[str]] = {
    "fs_read": ["read_file", "readfile", "read", "cat", "open", "load", "get_file", "file_get"],
    "fs_write": ["write", "save", "put_file", "edit", "append_file", "create_file"],
    "fs_delete": ["delete", "remove", "rm", "unlink", "rmdir"],
    "exec": ["run_command", "exec", "execute", "shell", "system", "subprocess",
             "command", "bash", "sh", "eval", "spawn", "popen"],
    "network": ["fetch", "http", "https", "request", "curl", "url", "download",
                "upload", "webhook", "post", "send", "get_url", "browse"],
    "secrets": ["env", "getenv", "secret", "token", "credential", "password",
                "apikey", "api_key", "private_key", "ssh_key"],
    "database": ["sql", "query", "db_", "database", "psql", "mysql", "mongo"],
}

# Human label + base severity for an over-broad capability (C2).
CAPABILITY_RISK: dict[str, tuple[str, str]] = {
    "exec": ("arbitrary command / code execution", "critical"),
    "fs_delete": ("file deletion", "high"),
    "fs_write": ("arbitrary file write", "high"),
    "secrets": ("access to secrets / credentials / environment", "high"),
    "database": ("direct database access", "medium"),
    # Base LOW: a file-read tool is common and expected. An *unconstrained* path
    # param escalates it to MEDIUM (see UNCONSTRAINED_PARAMS); hidden-instruction
    # poisoning (C1) is what separates a malicious reader from a benign one.
    "fs_read": ("arbitrary file read", "low"),
    "network": ("outbound network access", "low"),
}

# Param names that signal an *unconstrained* target for a capability.
UNCONSTRAINED_PARAMS: dict[str, list[str]] = {
    "fs_read": ["path", "file", "filename", "filepath"],
    "fs_write": ["path", "file", "filename", "filepath"],
    "fs_delete": ["path", "file", "filename", "filepath"],
    "exec": ["command", "cmd", "code", "script", "args"],
    "network": ["url", "uri", "host", "endpoint", "address"],
}

# --- C3: dangerous capability pairs (server-level) --------------------------
# (cap_a, cap_b, severity, why)
DANGEROUS_COMBOS: list[tuple[str, str, str, str]] = [
    ("secrets", "network", "critical",
     "a tool can read secrets and another can send data out — classic exfiltration path"),
    ("fs_read", "network", "high",
     "file-read + outbound network: file contents can be exfiltrated"),
    ("network", "exec", "high",
     "fetched (untrusted) content + command execution: cross-tool escalation surface"),
    ("fs_read", "exec", "high",
     "file-read + execution: read-then-run host control surface"),
    ("fs_write", "exec", "high",
     "file-write + execution: drop-and-run host control surface"),
]
