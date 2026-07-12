import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root so file tracing ignores unrelated lockfiles
  // elsewhere on the machine (e.g. a stray one in the home directory).
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
