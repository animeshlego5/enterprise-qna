/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        // Proxy /api/* to the FastAPI backend.
        // In development: FastAPI runs on :8000, Next.js on :3000.
        // This avoids CORS issues entirely — the browser sees all requests
        // going to the same origin (:3000), and Next.js proxies them to :8000.
        // In production: update the destination to your deployed FastAPI URL.
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
