import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // API-only app — no pages, no image optimization needed
  images: { unoptimized: true },
  // Serverless functions for Vercel
  output: 'standalone',
}

export default nextConfig
