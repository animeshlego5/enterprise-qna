/** @type {import('next').NextConfig} */
const nextConfig = {
  // "standalone" generates a self-contained server.js for Docker.
  // On Vercel, the platform handles the build itself — standalone output
  // is ignored and causes a confusing extra build artefact, so we skip it.
  output: process.env.VERCEL ? undefined : "standalone",

  // Prevent server-side bundling of browser-only ML/WASM packages.
  // These are imported only by "use client" components and must never
  // be evaluated on the server.
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-web",
    "onnxruntime-node",
  ],

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
