import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@lc/shared", "@lc/ui"],
  typedRoutes: true,
};

export default nextConfig;
