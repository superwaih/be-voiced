import type { NextConfig } from "next";

const config: NextConfig = {
  // Emits a self-contained server bundle, so the production image is a Node base plus .next/standalone
  // rather than the whole node_modules tree. This is what lets it run on a $5 box instead of Vercel.
  output: "standalone",
  reactStrictMode: true,
};

export default config;
