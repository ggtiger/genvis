/**
 * Third-Party Skill Import API
 * POST /api/skills/import-third-party - Import a skill from a third-party platform
 *
 * Supports two modes:
 * 1. JSON body with { url } — fetch from remote URL
 * 2. FormData with file — import from uploaded zip
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { convertThirdPartySkill, convertThirdPartyZip } from '@/lib/services/third-party-converter';

export const dynamic = 'force-dynamic';

/**
 * Map failedStep to appropriate HTTP status code based on error classification
 * from the design document.
 */
function statusForStep(step?: string): number {
  switch (step) {
    case 'fetch':
      return 502;
    case 'parse':
      return 422;
    case 'register':
      return 500;
    case 'transform':
      return 500;
    case 'translate':
      return 500;
    default:
      return 500;
  }
}

function buildErrorResponse(result: { error?: string; failedStep?: string }) {
  const status =
    result.error?.includes('已存在') ? 409 : statusForStep(result.failedStep);
  return NextResponse.json(
    { success: false, error: result.error, step: result.failedStep },
    { status },
  );
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';

  // ── Mode 2: File upload (multipart/form-data) ──
  if (contentType.includes('multipart/form-data')) {
    let tempFilePath: string | null = null;
    try {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      const translate = formData.get('translate') !== 'false';
      const overwrite = formData.get('overwrite') === 'true';

      if (!file) {
        return NextResponse.json(
          { success: false, error: '请上传文件' },
          { status: 400 },
        );
      }

      if (!file.name.endsWith('.zip')) {
        return NextResponse.json(
          { success: false, error: '只支持 .zip 格式文件' },
          { status: 400 },
        );
      }

      // Save to temp file
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      tempFilePath = path.join(os.tmpdir(), `third-party-import-${Date.now()}.zip`);
      await fs.writeFile(tempFilePath, buffer);

      const result = await convertThirdPartyZip(tempFilePath, {
        translate,
        overwrite,
      });

      if (result.success) {
        return NextResponse.json({ success: true, data: result.skill });
      }
      return buildErrorResponse(result);
    } catch (error) {
      console.error('[Import Third-Party Skill API] File upload error:', error);
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 },
      );
    } finally {
      if (tempFilePath) {
        await fs.unlink(tempFilePath).catch(() => {});
      }
    }
  }

  // ── Mode 1: JSON body with URL ──
  try {
    const body = await request.json();
    const { url, translate, overwrite } = body as {
      url?: string;
      translate?: boolean;
      overwrite?: boolean;
    };

    if (!url || typeof url !== 'string' || url.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'url 参数为必填项' },
        { status: 400 },
      );
    }

    const result = await convertThirdPartySkill(url.trim(), {
      translate,
      overwrite,
    });

    if (result.success) {
      return NextResponse.json({ success: true, data: result.skill });
    }
    return buildErrorResponse(result);
  } catch (error) {
    console.error('[Import Third-Party Skill API] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
