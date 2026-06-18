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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
