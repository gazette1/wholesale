import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@dealcalc/engine", "@dealcalc/db", "@dealcalc/integrations"],
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "@react-pdf/renderer"],
  // Monorepo root, so the tracer can include files that live outside apps/web.
  outputFileTracingRoot: resolve(__dirname, "../../"),
  // The PGlite fallback migrates on cold start by reading the SQL files from disk.
  outputFileTracingIncludes: { "/**": ["../../packages/db/migrations/*.sql"] },
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
