/**
 * API endpoint to get LAN IP address
 */
import { NextResponse } from 'next/server';
import { getPrimaryLanIP, getLanIPs } from '@/lib/utils/network';

export async function GET() {
  try {
    const primaryIP = getPrimaryLanIP();
    const allIPs = getLanIPs();

    return NextResponse.json({
      success: true,
      data: {
        primaryIP,
        allIPs,
      },
    });
  } catch (error) {
    console.error('[LAN IP API] Error getting LAN IP:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get LAN IP address',
      },
      { status: 500 }
    );
  }
}
