/**
 * GET/POST /api/secretary/messages
 *
 * GET  — Retrieve secretary chat history from database
 * POST — Send a message, persist to DB, trigger Claude SDK AI reply asynchronously
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  createSecretaryMessage,
  getSecretaryMessages,
  getSecretaryMessageCount,
  deleteSecretaryMessages,
} from '@/lib/services/secretary/secretary-message-service';
import { secretaryStream } from '@/lib/services/secretary-stream';
import { executeSecretaryClaude, SECRETARY_SENDER_ID, SECRETARY_SENDER_NAME } from '@/lib/services/secretary/secretary-claude';
import { ensureSecretaryMigration } from '@/lib/services/secretary/secretary-migration';

// ========== Session Management (module-level) ==========
// Simple in-memory session storage; can be persisted later
let currentSessionId: string | undefined;

// ========== GET — Retrieve messages ==========

export async function GET(request: NextRequest) {
  try {
    // Ensure migration from JSON to SQLite is complete (runs once per process)
    await ensureSecretaryMigration();

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const before = url.searchParams.get('before') || undefined;

    const messages = await getSecretaryMessages({
      limit,
      offset: before ? undefined : offset,
      before,
    });

    const total = await getSecretaryMessageCount();

    return NextResponse.json({
      success: true,
      messages,
      total,
    });
  } catch (error) {
    console.error('[Secretary API] GET messages error:', error);
    return NextResponse.json(
      { success: false, error: '获取消息失败' },
      { status: 500 }
    );
  }
}

// ========== POST — Send message & trigger AI reply ==========

interface PostBody {
  content: string;
  senderName?: string;
  interactionMode?: string;
  enabledSkills?: string[];
  // Force dispatch result - skip AI call and save pre-computed result
  forceDispatchResult?: {
    reply: string;
    actions: Array<{
      type: 'dispatch';
      employeeId: string;
      employeeName: string;
      projectId: string;
    }>;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: PostBody = await request.json();
    const { content, senderName, interactionMode, enabledSkills, forceDispatchResult } = body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json(
        { success: false, error: '消息内容不能为空' },
        { status: 400 }
      );
    }

    const messageId = randomUUID();
    const requestId = randomUUID();

    // 1. Create and persist user message
    const userMessage = await createSecretaryMessage({
      id: messageId,
      role: 'user',
      messageType: 'text',
      content: content.trim(),
      senderId: 'user',
      senderName: senderName || '用户',
      interactionMode: interactionMode || 'ai_chat',
      requestId,
    });

    // 2. Publish new_message event via SSE
    secretaryStream.publish({
      type: 'new_message',
      data: { message: userMessage },
    });

    // 3. Handle force dispatch result (skip AI call)
    if (forceDispatchResult) {
      const aiMessage = await createSecretaryMessage({
        role: 'assistant',
        messageType: 'text',
        content: forceDispatchResult.reply,
        senderId: SECRETARY_SENDER_ID,
        senderName: SECRETARY_SENDER_NAME,
        interactionMode: 'ai_chat',
        requestId,
        metadata: { actions: forceDispatchResult.actions },
      });

      secretaryStream.publish({
        type: 'new_message',
        data: { message: aiMessage },
      });

      return NextResponse.json({
        success: true,
        message: userMessage,
        aiMessage,
        requestId,
      });
    }

    // 4. If AI reply is requested, trigger asynchronously
    if (interactionMode !== 'no_ai') {
      handleAIReply(content.trim(), requestId, enabledSkills || []).catch((err) => {
        console.error('[Secretary API] AI reply failed:', err);
      });
    }

    return NextResponse.json({
      success: true,
      message: userMessage,
      requestId,
    });
  } catch (error) {
    console.error('[Secretary API] POST message error:', error);
    return NextResponse.json(
      { success: false, error: '发送消息失败' },
      { status: 500 }
    );
  }
}

// ========== Async AI Reply Handler ==========

/**
 * Helper: Create message with retry mechanism
 */
