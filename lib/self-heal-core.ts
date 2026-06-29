// Pure failure diagnosis for the self-healing auto-retry. No prisma/Node, so it
// is unit-testable and shareable.

// How many times the portal will auto-retry one piece of work before giving up.
export const MAX_AUTO_RETRIES = 2;

export type Diagnosis = {
  recoverable: boolean;
  cause: string;
  action: "install_retry" | "retry" | "none";
  tool?: string;
};

const NOT_INSTALLED =
  /not installed on this runner|isn't installed|command not found|: not found|No such file or directory/i;
// A runner/portal-side stall (the runner died or never reported) — genuinely
// transient, worth a re-run. Distinct from a tool exhausting its own time budget.
const STALLED = /No result received in time|runner stopped responding|the tool hung/i;
const TRANSIENT =
  /connection reset|temporary failure in name resolution|connection refused|could not resolve host|network is unreachable|TLS handshake timeout|i\/o timeout/i;

/**
 * Classify a failed job's output/exit code into a recovery action:
 *   install_retry — a tool was missing; install it then re-run
 *   retry         — transient (network blip, runner died mid-job); just re-run
 *   none          — a real failure, OR a tool that exhausted its time budget
 *                   (re-running with the same args would just time out again —
 *                   the partial results were already imported by the result route)
 */
export function diagnoseFailure(input: {
  tool: string;
  output: string;
  exitCode: number | null;
}): Diagnosis {
  const out = input.output || "";
  if (input.exitCode === 127 || NOT_INSTALLED.test(out)) {
    return {
      recoverable: true,
      cause: "tool not installed on the runner",
      action: "install_retry",
      tool: input.tool,
    };
  }
  // The tool ran its full per-tool timeout (exit 124). Re-running it would hit the
  // same wall and burn another 30 min for nothing, so don't auto-retry — the
  // result route already keeps whatever partial output it produced.
  if (input.exitCode === 124) {
    return {
      recoverable: false,
      cause: "ran its full time budget — narrow the scope or raise the timeout",
      action: "none",
    };
  }
  // A genuinely transient stall: the runner died or never reported back.
  if (STALLED.test(out)) {
    return { recoverable: true, cause: "runner stopped responding mid-job", action: "retry" };
  }
  if (TRANSIENT.test(out)) {
    return { recoverable: true, cause: "transient network error", action: "retry" };
  }
  return { recoverable: false, cause: "not auto-recoverable", action: "none" };
}
