/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep server-only packages (BullMQ/ioredis/prisma) out of the client bundle.
  // (Next 15 renamed this from experimental.serverComponentsExternalPackages.)
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis"],
  // Lint is enforced as a dedicated CI step; don't let it fail the container build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
