import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@solana/web3.js", "@coral-xyz/anchor"],
  turbopack: {},
};

export default nextConfig;
