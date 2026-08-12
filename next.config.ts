import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root so file tracing ignores unrelated lockfiles
  // elsewhere on the machine (e.g. a stray one in the home directory).
  outputFileTracingRoot: path.join(__dirname),

  // The embedding stack (transformers.js + the ONNX runtime + sharp) ships
  // native `.node` binaries and does its own filesystem model loading. Keep it
  // out of the bundler so it's `require`d at runtime from node_modules — this is
  // required for the API route handlers that call `embed()` to work.
  serverExternalPackages: ["@xenova/transformers", "onnxruntime-node", "sharp"],
};

export default nextConfig;
