/**
 * Skill Auto-Start API
 * GET /api/skills/{name}/auto-start - Get skill auto-start status
 * POST /api/skills/{name}/auto-start - Set skill auto-start status
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSkillAutoStart, setSkillAutoStart } from '@/lib/services/skill-service';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Skill name is required' },
        { status: 400 }
      );
    }

    const autoStart = await isSkillAutoStart(decodeURIComponent(name));
    return NextResponse.json({ success: true, data: { autoStart } });
  } catch (error) {
    console.error('[Skills Auto-Start API] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Skill name is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'enabled (boolean) is required' },
        { status: 400 }
      );
    }

    await setSkillAutoStart(decodeURIComponent(name), enabled);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Skills Auto-Start API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === 'Skill not found') {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 }
      );
    }

    if (message === 'Skill does not support app mode') {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
