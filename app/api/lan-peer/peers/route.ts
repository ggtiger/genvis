/**
 * GET /api/lan-peer/peers
 * Returns the list of discovered peers.
 */
import { NextResponse } from 'next/server';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';

export async function GET() {
  try {
    const manager = getLanPeerManager();
    if (!manager) {
      return NextResponse.json({ success: true, data: [] });
    }
    const peers = manager.discovery.getRegistry().getPeers();
    return NextResponse.json({ success: true, data: peers });
  } catch (error) {
    return NextResponse.json({ success: false, error: '获取节点列表失败' }, { status: 500 });
  }
}
