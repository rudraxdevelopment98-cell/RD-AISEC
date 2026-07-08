import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Operator typefaces for the Advance skin (self-hosted by next/font — no runtime
// external request). Exposed as CSS variables; globals.css opts the advance theme
// into them. Basic keeps the system stack.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", display: "swap" });

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
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jbmono.variable}`}>
      <head>
        {/* Set the theme before first paint so there's no flash of the wrong
            theme. Defaults to dark (the app's signature). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var v=(t==='light'||t==='advance')?t:'dark';document.documentElement.setAttribute('data-theme',v);}catch(e){}})();",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