async function createMessageWithRetry(
  params: Parameters<typeof createSecretaryMessage>[0],
  maxRetries = 2
): Promise<Awaited<ReturnType<typeof createSecretaryMessage>> | null> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const message = await createSecretaryMessage(params);
      if (attempt > 0) {
        console.log(`[Secretary API] createSecretaryMessage succeeded on retry ${attempt}`);
      }
      return message;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[Secretary API] createSecretaryMessage failed (attempt ${attempt + 1}/${maxRetries + 1}):`, lastError.message);
      
      if (attempt < maxRetries) {
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
  }
  
  console.error('[Secretary API] createSecretaryMessage failed after all retries:', lastError);
  return null;
}

async function handleAIReply(
  content: string,
  requestId: string,
  enabledSkills: string[]
): Promise<void> {
  console.log(`[Secretary API] Starting AI reply | request=${requestId}`);

  // Mark stream as active and get abort signal
  const abortController = secretaryStream.markStreamActive(requestId);

  // Notify frontend that AI streaming is starting
  secretaryStream.publish({
    type: 'ai_stream_start',
    data: { requestId, timestamp: new Date().toISOString() },
  });

  let persistSuccess = false;

  try {
    // Execute Claude Agent SDK
    const result = await executeSecretaryClaude({
      message: content,
      sessionId: currentSessionId,
      enabledSkills,
      requestId,
      abortSignal: abortController.signal,
    });

    // Update session ID for context continuity
    if (result.newSessionId) {
      currentSessionId = result.newSessionId;
      console.log(`[Secretary API] Session updated: ${currentSessionId}`);
    }

    // If we have a reply, persist to database with retry and then publish
    if (result.reply && result.reply.trim()) {
      const aiMessage = await createMessageWithRetry({
        role: 'assistant',
        messageType: 'text',
        content: result.reply.trim(),
        senderId: SECRETARY_SENDER_ID,
        senderName: SECRETARY_SENDER_NAME,
        interactionMode: 'ai_chat',
        requestId,
      });

      // Only publish if persist succeeded
      if (aiMessage) {
        persistSuccess = true;
        secretaryStream.publish({
          type: 'new_message',
          data: { message: aiMessage },
        });
        console.log(`[Secretary API] AI reply persisted and published | request=${requestId}`);
        
        // Fire-and-forget: extract memory from conversation
        (async () => {
          try {
            const { extractMemoryFromConversation } = await import('@/lib/services/secretary-memory-extractor');
            const { loadMemory, upsertEntry, saveMemory } = await import('@/lib/services/secretary-memory');
            const { loadClaudeConfig } = await import('@/lib/services/secretary-core');
            
            const claudeConfig = await loadClaudeConfig();
            const extractedItems = await extractMemoryFromConversation(
              content.trim(),
              result.reply.trim(),
              {
                baseUrl: claudeConfig.baseUrl,
                apiKey: claudeConfig.apiKey,
                model: claudeConfig.model,
              }
            );
            
            if (extractedItems.length > 0) {
              let mem: any = await loadMemory();
              for (const item of extractedItems) {
                mem = upsertEntry(mem, item.category as any, item);
              }
              await saveMemory(mem);
              console.log(`[Secretary API] \uD83E\uDDE0 Extracted and saved ${extractedItems.length} memory items`);
            }
          } catch (err) {
            console.warn('[Secretary API] Memory extraction failed:', err);
          }
        })();
      } else {
        // Notify frontend of persist failure via error event
        console.error(`[Secretary API] AI reply persist failed, notifying frontend | request=${requestId}`);
        secretaryStream.publish({
          type: 'error',
          data: { 
            requestId, 
            code: 'PERSIST_FAILED',
            message: 'Failed to persist AI reply after retries',
          },
        });
      }
    } else {
      // No reply to persist, consider it a success
      persistSuccess = true;
    }
  } catch (err) {
    console.error(`[Secretary API] handleAIReply error | request=${requestId}:`, err);
  } finally {
    // Mark stream as done
    secretaryStream.markStreamDone(requestId);

    // Send ai_stream_end with persist status
    secretaryStream.publish({
      type: 'ai_stream_end',
      data: { 
        requestId, 
        timestamp: new Date().toISOString(),
        persistSuccess,
      },
    });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ========== DELETE — Clear all messages ==========

export async function DELETE() {
  try {
    const deleted = await deleteSecretaryMessages();
    console.log(`[Secretary API] Deleted ${deleted} messages`);
    return NextResponse.json({
      success: true,
      deleted,
    });
  } catch (error) {
    console.error('[Secretary API] DELETE messages error:', error);
    return NextResponse.json(
      { success: false, error: '清空消息失败' },
      { status: 500 }
    );
  }
}
