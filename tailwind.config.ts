import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Calm, desaturated cool-slate accent (was loud emerald green). Keeps the
        // UI mostly monochrome so the liquid-glass frost is the main look, not a
        // wash of colour. Semantic status colours (red/amber/emerald/sky) stay
        // vivid since they carry meaning and are used sparingly.
        brand: {
          DEFAULT: "#9db4c4",
          dark: "#6f8696",
          glow: "#c3d4df",
        },
        surface: {
          DEFAULT: "#0b0f17",
          card: "#111827",
          border: "#1f2937",
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
