/**
 * Secretary Input Optimization API
 * POST /api/secretary/optimize
 *
 * Optimizes user input to be clearer and more effective for AI understanding.
 */

import { NextRequest, NextResponse } from 'next/server';

interface OptimizeRequest {
  content: string;
}

interface OptimizeResponse {
  success: boolean;
  optimized?: string;
  error?: string;
}

const OPTIMIZE_PROMPT = `You are a prompt optimization assistant. Your task is to improve the user's input to make it clearer, more specific, and more effective for AI understanding.

Rules:
1. Keep the original intent and meaning
2. Add necessary context if implied but not stated
3. Make the request more specific and actionable
4. Use clear, concise language
5. If the input is already optimal, return it as-is with minor improvements
6. Return ONLY the optimized text, no explanations

User input to optimize:`;

export async function POST(request: NextRequest): Promise<NextResponse<OptimizeResponse>> {
  try {
    const body = await request.json() as OptimizeRequest;
    const { content } = body;

    if (!content?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Content is required' },
        { status: 400 }
      );
    }

    // Use a simple AI call to optimize the input
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
    const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'AI service not configured' },
        { status: 500 }
      );
    }

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `${OPTIMIZE_PROMPT}\n\n${content}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Optimize API] AI request failed:', errorText);
      return NextResponse.json(
        { success: false, error: 'AI optimization failed' },
        { status: 500 }
      );
    }

    const data = await response.json();
    const optimized = data.content?.[0]?.text?.trim();

    if (!optimized) {
      return NextResponse.json(
        { success: false, error: 'No optimization result' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      optimized,
    });
  } catch (error) {
    console.error('[Optimize API] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
