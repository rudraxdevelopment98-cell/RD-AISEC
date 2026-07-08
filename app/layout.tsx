import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" suppressHydrationWarning>
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
