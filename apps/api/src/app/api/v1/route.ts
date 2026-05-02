import { NextResponse } from 'next/server'

/**
 * GET /api/v1
 * API health check and version info.
 */
export async function GET() {
  return NextResponse.json({
    name: 'Rekurn API',
    version: '0.1.0',
    status: 'ok',
    endpoints: {
      auth: '/api/v1/auth',
      repos: '/api/v1/repos',
    },
  })
}
