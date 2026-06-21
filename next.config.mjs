import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  async headers() {
    const noStoreHeaders = [
      {
        key: 'Cache-Control',
        value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
      },
      { key: 'Pragma', value: 'no-cache' },
      { key: 'Expires', value: '0' },
    ]

    return [
      {
        source: '/login',
        headers: noStoreHeaders,
      },
      {
        source: '/register',
        headers: noStoreHeaders,
      },
      {
        source: '/forgot-password',
        headers: noStoreHeaders,
      },
      {
        source: '/teams',
        headers: noStoreHeaders,
      },
      {
        source: '/api/auth/:path*',
        headers: noStoreHeaders,
      },
      {
        source: '/api/teams',
        headers: noStoreHeaders,
      },
      {
        source: '/api/workspaces/members',
        headers: noStoreHeaders,
      },
    ]
  },
  eslint: {
    // Keep production/container builds unblocked while lint debt is handled separately.
    ignoreDuringBuilds: true,
  },
  // Keep heavy native/DB stacks out of the webpack graph for server code (faster /login, RSC, actions).
  serverExternalPackages: [
    '@prisma/client',
    '@prisma/adapter-pg',
    'pg',
    'bcryptjs',
    'googleapis',
  ],
};

export default nextConfig;
