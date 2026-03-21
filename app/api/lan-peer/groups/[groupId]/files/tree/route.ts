/**
 * GET /api/lan-peer/groups/[groupId]/files/tree?dir=.
 *
 * Returns the file tree for a group's workspace directory.
 * - If this node is the group creator: reads local filesystem directly.
 * - Otherwise: proxies the request to the creator's node via HTTP.
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
  const abs = cleaned ? path.resolve(root, cleaned) : root;
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('Path traversal not allowed');
  }
  return abs;
}

const EXCLUDED = new Set([
  'node_modules', '.git', '.next', '.turbo', '.cache', '__pycache__',
]);

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { groupId } = await params;
    const { searchParams } = new URL(request.url);
    const dir = searchParams.get('dir') ?? '.';

    const group = await getGroup(groupId);
    if (!group) {
      return NextResponse.json({ success: false, error: '群组不存在' }, { status: 404 });
    }

    const manager = getLanPeerManager();
    const localPeerId = manager?.peerId || (globalThis as any).__lan_peer_id__ || 'local';

    // Determine if this node owns the workspace.
    // Primary check: creatorId matches current peerId.
    // Fallback: workspace directory exists locally (handles peerId change after restart).
    const workspace = groupWorkspace(groupId);
    let isLocalCreator = group.creatorId === localPeerId || group.creatorId === 'local';
    if (!isLocalCreator) {
      try {
        const wsStat = await fs.stat(workspace);
        if (wsStat.isDirectory()) isLocalCreator = true;
      } catch { /* doesn't exist locally */ }
    }

    // If we are the creator, read local workspace
    if (isLocalCreator) {
      // Ensure workspace exists
      await fs.mkdir(workspace, { recursive: true });

      const targetDir = safePath(workspace, dir);

      let stat;
      try {
        stat = await fs.stat(targetDir);
      } catch {
        return NextResponse.json({ success: true, data: [] });
      }

      if (!stat.isDirectory()) {
        return NextResponse.json({ success: true, data: [] });
      }

      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const items: Array<{
        name: string;
        path: string;
        type: 'file' | 'dir';
        size?: number;
        hasChildren: boolean;
      }> = [];

      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        if (entry.name.startsWith('.') && entry.name !== '.env') continue;
        if (entry.isDirectory() && EXCLUDED.has(entry.name)) continue;

        const relPath = dir === '.' ? entry.name : `${dir}/${entry.name}`;
        const absPath = path.join(targetDir, entry.name);

        if (entry.isDirectory()) {
          let hasChildren = false;
          try {
            const sub = await fs.readdir(absPath);
            hasChildren = sub.length > 0;
          } catch { /* ignore */ }
          items.push({ name: entry.name, path: relPath, type: 'dir', hasChildren });
        } else {
          try {
            const fileStat = await fs.stat(absPath);
            items.push({ name: entry.name, path: relPath, type: 'file', size: fileStat.size, hasChildren: false });
          } catch {
            items.push({ name: entry.name, path: relPath, type: 'file', hasChildren: false });
          }
        }
      }

      // Sort: directories first, then alphabetical
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return NextResponse.json({ success: true, data: items });
    }

    // Not the creator — proxy to creator's node
    if (!manager) {
      return NextResponse.json({ success: false, error: '局域网聊天服务未启动' }, { status: 503 });
    }

    const peers = manager.discovery.getRegistry().getPeers();
    const creator = peers.find((p) => p.id === group.creatorId);
    if (!creator || creator.status !== 'online') {
      return NextResponse.json({
        success: false,
        error: '群组创建者不在线，无法浏览文件',
      }, { status: 503 });
    }

    const proxyUrl = `http://${creator.ip}:${creator.httpPort}/api/lan-peer/groups/${groupId}/files/tree?dir=${encodeURIComponent(dir)}`;
    const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
    const proxyData = await proxyRes.json();
    return NextResponse.json(proxyData);
  } catch (error) {
    console.error('[LanPeer Files] Tree error:', error);
    return NextResponse.json({ success: true, data: [] });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
