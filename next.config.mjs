/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    // Keep production/container builds unblocked while lint debt is handled separately.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Keep heavy native/DB stacks out of the webpack graph for server code (faster /login, RSC, actions).
    serverComponentsExternalPackages: [
      '@prisma/client',
      '@prisma/adapter-pg',
      'pg',
      'bcryptjs',
    ],
  },
};

export default nextConfig;
