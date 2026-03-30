/**
 * GET/PUT /api/secretary/skills
 * 
 * GET  — Get available skills and currently enabled skills for secretary
 * PUT  — Update secretary's enabled skills list
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  getSecretaryEnabledSkills, 
  setSecretaryEnabledSkills,
  getSecretarySettings,
  updateSecretarySettings,
} from '@/lib/services/secretary/secretary-settings';
import { getAllSkills, type SkillMeta } from '@/lib/services/skill-service';

// ========== GET — Get skills list ==========

export async function GET() {
  try {
    // Get all available skills
    const allSkills = await getAllSkills();
    
    // Filter to only non-app skills with hasSkill=true (can be used as SDK skill)
    const availableSkills: Array<{
      name: string;
      displayName?: string;
      description: string;
      hasSkill: boolean;
      hasApp: boolean;
    }> = allSkills
      .filter((s: SkillMeta) => s.hasSkill && !s.hasApp)
      .map((s: SkillMeta) => ({
        name: s.name,
        displayName: s.displayName,
        description: s.description,
        hasSkill: s.hasSkill,
        hasApp: s.hasApp,
      }));
    
    // Get current settings to check if skills have been configured
    const settings = await getSecretarySettings();
    const enabledSkills = settings.enabledSkills;
    
    // Validate that enabled skills still exist
    const availableNames = new Set(availableSkills.map(s => s.name));
    let validEnabledSkills: string[];
    
    if (!settings.skillsConfigured) {
      // First time: default all non-app skills to enabled
      validEnabledSkills = availableSkills.map(s => s.name);
      // Persist the default and mark as configured
      await updateSecretarySettings({ enabledSkills: validEnabledSkills, skillsConfigured: true });
      console.log('[Secretary Skills API] First-time init: all non-app skills enabled by default');
    } else {
      validEnabledSkills = enabledSkills.filter(name => availableNames.has(name));
      
      // If some enabled skills were removed, update the stored list
      if (validEnabledSkills.length !== enabledSkills.length) {
        await setSecretaryEnabledSkills(validEnabledSkills);
        console.log('[Secretary Skills API] Cleaned up invalid enabled skills');
      }
    }
    
    return NextResponse.json({
      success: true,
      availableSkills,
      enabledSkills: validEnabledSkills,
    });
  } catch (error) {
    console.error('[Secretary Skills API] GET error:', error);
    return NextResponse.json(
      { success: false, error: '获取技能列表失败' },
      { status: 500 }
    );
  }
}

// ========== PUT — Update enabled skills ==========

interface PutBody {
  enabledSkills: string[];
}

export async function PUT(request: NextRequest) {
  try {
    const body: PutBody = await request.json();
    const { enabledSkills } = body;
    
    if (!Array.isArray(enabledSkills)) {
      return NextResponse.json(
        { success: false, error: 'enabledSkills must be an array' },
        { status: 400 }
      );
    }
    
    // Validate that all skills exist (non-app skills only)
    const allSkills = await getAllSkills();
    const availableNames = new Set(allSkills.filter(s => s.hasSkill && !s.hasApp).map(s => s.name));
    const validSkills = enabledSkills.filter(name => availableNames.has(name));
    
    // Update the settings and mark as configured
    await setSecretaryEnabledSkills(validSkills);
    await updateSecretarySettings({ skillsConfigured: true });
    
    console.log(`[Secretary Skills API] Updated enabled skills: ${validSkills.length} skill(s)`);
    
    return NextResponse.json({
      success: true,
      enabledSkills: validSkills,
    });
  } catch (error) {
    console.error('[Secretary Skills API] PUT error:', error);
    return NextResponse.json(
      { success: false, error: '更新技能设置失败' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
