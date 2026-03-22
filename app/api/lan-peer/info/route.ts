/**
 * GET /api/lan-peer/info
 * Returns this node's peer info for discovery/handshake.
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadGlobalSettings } from '@/lib/services/settings';
import { getPrimaryLanIP, getLanIPs, getLanBroadcastAddresses } from '@/lib/utils/network';
import { DEFAULT_LAN_PEER_SETTINGS } from '@/lib/services/lan-peer/types';
import { getStablePeerId, getLanPeerManager } from '@/lib/services/lan-peer/manager';

export async function GET(request: NextRequest) {
  try {
    const settings = await loadGlobalSettings();
    const lanPeer = { ...DEFAULT_LAN_PEER_SETTINGS, ...settings.lan_peer };
    const ip = getPrimaryLanIP() || '0.0.0.0';

    const diag = request.nextUrl.searchParams.get('diag') === 'true';

    const data: Record<string, any> = {
      id: await getStablePeerId(),
      name: lanPeer.nodeName || '未命名节点',
      ip,
      port: lanPeer.wsPort,
      httpPort: parseInt(process.env.PORT || '3000', 10),
      skills: lanPeer.exposedSkills,
      status: 'online',
      lastSeen: Date.now(),
    };

    // Diagnostic mode: include network details and discovered peers
    if (diag) {
      const manager = getLanPeerManager();
      data.diagnostics = {
        udpPort: lanPeer.udpPort,
        wsPort: lanPeer.wsPort,
        interfaces: getLanIPs(),
        broadcastAddresses: getLanBroadcastAddresses(),
        discoveredPeers: manager ? manager.discovery.getRegistry().getPeers() : [],
      };
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: '获取节点信息失败' }, { status: 500 });
  }
}
