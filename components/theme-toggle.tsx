"use client";

import { useEffect, useRef, useState } from "react";

type Theme = "dark" | "light" | "advance";

const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: "dark", label: "Basic · Dark", hint: "Emerald liquid-glass (signature)" },
  { id: "light", label: "Basic · Light", hint: "Frosted white glass" },
  { id: "advance", label: "Advance", hint: "Neo azure operator workspace" },
];

function readTheme(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "advance" ? t : "dark";
}

/**
 * Global theme picker. Switches between the two skins the app ships — Basic
 * (dark/light liquid-glass) and Advance (the Neo azure operator workspace) — by
 * flipping `data-theme` on <html> (which re-skins everything via the CSS-variable
 * tokens) and persisting the choice. Pre-paint bootstrap lives in app/layout.tsx;
 * this reflects + updates it. Same export name/props as before, so every existing
 * placement keeps working — it just gained a third option.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function apply(next: Theme) {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
    setOpen(false);
  }

  const current = mounted ? theme : "dark";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Change theme"
        aria-label="Change colour theme"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`grid h-9 w-9 place-items-center rounded-xl border border-surface-border text-gray-300 transition hover:border-brand hover:text-brand ${className}`}
      >
        <ThemeIcon theme={current} />
      </button>

      {open && (
        <div
          role="menu"
          className="glass-panel absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-surface-border p-1.5 shadow-2xl"
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Theme
          </div>
          {THEMES.map((t) => {
            const active = current === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => apply(t.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                  active ? "nav-link-active" : "nav-link"
                }`}
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-surface-border">
                  <ThemeIcon theme={t.id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-tight">{t.label}</span>
                  <span className="block truncate text-[11px] leading-tight text-gray-500">{t.hint}</span>
                </span>
                {active && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4 shrink-0" aria-hidden>
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
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
