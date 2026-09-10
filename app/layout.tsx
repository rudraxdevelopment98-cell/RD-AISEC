import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

// Self-hosted (next/font downloads at build + serves from our own origin, so the
// strict CSP's font-src 'self' stays intact — no external font requests).
// Inter: the clean, contemporary UI/body face. Fraunces: a classic, luxurious
// display serif for hero + section headings and hero numerals.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RD-AISEC — AI Cybersecurity Dashboard",
  description:
    "AI-powered cybersecurity learning & practice dashboard. Learn how to test, exploit, protect, find, and fix — for authorized security work.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${fraunces.variable}`}>
      <head>
        {/* Set the theme before first paint so there's no flash of the wrong
            theme. Defaults to dark (the app's signature). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){}})();",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
