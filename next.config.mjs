/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep server-only packages (BullMQ/ioredis/prisma) out of the client bundle.
  // (Next 15 renamed this from experimental.serverComponentsExternalPackages.)
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis"],
};

export default nextConfig;
