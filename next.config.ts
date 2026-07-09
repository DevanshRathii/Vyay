import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@googleapis/gmail", "googleapis-common", "exceljs"],
  eslint: {
    // linting runs separately via `npm run lint`
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
