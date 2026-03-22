/**
 * GET /api/lan-peer/groups/[groupId]/files/content?path=xxx
 *
 * Returns file content for preview purposes.
 * - Text files: returns content as JSON { success, data: { content, mime } }
 * - Binary files (images, PDF): returns raw binary with correct Content-Type for inline viewing
 *
 * Supports local reading and remote proxy.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getGroup } from '@/lib/services/lan-peer/chat-service';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';
import { resolveGroupProxyUrl } from '@/lib/services/lan-peer/group-file-proxy';

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

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.xml', '.csv', '.yaml', '.yml', '.toml', '.ini', '.conf',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css', '.scss', '.sass', '.less',
  '.html', '.htm', '.svg',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.sh', '.bash', '.zsh', '.fish', '.bat', '.ps1',
  '.sql', '.graphql', '.prisma',
  '.env', '.gitignore', '.dockerignore', '.editorconfig',
  '.vue', '.svelte', '.astro',
  '.php', '.lua', '.r', '.swift', '.dart', '.elm', '.ex', '.exs',
  '.dockerfile', '.makefile',
]);

const INLINE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function isTextFile(ext: string): boolean {
  return TEXT_EXTENSIONS.has(ext.toLowerCase());
}

function getInlineMime(ext: string): string | null {
  return INLINE_MIME[ext.toLowerCase()] || null;
}

const MAX_TEXT_SIZE = 2 * 1024 * 1024; // 2MB for text preview

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

    // Determine if this node is the creator — exact peerId match
    const isLocalCreator = group.creatorId === localPeerId || group.creatorId === 'local';

    // Local creator
    if (isLocalCreator) {
      const workspace = groupWorkspace(groupId);
      const absPath = safePath(workspace, filePath);

      const stat = await fs.stat(absPath);
      if (stat.isDirectory()) {
        return NextResponse.json({ success: false, error: '不能预览文件夹' }, { status: 400 });
      }

      const ext = path.extname(absPath);
      const inlineMime = getInlineMime(ext);

      // Binary inline preview (images, PDF, video)
      if (inlineMime) {
        const data = await fs.readFile(absPath);
        return new NextResponse(data, {
          headers: {
            'Content-Type': inlineMime,
            'Content-Length': String(data.length),
            'Content-Disposition': 'inline',
            'Cache-Control': 'no-store',
          },
        });
      }

      // Text content preview
      if (isTextFile(ext) || ext === '') {
        if (stat.size > MAX_TEXT_SIZE) {
          return NextResponse.json({
            success: true,
            data: { content: '(文件过大，请下载后查看)', mime: 'text/plain', truncated: true },
          });
        }
        const content = await fs.readFile(absPath, 'utf-8');
        return NextResponse.json({
          success: true,
          data: { content, mime: 'text/plain', size: stat.size },
        });
      }

      // Unknown type — just return metadata
      return NextResponse.json({
        success: true,
        data: { content: null, mime: 'application/octet-stream', size: stat.size, preview: false },
      });
    }

    // Proxy to creator
    const proxyBaseUrl = await resolveGroupProxyUrl(groupId);
    if (!proxyBaseUrl) {
      return NextResponse.json({
        success: false,
        error: '群组创建者不在线，无法预览文件',
      }, { status: 503 });
    }

    const proxyUrl = `${proxyBaseUrl}/api/lan-peer/groups/${groupId}/files/content?path=${encodeURIComponent(filePath)}`;
    const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });

    const contentType = proxyRes.headers.get('content-type') || '';

    // If the response is JSON, pass through
    if (contentType.includes('application/json')) {
      const data = await proxyRes.json();
      return NextResponse.json(data);
    }

    // Binary pass-through
    const body = await proxyRes.arrayBuffer();
    return new NextResponse(Buffer.from(body), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[LanPeer Files] Content error:', error);
    const msg = error instanceof Error ? error.message : '预览失败';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
