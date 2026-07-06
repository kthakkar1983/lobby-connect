import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const KIOSK_CORS = [
  { key: "Access-Control-Allow-Origin", value: process.env.KIOSK_ORIGIN ?? "http://localhost:5173" },
  { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "content-type, x-kiosk-token" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Coolify/Docker builds only (BUILD_STANDALONE=1): emit the self-contained
  // server bundle. Unset on Vercel, so the prod build is byte-identical.
  ...(process.env.BUILD_STANDALONE === "1"
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
      }
    : {}),
  transpilePackages: ["@lc/shared", "@lc/ui"],
  typedRoutes: true,
  experimental: {
    optimizePackageImports: ["radix-ui", "lucide-react"],
  },
  async headers() {
    return [
      { source: "/api/kiosk/:path*", headers: KIOSK_CORS },
      { source: "/api/video/:path*", headers: KIOSK_CORS },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
});
