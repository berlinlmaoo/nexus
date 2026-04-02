/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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
