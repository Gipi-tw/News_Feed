import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // jsdom / readability are server-only; keep them out of the client bundle.
  serverExternalPackages: ["@mozilla/readability", "jsdom"],
  output: "standalone",
};

export default nextConfig;
