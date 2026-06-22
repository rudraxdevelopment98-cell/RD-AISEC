/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
