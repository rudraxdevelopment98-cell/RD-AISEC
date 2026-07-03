"use client";

/**
 * Root error boundary — the last line of defense if even the layout fails. Must
 * render its own <html>/<body>. Keeps the app from showing a blank white screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#03060d", color: "#e2e8f0", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div style={{ maxWidth: 520, margin: "12vh auto", padding: 24 }}>
          <div style={{ border: "1px solid rgba(239,68,68,0.3)", borderRadius: 16, padding: 20, background: "rgba(13,20,34,0.6)" }}>
            <h1 style={{ fontSize: 18, margin: 0 }}>Something went wrong</h1>
            <p style={{ color: "#94a3b8", fontSize: 13 }}>The portal hit an unexpected error. You can reload and continue.</p>
            {error?.message && (
              <pre style={{ marginTop: 12, maxHeight: 160, overflow: "auto", borderRadius: 10, background: "rgba(0,0,0,0.4)", padding: 12, fontSize: 11, color: "rgba(252,165,165,0.9)" }}>
                {error.message}
              </pre>
            )}
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button onClick={reset} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "#34d399", color: "#03210f", fontWeight: 600, cursor: "pointer" }}>Try again</button>
              <a href="/dashboard" style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid rgba(148,163,184,0.3)", color: "#e2e8f0", textDecoration: "none" }}>Dashboard</a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
