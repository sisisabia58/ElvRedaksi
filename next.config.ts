import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Webpack rewrites PGlite's file URL into a non-Node URL, so fs.readFile throws
  // and every SQL page 500s. Load the package from node_modules instead.
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
