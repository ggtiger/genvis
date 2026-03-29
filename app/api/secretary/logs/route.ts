/**
 * Secretary Timeline SSE Stream API
 * GET /api/secretary/logs - Real-time secretary timeline log streaming
 *
 * Uses the same SSE + file watcher pattern as project timeline.
 * Logs are stored at {PROJECTS_DIR}/secretary/logs/timeline.txt
 */

import { NextRequest } from 'next/server';
import { PROJECTS_DIR_ABSOLUTE } from '@/lib/config/paths';
import path from 'path';
import fs from 'fs';

const SECRETARY_PROJECT_ID = 'secretary';

export async function GET(request: NextRequest) {
  const timelineFilePath = path.join(PROJECTS_DIR_ABSOLUTE, SECRETARY_PROJECT_ID, 'logs', 'timeline.txt');

  const stream = new ReadableStream({
    start(controller) {
      let fileWatcher: fs.FSWatcher | null = null;
      let lastSize = 0;
      let disposed = false;
      const encoder = new TextEncoder();

      // Send connection confirmation
      const welcomeMessage = `data: ${JSON.stringify({
        type: 'connected',
        timestamp: new Date().toISOString(),
      })}\n\n`;

      try {
        controller.enqueue(encoder.encode(welcomeMessage));
      } catch (error) {
        console.error('[Secretary SSE] Failed to send welcome message:', error);
      }

      // Read initial file content
      const readInitialContent = () => {
        try {
          if (!fs.existsSync(timelineFilePath)) {
            const emptyMessage = `data: ${JSON.stringify({
              type: 'content',
              data: '',
              isInitial: true,
            })}\n\n`;
            controller.enqueue(encoder.encode(emptyMessage));
            lastSize = 0;
            return;
          }

          const stats = fs.statSync(timelineFilePath);
          lastSize = stats.size;

          const content = fs.readFileSync(timelineFilePath, 'utf-8');
          // Send lines in reverse order (newest first)
          const reversedContent = content.split('\n').reverse().join('\n');
          const message = `data: ${JSON.stringify({
            type: 'content',
            data: reversedContent,
            isInitial: true,
          })}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch (error) {
          console.error('[Secretary SSE] Failed to read initial content:', error);
          const errorMessage = `data: ${JSON.stringify({
            type: 'error',
            message: 'Failed to read secretary timeline file',
          })}\n\n`;
          controller.enqueue(encoder.encode(errorMessage));
        }
      };

      readInitialContent();

      // Watch file changes
      const watchFile = () => {
        try {
          const logsDir = path.dirname(timelineFilePath);

          if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
          }

          fileWatcher = fs.watch(timelineFilePath, (eventType) => {
            if (disposed) return;
            if (eventType !== 'change') return;

            try {
              const stats = fs.statSync(timelineFilePath);
              const currentSize = stats.size;

              if (currentSize > lastSize) {
                const readStream = fs.createReadStream(timelineFilePath, {
                  start: lastSize,
                  end: currentSize - 1,
                  encoding: 'utf-8',
                });

                let incrementalContent = '';
                readStream.on('data', (chunk) => {
                  incrementalContent += chunk;
                });

                readStream.on('end', () => {
                  if (incrementalContent) {
                    const message = `data: ${JSON.stringify({
                      type: 'update',
                      data: incrementalContent,
                    })}\n\n`;

                    try {
                      controller.enqueue(encoder.encode(message));
                    } catch (error) {
                      console.error('[Secretary SSE] Failed to send update:', error);
                    }
                  }
                  lastSize = currentSize;
                });

                readStream.on('error', (error) => {
                  console.error('[Secretary SSE] Failed to read incremental content:', error);
                });
              } else {
                // File was truncated or recreated - send full content
                lastSize = 0;
                readInitialContent();
              }
            } catch (error) {
              console.error('[Secretary SSE] Failed to process file change:', error);
            }
          });

          fileWatcher.on('error', (error) => {
            console.error('[Secretary SSE] File watcher error:', error);
            if (!disposed && fileWatcher) {
              fileWatcher.close();
              setTimeout(() => {
                if (!disposed) {
                  watchFile();
                }
              }, 1000);
            }
          });
        } catch (error) {
          console.error('[Secretary SSE] Failed to start file watcher:', error);
        }
      };

      watchFile();

      // Heartbeat (every 30 seconds)
      const heartbeatInterval = setInterval(() => {
        if (disposed) {
          clearInterval(heartbeatInterval);
          return;
        }

        try {
          const heartbeat = `data: ${JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
          })}\n\n`;
          controller.enqueue(encoder.encode(heartbeat));
        } catch (error) {
          console.error('[Secretary SSE] Failed to send heartbeat:', error);
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Cleanup on connection close
      request.signal.addEventListener('abort', () => {
        disposed = true;
        clearInterval(heartbeatInterval);
        if (fileWatcher) {
          fileWatcher.close();
        }
      });
    },

    cancel() {
      // Cleanup handled in abort listener
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
