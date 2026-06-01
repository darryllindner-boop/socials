/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server (.next/standalone/server.js) so Electron can
  // launch the app as a single Node process and electron-builder can package it.
  output: "standalone",
  // Keep the Prisma engine out of the client bundle. (BullMQ/ioredis were
  // removed in the desktop build in favour of the in-process scheduler.)
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  // Lint is enforced as a dedicated CI step; don't let it fail the build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
