/** @type {import('next').NextConfig} */
const path = require('path');

const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ['@prisma/client'],
  experimental: {
    instrumentationHook: true,
  },
};


module.exports = nextConfig;
