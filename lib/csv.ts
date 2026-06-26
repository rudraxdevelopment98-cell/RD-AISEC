// Tiny RFC-4180 CSV builder. Pure + dependency-free.

/** Escape one field: wrap in quotes if it contains a comma, quote, or newline. */
function escapeField(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a CSV string from a header row + data rows. Prefixed with a UTF-8 BOM
 * so Excel opens accented characters correctly. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(escapeField).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** A safe-ish filename slug (letters/numbers/dashes). */
export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "export"
  );
}
