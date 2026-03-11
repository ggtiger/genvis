import { NextResponse } from 'next/server';

/**
 * Health check endpoint
 * Required by Genvis platform for skill readiness detection
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'productivity-hub',
    timestamp: new Date().toISOString(),
  });
}
