/**
 * Skill Market API - Install a skill
 *
 * POST /api/skills/market/install
 * Body: { skillName: string, autoInstallCLI?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { installFromMarket, installSkillHubCLI, isSkillHubAvailable } from '@/lib/services/skill-market';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { skillName, autoInstallCLI = true } = body;

    if (!skillName || typeof skillName !== 'string') {
      return NextResponse.json(
        { success: false, error: 'skillName is required' },
        { status: 400 }
      );
    }

    // Check if SkillHub CLI is available
    let cliAvailable = await isSkillHubAvailable();

    // Auto-install CLI if not available and autoInstallCLI is true
    if (!cliAvailable && autoInstallCLI) {
      console.log('[Market Install] CLI not found, auto-installing...');
      const cliResult = await installSkillHubCLI();

      if (!cliResult.success) {
        return NextResponse.json(
          {
            success: false,
            error: `Failed to install SkillHub CLI: ${cliResult.error}`,
            cliInstallFailed: true
          },
          { status: 400 }
        );
      }

      // Re-check availability
      cliAvailable = await isSkillHubAvailable();
    }

    if (!cliAvailable) {
      return NextResponse.json(
        {
          success: false,
          error: 'SkillHub CLI not installed.',
          cliInstallFailed: true,
          installHint: 'curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only'
        },
        { status: 400 }
      );
    }

    // Install via SkillHub CLI
    const result = await installFromMarket(skillName, (step, message) => {
      console.log(`[Market Install] ${step}: ${message}`);
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        skillName: result.skillName,
        message: 'Skill installed successfully'
      }
    });
  } catch (error) {
    console.error('[API] Market install failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to install skill'
      },
      { status: 500 }
    );
  }
}
