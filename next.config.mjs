// Security headers applied to every response (defense-in-depth for the portal).
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // don't advertise Next.js
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  experimental: {
    // Ensure the Markdown knowledge base is bundled with the server functions
    // that read it (the assistant API route and the assistant page).
    outputFileTracingIncludes: {
      "/api/assistant": ["./content/**/*"],
      "/dashboard/assistant": ["./content/**/*"],
      "/dashboard/knowledge": ["./content/**/*"],
      "/dashboard/knowledge/[slug]": ["./content/**/*"],
      "/dashboard/shiva": ["./shiva/docs/**/*"],
      "/dashboard/shiva/[slug]": ["./shiva/docs/**/*"],
    },
  },
};

export default nextConfig;
