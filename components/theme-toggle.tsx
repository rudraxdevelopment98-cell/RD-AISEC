"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light" | "advance";

const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Basic dark theme" },
  { id: "light", label: "Basic light theme" },
  { id: "advance", label: "Advance (Neo azure) theme" },
];

function readTheme(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "advance" ? t : "dark";
}

/**
 * Global theme picker — an inline segmented control with the three skins the app
 * ships: Basic dark, Basic light, and Advance (the Neo azure operator
 * workspace). Switching flips `data-theme` on <html> (which re-skins everything
 * via the CSS-variable tokens) and persists the choice; pre-paint bootstrap lives
 * in app/layout.tsx.
 *
 * It renders inline (not a popover) on purpose: this lives inside FloatingControls,
 * whose strip is `overflow-hidden` and collapses on any click within it — a
 * dropdown would be clipped and the strip would snap shut before you could pick.
 * Segments sit in the row directly, and the wrapper stops click propagation so you
 * can flip between themes without the controls closing. Same export/props as before.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  function apply(next: Theme) {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  }

  const current = mounted ? theme : "dark";

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border border-surface-border bg-black/20 p-0.5 ${className}`}
    >
      {THEMES.map((t) => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={t.label}
            aria-label={t.label}
            onClick={() => apply(t.id)}
            className={`grid h-7 w-7 place-items-center rounded-full transition ${
              active
                ? "bg-brand/20 text-brand shadow-[inset_0_0_0_1px_rgb(var(--brand)/0.4)]"
                : "text-gray-400 hover:text-gray-100"
            }`}
          >
            <ThemeIcon theme={t.id} />
          </button>
        );
      })}
    </div>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") {
    // Sun
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (theme === "advance") {
    // Hexagon / operator glyph
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
        <path d="M12 2.5l8.5 4.9v9.2L12 21.5l-8.5-4.9V7.4z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  // Moon (dark)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
