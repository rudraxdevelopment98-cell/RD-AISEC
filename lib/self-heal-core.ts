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
const TIMED_OUT =
  /timed out after \d+s|No result received in time|runner stopped responding|the tool hung/i;
const TRANSIENT =
  /connection reset|temporary failure in name resolution|connection refused|could not resolve host|network is unreachable|TLS handshake timeout|i\/o timeout/i;

/**
 * Classify a failed job's output/exit code into a recovery action:
 *   install_retry — a tool was missing; install it then re-run
 *   retry         — transient (timeout, network blip, dead runner); just re-run
 *   none          — a real failure (not auto-recoverable)
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
  if (input.exitCode === 124 || TIMED_OUT.test(out)) {
    return { recoverable: true, cause: "timed out / runner stopped responding", action: "retry" };
  }
  if (TRANSIENT.test(out)) {
    return { recoverable: true, cause: "transient network error", action: "retry" };
  }
  return { recoverable: false, cause: "not auto-recoverable", action: "none" };
}
