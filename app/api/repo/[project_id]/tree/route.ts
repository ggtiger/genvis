/**
 * GET /api/repo/[project_id]/tree
 * Retrieve project file tree
 */

import { NextRequest, NextResponse } from 'next/server';
import { listProjectDirectory, FileBrowserError } from '@/lib/services/file-browser';
import { resolveGroupProxyUrl } from '@/lib/services/lan-peer/group-file-proxy';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const { searchParams } = new URL(request.url);
    const dir = searchParams.get('dir') ?? '.';

    let entries;
    try {
      entries = await listProjectDirectory(project_id, dir);
    } catch (localErr) {
      // Project not found locally — try proxying to group creator
      const proxyBaseUrl = await resolveGroupProxyUrl(project_id);
      if (proxyBaseUrl) {
        const proxyUrl = `${proxyBaseUrl}/api/repo/${project_id}/tree?dir=${encodeURIComponent(dir)}`;
        const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
        const data = await proxyRes.json();
        const resp = NextResponse.json(data);
        resp.headers.set('Cache-Control', 'no-store');
        return resp;
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
    try {
      console.warn('[API] Repo tree error, degrade to empty array:', error instanceof Error ? error.message : String(error));
    } catch {}
    const response = NextResponse.json([]);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
