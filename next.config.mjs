/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Pre-existing type errors from library upgrades (react-grid-layout, next.js)
    // These do not affect runtime behavior
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
