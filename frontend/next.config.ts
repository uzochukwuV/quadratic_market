import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT_MODE === "export" ? "export" : "standalone",
  serverExternalPackages: ["@solana/web3.js", "@coral-xyz/anchor"],
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
