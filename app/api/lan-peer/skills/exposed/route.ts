/**
 * GET/PUT /api/lan-peer/skills/exposed
 * Manage exposed skills for this node.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getExposedSkills, setExposedSkills } from '@/lib/services/lan-peer/peer-skill-service';

export async function GET() {
  const skills = await getExposedSkills();
  return NextResponse.json({ success: true, data: skills });
}

export async function PUT(request: NextRequest) {
  try {
    const { skills } = await request.json();
    if (!Array.isArray(skills)) {
      return NextResponse.json({ success: false, error: '请提供技能列表' }, { status: 400 });
    }
    await setExposedSkills(skills);
    return NextResponse.json({ success: true, data: skills });
  } catch (error) {
    return NextResponse.json({ success: false, error: '更新暴露技能失败' }, { status: 500 });
  }
}
