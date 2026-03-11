/**
 * GET /api/lan-peer/info
 * Returns this node's peer info for discovery/handshake.
 */
import { NextResponse } from 'next/server';
import { loadGlobalSettings } from '@/lib/services/settings';
import { getPrimaryLanIP } from '@/lib/utils/network';
import { DEFAULT_LAN_PEER_SETTINGS } from '@/lib/services/lan-peer/types';

export async function GET() {
  try {
    const settings = await loadGlobalSettings();
    const lanPeer = { ...DEFAULT_LAN_PEER_SETTINGS, ...settings.lan_peer };
    const ip = getPrimaryLanIP() || '0.0.0.0';

    return NextResponse.json({
      success: true,
      data: {
        id: getLanPeerId(),
        name: lanPeer.nodeName || '未命名节点',
        ip,
        port: lanPeer.wsPort,
        httpPort: parseInt(process.env.PORT || '3000', 10),
        skills: lanPeer.exposedSkills,
        status: 'online',
        lastSeen: Date.now(),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: '获取节点信息失败' }, { status: 500 });
  }
}

/** Stable peer ID derived from machine — stored in globalThis for HMR stability */
function getLanPeerId(): string {
  const g = globalThis as any;
  if (!g.__lan_peer_id__) {
    const { randomUUID } = require('crypto');
    g.__lan_peer_id__ = randomUUID();
  }
  return g.__lan_peer_id__;
}
