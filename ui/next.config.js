/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

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
