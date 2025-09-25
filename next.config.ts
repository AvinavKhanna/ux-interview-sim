// next.config.ts
import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 👇 put it at the top level (not inside "experimental")
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;