/**
 * Secretary Soul API
 *
 * GET  - Load soul and user profile files
 * PUT  - Save soul and/or user profile files
 */

import { NextResponse } from 'next/server';
import {
  loadSoulFile,
  loadUserFile,
  saveSoulFile,
  saveUserFile,
} from '@/lib/services/secretary-soul';

export async function GET() {
  try {
    const [soul, user] = await Promise.all([loadSoulFile(), loadUserFile()]);
    return NextResponse.json({ soul, user });
  } catch (error) {
    console.error('[SoulAPI] Failed to load soul files:', error);
    return NextResponse.json(
      { error: 'Failed to load soul files' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { soul, user } = body as { soul?: string; user?: string };

    const tasks: Promise<void>[] = [];
    if (typeof soul === 'string') tasks.push(saveSoulFile(soul));
    if (typeof user === 'string') tasks.push(saveUserFile(user));

    if (tasks.length === 0) {
      return NextResponse.json(
        { error: 'No content provided. Send { soul?: string, user?: string }' },
        { status: 400 }
      );
    }

    await Promise.all(tasks);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[SoulAPI] Failed to save soul files:', error);
    return NextResponse.json(
      { error: 'Failed to save soul files' },
      { status: 500 }
    );
  }
}
