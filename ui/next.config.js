/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for the multi-stage Docker build.
  // Generates .next/standalone/ with a self-contained server.js that runs
  // without the full Next.js package installed in the final image.
  output: "standalone",

  async rewrites() {
    return [
      {
        // Proxy /api/* to the FastAPI backend.
        // Development: API_URL is unset → defaults to http://localhost:8000.
        // Docker:      API_URL=http://api:8000 (set in docker-compose.yml).
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
