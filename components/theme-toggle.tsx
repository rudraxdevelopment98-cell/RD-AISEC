"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

/**
 * Global light/dark toggle. Flips `data-theme` on <html> (which re-skins the
 * whole app via the CSS variable tokens) and persists the choice to
 * localStorage. The initial attribute is set pre-paint by the inline script in
 * app/layout.tsx, so there's no flash; this component just reflects + updates it.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current =
      (document.documentElement.getAttribute("data-theme") as Theme | null) ?? "dark";
    setTheme(current === "light" ? "light" : "dark");
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  }

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label="Toggle colour theme"
      aria-pressed={!isDark}
      className={`grid h-9 w-9 place-items-center rounded-xl border border-surface-border text-gray-300 transition hover:border-brand hover:text-brand ${className}`}
    >
      {/* Render a stable icon until mounted to avoid a hydration mismatch. */}
      {mounted && !isDark ? (
        // Sun (currently light → click for dark)
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // Moon (dark → click for light)
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
