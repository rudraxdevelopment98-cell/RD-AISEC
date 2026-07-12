import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // Theme is driven by `data-theme` on <html> (see app/globals.css tokens). The
  // whole palette below is variable-backed so switching that attribute re-skins
  // every utility class; `darkMode: ["selector"]` lets `dark:` variants target
  // the default (dark) theme if ever needed.
  darkMode: ["selector", ':root:not([data-theme="light"])'],
  theme: {
    extend: {
      colors: {
        // Variable-driven so both themes share one design. `rgb(var(--x) /
        // <alpha-value>)` keeps Tailwind's opacity modifiers working.
        // Green stays the single bright accent; canvas + surfaces flip per theme.
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          dark: "rgb(var(--brand-dark) / <alpha-value>)",
          glow: "rgb(var(--brand-glow) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          card: "rgb(var(--surface-card) / <alpha-value>)",
          border: "rgb(var(--surface-border) / <alpha-value>)",
        },
        // Semantic severity — one tokenized scale for both themes, so badges and
        // stripes stop hardcoding red/orange/amber and needing light-mode overrides.
        sev: {
          crit: "rgb(var(--sev-crit) / <alpha-value>)",
          high: "rgb(var(--sev-high) / <alpha-value>)",
          med: "rgb(var(--sev-med) / <alpha-value>)",
          low: "rgb(var(--sev-low) / <alpha-value>)",
          ok: "rgb(var(--sev-ok) / <alpha-value>)",
          info: "rgb(var(--sev-info) / <alpha-value>)",
        },
        // white/black are SWAPPED in light mode (see tokens) so text-white,
        // bg-white/N, bg-black/N and border-white/N all invert automatically.
        white: "rgb(var(--white) / <alpha-value>)",
        black: "rgb(var(--black) / <alpha-value>)",
        // gray ramp is INVERTED in light mode so text-gray-100 stays "primary".
        gray: {
          50: "rgb(var(--gray-50) / <alpha-value>)",
          100: "rgb(var(--gray-100) / <alpha-value>)",
          200: "rgb(var(--gray-200) / <alpha-value>)",
          300: "rgb(var(--gray-300) / <alpha-value>)",
          400: "rgb(var(--gray-400) / <alpha-value>)",
          500: "rgb(var(--gray-500) / <alpha-value>)",
          600: "rgb(var(--gray-600) / <alpha-value>)",
          700: "rgb(var(--gray-700) / <alpha-value>)",
          800: "rgb(var(--gray-800) / <alpha-value>)",
          900: "rgb(var(--gray-900) / <alpha-value>)",
          950: "rgb(var(--gray-950) / <alpha-value>)",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
