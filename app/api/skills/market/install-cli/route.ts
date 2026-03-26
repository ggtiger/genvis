/**
 * Skill Market API - Install SkillHub CLI
 *
 * POST /api/skills/market/install-cli
 */

import { NextResponse } from 'next/server';
import { installSkillHubCLI, isSkillHubAvailable } from '@/lib/services/skill-market';

export async function POST() {
  try {
    // Check if already installed
    const alreadyInstalled = await isSkillHubAvailable();
    if (alreadyInstalled) {
      return NextResponse.json({
        success: true,
        message: 'SkillHub CLI is already installed'
      });
    }

    // Install CLI
    const result = await installSkillHubCLI();

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'SkillHub CLI installed successfully'
    });
  } catch (error) {
    console.error('[API] CLI installation failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to install CLI'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const available = await isSkillHubAvailable();
    return NextResponse.json({
      success: true,
      available
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to check CLI status' },
      { status: 500 }
    );
  }
}
