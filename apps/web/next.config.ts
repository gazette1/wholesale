import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@dealcalc/engine", "@dealcalc/db", "@dealcalc/integrations"],
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "@react-pdf/renderer"],
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
