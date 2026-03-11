import { NextRequest, NextResponse } from 'next/server';
import {
  getAllPrompts,
  updatePrompts,
  resetPrompt,
  PROMPT_METADATA,
  DEFAULT_PROMPTS,
} from '@/lib/config/prompts';
import type { PromptKey, PromptsConfig } from '@/lib/config/prompts';

/**
 * GET /api/settings/prompts
 * 获取所有提示词配置
 */
export async function GET() {
  try {
    const prompts = await getAllPrompts();
    return NextResponse.json({
      prompts,
      metadata: PROMPT_METADATA,
      defaults: DEFAULT_PROMPTS,
    });
  } catch (error) {
    console.error('[API] Failed to load prompts:', error);
    return NextResponse.json(
      {
        error: 'Failed to load prompts',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/settings/prompts
 * 更新提示词配置
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const { prompts } = body as { prompts?: Partial<PromptsConfig> };

    if (!prompts || typeof prompts !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid prompts field' },
        { status: 400 }
      );
    }

    // 验证 key 是否有效
    const validKeys: PromptKey[] = ['nextjs-execution', 'nextjs-planning', 'python-execution', 'python-planning'];
    for (const key of Object.keys(prompts)) {
      if (!validKeys.includes(key as PromptKey)) {
        return NextResponse.json(
          { error: `Invalid prompt key: ${key}` },
          { status: 400 }
        );
      }
    }

    await updatePrompts(prompts);
    const updated = await getAllPrompts();

    return NextResponse.json({
      prompts: updated,
      metadata: PROMPT_METADATA,
    });
  } catch (error) {
    console.error('[API] Failed to update prompts:', error);
    return NextResponse.json(
      {
        error: 'Failed to update prompts',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/settings/prompts?key=xxx
 * 重置单个或所有提示词为默认值
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key') as PromptKey | null;

    if (key) {
      const validKeys: PromptKey[] = ['nextjs-execution', 'nextjs-planning', 'python-execution', 'python-planning'];
      if (!validKeys.includes(key)) {
        return NextResponse.json(
          { error: `Invalid prompt key: ${key}` },
          { status: 400 }
        );
      }
      await resetPrompt(key);
    } else {
      await resetPrompt();
    }

    const updated = await getAllPrompts();
    return NextResponse.json({
      prompts: updated,
      metadata: PROMPT_METADATA,
      defaults: DEFAULT_PROMPTS,
    });
  } catch (error) {
    console.error('[API] Failed to reset prompts:', error);
    return NextResponse.json(
      {
        error: 'Failed to reset prompts',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
