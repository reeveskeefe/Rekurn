import { NextResponse } from 'next/server'

export default function Page() {
  return NextResponse.json({ name: 'Rekurn API', version: '0.1.0', docs: '/api/v1' })
}
