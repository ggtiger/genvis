/**
 * GET /api/repo/[project_id]/tree
 * Retrieve project file tree
 */

import { NextRequest, NextResponse } from 'next/server';
import { listProjectDirectory, FileBrowserError } from '@/lib/services/file-browser';
import { resolveGroupProxyUrl } from '@/lib/services/lan-peer/group-file-proxy';
import { getGroup } from '@/lib/services/lan-peer/chat-service';
import { getLanPeerManager } from '@/lib/services/lan-peer/manager';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const { searchParams } = new URL(request.url);
    const dir = searchParams.get('dir') ?? '.';

    // For group IDs: non-creator MUST proxy to creator, never use local files
    const group = await getGroup(project_id);
    const manager = getLanPeerManager();
    const isGroupCreator = group && manager && group.creatorId === manager.peerId;

    // If this is a group and we are NOT the creator, go directly to proxy
    if (group && !isGroupCreator) {
      const proxyBaseUrl = await resolveGroupProxyUrl(project_id);
      if (proxyBaseUrl) {
        try {
          const proxyUrl = `${proxyBaseUrl}/api/repo/${project_id}/tree?dir=${encodeURIComponent(dir)}`;
          console.log(`[API] Repo tree: member proxy to ${proxyUrl}`);
          const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
          if (!proxyRes.ok) throw new Error(`Proxy error: creator returned ${proxyRes.status}`);
          const data = await proxyRes.json();
          const resp = NextResponse.json(data);
          resp.headers.set('Cache-Control', 'no-store');
          return resp;
        } catch (proxyErr) {
          const proxyMsg = proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
          console.warn(`[API] Repo tree proxy error:`, proxyMsg);
          throw new Error(`Proxy error: ${proxyMsg}`);
        }
      }
      throw new Error('Creator offline');
    }

    // Local access (project or group creator)
    let entries;
    try {
      entries = await listProjectDirectory(project_id, dir);
    } catch (localErr) {
      // Fallback: try proxying (for non-group projects this won't match)
      const proxyBaseUrl = await resolveGroupProxyUrl(project_id);
      if (proxyBaseUrl) {
        try {
          const proxyUrl = `${proxyBaseUrl}/api/repo/${project_id}/tree?dir=${encodeURIComponent(dir)}`;
          const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
          if (!proxyRes.ok) throw new Error(`Proxy error: creator returned ${proxyRes.status}`);
          const data = await proxyRes.json();
          const resp = NextResponse.json(data);
          resp.headers.set('Cache-Control', 'no-store');
          return resp;
        } catch (proxyErr) {
          const proxyMsg = proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
          throw new Error(`Proxy error: ${proxyMsg}`);
        }
      }
      throw localErr;
    }

    const payload = entries.map((entry) => ({
      path: entry.path,
      type: entry.type === 'directory' ? 'dir' : 'file',
      size: entry.size ?? undefined,
      hasChildren: Boolean(entry.hasChildren),
    }));

    const response = NextResponse.json(payload);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn('[API] Repo tree error:', msg);

    if (/[Pp]roxy|[Cc]reator|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(msg)) {
      return NextResponse.json(
        { error: '群主不在线或未开启远程访问，无法浏览文件' },
        { status: 503 },
      );
    }

    const response = NextResponse.json([]);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
