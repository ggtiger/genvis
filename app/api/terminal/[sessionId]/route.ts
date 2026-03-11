import { NextRequest, NextResponse } from 'next/server';
import { terminalManager } from '@/lib/services/terminal-manager';

/**
 * Terminal HTTP API Route
 *
 * Uses HTTP polling instead of WebSocket for terminal I/O.
 * This avoids WebSocket upgrade issues in Next.js dev mode.
 *
 * GET  /api/terminal/:sessionId         - Get buffered output + session status
 * POST /api/terminal/:sessionId         - Send input or control commands
 *   body: { type: 'input', data: string }
 *   body: { type: 'resize', cols: number, rows: number }
 *   body: { type: 'create' }            - Create session if not exists
 */

/** State persisted across hot reloads via globalThis. */
const globalTerminalState = globalThis as typeof globalThis & {
  __termOutputBuffers?: Map<string, string[]>;
  __termScrollbackBuffers?: Map<string, string[]>;
  __termExitCodes?: Map<string, number>;
  __termSessionIdMap?: Map<string, string>;
};

const outputBuffers: Map<string, string[]> =
  globalTerminalState.__termOutputBuffers ?? (globalTerminalState.__termOutputBuffers = new Map());
const scrollbackBuffers: Map<string, string[]> =
  globalTerminalState.__termScrollbackBuffers ?? (globalTerminalState.__termScrollbackBuffers = new Map());
const MAX_SCROLLBACK = 200;
const exitCodes: Map<string, number> =
  globalTerminalState.__termExitCodes ?? (globalTerminalState.__termExitCodes = new Map());
const sessionIdMap: Map<string, string> =
  globalTerminalState.__termSessionIdMap ?? (globalTerminalState.__termSessionIdMap = new Map());

function getOrCreateBuffer(sessionId: string): string[] {
  let buf = outputBuffers.get(sessionId);
  if (!buf) {
    buf = [];
    outputBuffers.set(sessionId, buf);
  }
  return buf;
}

/** Resolves a client session ID to the internal server session ID. */
function resolveSessionId(clientId: string): string | undefined {
  return sessionIdMap.get(clientId) ?? (terminalManager.getSession(clientId) ? clientId : undefined);
}

/**
 * Ensures a terminal session exists and its output is being captured.
 */
function ensureSession(clientId: string): { sessionId: string; created: boolean; error?: string } {
  const existing = resolveSessionId(clientId);
  if (existing && terminalManager.getSession(existing)) {
    console.log(`[Terminal API] Reusing existing session: ${existing} for client: ${clientId}`);
    return { sessionId: existing, created: false };
  }

  console.log(`[Terminal API] Creating new session for client: ${clientId}`);
  let session;
  try {
    session = terminalManager.createSession({ cols: 80, rows: 24 });
    console.log(`[Terminal API] Session created successfully: ${session.id}`);
  } catch (error) {
    console.error(`[Terminal API] Failed to create session:`, error);
    return {
      sessionId: clientId,
      created: false,
      error: `Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const sid = session.id;
  sessionIdMap.set(clientId, sid);
  const buf = getOrCreateBuffer(sid);
  const scrollback: string[] = [];
  scrollbackBuffers.set(sid, scrollback);

  // Capture PTY output into the buffer and scrollback
  session.pty.onData((data: string) => {
    buf.push(data);
    scrollback.push(data);
    // Cap buffer sizes
    while (buf.length > 500) { buf.shift(); }
    while (scrollback.length > MAX_SCROLLBACK) { scrollback.shift(); }
  });

  session.pty.onExit(({ exitCode }: { exitCode: number }) => {
    exitCodes.set(sid, exitCode);
  });

  return { sessionId: sid, created: true };
}

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// GET /api/terminal/[sessionId] - Get buffered output + session status
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;
  const sid = sessionId;

  const resolved = resolveSessionId(sid);
  const session = resolved ? terminalManager.getSession(resolved) : undefined;
  const buf = resolved ? outputBuffers.get(resolved) : undefined;
  const output = buf ? buf.splice(0, buf.length).join('') : '';
  const exitCode = resolved ? exitCodes.get(resolved) : undefined;

  return NextResponse.json({
    ok: true,
    sessionId: session?.id ?? sid,
    active: !!session,
    output,
    ...(exitCode !== undefined ? { exitCode } : {}),
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

// POST /api/terminal/[sessionId] - Send input or control commands
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;
  const sid = sessionId;

  const body = await request.json().catch(() => ({}));
  const type = body.type;

  if (type === 'create') {
    const result = ensureSession(sid);
    if (result.error) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    // If session already existed, include scrollback history for the reconnecting client
    let scrollback = '';
    if (!result.created) {
      const sb = scrollbackBuffers.get(result.sessionId);
      if (sb && sb.length > 0) {
        scrollback = sb.join('');
      }
    }
    return NextResponse.json({
      ok: true,
      sessionId: result.sessionId,
      created: result.created,
      ...(scrollback ? { scrollback } : {}),
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  // For input/resize, the session must already exist
  let resolved = resolveSessionId(sid);
  let session = resolved ? terminalManager.getSession(resolved) : undefined;

  if (!session) {
    // Auto-create if not exists
    const result = ensureSession(sid);
    if (result.error) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    resolved = result.sessionId;
    session = terminalManager.getSession(resolved!);
  }

  if (!session || !resolved) {
    return NextResponse.json({ ok: false, error: 'Session not found' }, { status: 404 });
  }

  if (type === 'input' && typeof body.data === 'string') {
    terminalManager.writeToSession(resolved, body.data);
    return NextResponse.json({ ok: true });
  }

  if (type === 'resize' && typeof body.cols === 'number' && typeof body.rows === 'number') {
    terminalManager.resizeSession(resolved, body.cols, body.rows);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid request type' }, { status: 400 });
}
