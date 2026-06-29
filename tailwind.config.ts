import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ProjectDiscovery-style: deep near-black canvas + crisp white primary
        // buttons (see .btn-primary) + a clean green accent used SPARINGLY for
        // links, active nav, status and progress. Not a green wash — the canvas
        // and backdrops stay near-monochrome; green is the single bright accent.
        brand: {
          DEFAULT: "#34d399",
          dark: "#10b981",
          glow: "#6ee7b7",
        },
        surface: {
          DEFAULT: "#08090c",
          card: "#101216",
          border: "#222730",
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
