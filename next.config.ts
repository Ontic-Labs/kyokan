import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 30,
    },
  },
  // Transpile swagger-ui packages to ensure proper module resolution
  transpilePackages: ["swagger-ui-react", "swagger-client"],
  // Empty turbopack config to use Turbopack (Next.js 16 default)
  turbopack: {},
};

export default nextConfig;
