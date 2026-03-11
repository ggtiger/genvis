/**
 * POST /api/lan-peer/skills/call
 * Receives a remote skill call request from another peer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { handleSkillRequest } from '@/lib/services/lan-peer/peer-skill-service';

export async function POST(request: NextRequest) {
  try {
    const { skillName, method, path: apiPath, body, queryParams } = await request.json();
    if (!skillName || !method || !apiPath) {
      return NextResponse.json({ success: false, error: '缺少技能调用参数' }, { status: 400 });
    }

    const result = await handleSkillRequest(skillName, method, apiPath, body, queryParams);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '技能调用失败';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
