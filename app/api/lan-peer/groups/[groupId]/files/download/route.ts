/**
 * GET /api/lan-peer/groups/[groupId]/files/download?path=xxx
 *
 * Downloads a file from the group's workspace.
 * - If this node is the group creator: reads local file and returns it.
 * - Otherwise: proxies to the creator's node.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getGroup } from '@/lib/services/lan-peer/chat-service';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

const DATA_DIR = path.join(process.cwd(), 'data', 'lan-peer', 'groups');

function groupWorkspace(groupId: string): string {
  return path.join(DATA_DIR, groupId, 'workspace');
}

function safePath(root: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\.?\/?/, '');
  if (!cleaned) throw new Error('Empty path');
  const abs = path.resolve(root, cleaned);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error('Path traversal not allowed');
  }
  return abs;
}

function guessMime(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.zip': 'application/zip', '.gz': 'application/gzip',
    '.json': 'application/json', '.xml': 'application/xml',
    '.html': 'text/html', '.htm': 'text/html',
    '.css': 'text/css', '.js': 'text/javascript',
    '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
    '.ts': 'text/typescript', '.tsx': 'text/typescript',
    '.py': 'text/x-python', '.sh': 'text/x-shellscript',
    '.yaml': 'text/yaml', '.yml': 'text/yaml',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { groupId } = await params;
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path');

    if (!filePath) {
      return NextResponse.json({ success: false, error: '缺少 path 参数' }, { status: 400 });
    }

    const group = await getGroup(groupId);
    if (!group) {
      return NextResponse.json({ success: false, error: '群组不存在' }, { status: 404 });
    }

    const manager = getLanPeerManager();
    const localPeerId = manager?.peerId || (globalThis as any).__lan_peer_id__ || 'local';

    // Determine if this node owns the workspace
    const workspace = groupWorkspace(groupId);
    let isLocalCreator = group.creatorId === localPeerId || group.creatorId === 'local';
    if (!isLocalCreator) {
      try {
        const wsStat = await fs.stat(workspace);
        if (wsStat.isDirectory()) isLocalCreator = true;
      } catch { /* doesn't exist locally */ }
    }

    // Local creator — serve file directly
    if (isLocalCreator) {
      const absPath = safePath(workspace, filePath);

      const stat = await fs.stat(absPath);
      if (stat.isDirectory()) {
        return NextResponse.json({ success: false, error: '不能下载文件夹' }, { status: 400 });
      }

      const data = await fs.readFile(absPath);
      const ext = path.extname(absPath);
      const mime = guessMime(ext);
      const name = path.basename(absPath);

      return new NextResponse(data, {
        headers: {
          'Content-Type': mime,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
          'Content-Length': String(data.length),
          'Cache-Control': 'no-store',
        },
      });
    }

    // Proxy to creator
    if (!manager) {
      return NextResponse.json({ success: false, error: '局域网聊天服务未启动' }, { status: 503 });
    }

    const peers = manager.discovery.getRegistry().getPeers();
    const creator = peers.find((p) => p.id === group.creatorId);
    if (!creator || creator.status !== 'online') {
      return NextResponse.json({
        success: false,
        error: '群组创建者不在线，无法下载文件',
      }, { status: 503 });
    }

    const proxyUrl = `http://${creator.ip}:${creator.httpPort}/api/lan-peer/groups/${groupId}/files/download?path=${encodeURIComponent(filePath)}`;
    const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(30000) });

    if (!proxyRes.ok) {
      const errText = await proxyRes.text().catch(() => '');
      return new NextResponse(errText || '下载失败', { status: proxyRes.status });
    }

    const contentType = proxyRes.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = proxyRes.headers.get('content-disposition') || '';
    const body = await proxyRes.arrayBuffer();

    return new NextResponse(Buffer.from(body), {
      headers: {
        'Content-Type': contentType,
        ...(contentDisposition ? { 'Content-Disposition': contentDisposition } : {}),
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[LanPeer Files] Download error:', error);
    const msg = error instanceof Error ? error.message : '下载失败';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
