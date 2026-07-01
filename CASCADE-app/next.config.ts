import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a fully static site to ./out so Caddy can serve it directly (no Node
  // server in production). Safe here: the app is a client-only SPA with no
  // route handlers, dynamic routes, or server rendering.
  output: "export",
};

export default nextConfig;
