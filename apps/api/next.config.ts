import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // API-only app — no pages, no image optimization needed
  images: { unoptimized: true },
  // Serverless functions for Vercel
  output: 'standalone',
  transpilePackages: ['@rekurn/core', '@rekurn/crypto', '@rekurn/db', '@rekurn/types'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
}

export default nextConfig
