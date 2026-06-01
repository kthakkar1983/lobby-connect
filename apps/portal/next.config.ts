import type { NextConfig } from "next";

const KIOSK_CORS = [
  { key: "Access-Control-Allow-Origin", value: process.env.KIOSK_ORIGIN ?? "http://localhost:5173" },
  { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "content-type, x-kiosk-token" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@lc/shared", "@lc/ui"],
  typedRoutes: true,
  async headers() {
    return [
      { source: "/api/kiosk/:path*", headers: KIOSK_CORS },
      { source: "/api/agora/:path*", headers: KIOSK_CORS },
    ];
  },
};

export default nextConfig;
