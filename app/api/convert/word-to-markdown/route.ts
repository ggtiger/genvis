/**
 * POST /api/convert/word-to-markdown
 * Server-side Word → Markdown conversion using mammoth (Node.js only)
 *
 * Request body: { content: string } where content is base64-encoded .docx
 * Response: { markdown: string, success: boolean, error?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { wordToMarkdown } from '@/lib/services/document-converter';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json(
        { markdown: '', success: false, error: '缺少 content 参数' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(content, 'base64');
    const arrayBuffer = new Uint8Array(buffer).buffer;
    const result = await wordToMarkdown(arrayBuffer);

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { markdown: '', success: false, error: err.message || '转换失败' },
      { status: 500 }
    );
  }
}
