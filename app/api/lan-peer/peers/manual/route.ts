/**
 * POST /api/lan-peer/peers/manual
 * Manually add a peer by IP address.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';

export async function POST(request: NextRequest) {
  try {
    const { ip, port } = await request.json();
    if (!ip) {
      return NextResponse.json({ success: false, error: '请提供 IP 地址' }, { status: 400 });
    }

    const manager = getLanPeerManager();
    if (!manager) {
      return NextResponse.json({ success: false, error: '局域网聊天服务未启动' }, { status: 503 });
    }

    const httpPort = port || 3000;
    const peer = await manager.discovery.addManualPeer(ip, httpPort);
    return NextResponse.json({ success: true, data: peer });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '添加节点失败';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
